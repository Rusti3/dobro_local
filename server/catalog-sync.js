import { annotationInputHash } from "../scripts/lib/annotation-contract.js";
import { annotationSubjectsFromActivity } from "../scripts/lib/annotation-contract.js";
import { createDobroClient, dobroCities, hashJson, sourceToCatalog } from "./dobro-source.js";

async function mapConcurrent(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

export function annotationSubject(event, vacancy, matchedCities = []) {
  return annotationSubjectsFromActivity({
    event,
    vacancies: [vacancy],
    sourceUrl: `https://dobro.ru/event/${event.id}/vacancy/${vacancy.id}`,
    matchedCities,
    completeness: "complete",
  })[0];
}

async function upsertActivity(pool, { event, vacancies, matchedCities, seenAt }) {
  const catalog = sourceToCatalog(event, vacancies, matchedCities);
  const activeVacancies = vacancies.filter((vacancy) => !vacancy.deleted && !vacancy.hidden && !vacancy.archive);
  const isActive = (!catalog.endsAt || Date.parse(catalog.endsAt) > Date.now()) && activeVacancies.length > 0;
  const client = await pool.connect();
  let queued = 0;
  try {
    await client.query("begin");
    const existing = await client.query("select catalog_data from events where id = $1 for update", [catalog.id]);
    const previous = existing.rows[0]?.catalog_data || {};
    if (previous.annotation) catalog.annotation = previous.annotation;
    catalog.themes = [...new Set([...(catalog.themes || []), ...(previous.annotation?.themeIds || [])])].slice(0, 8);
    await client.query(`
      insert into events (
        id, source, source_url, title, city, starts_at, ends_at, is_active, content_hash,
        raw_data, catalog_data, first_seen_at, last_seen_at, retired_at, updated_at
      ) values ($1, 'dobro', $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8,
        $9::jsonb, $10::jsonb, $11::timestamptz, $11::timestamptz, case when $7 then null else now() end, now())
      on conflict (id) do update set
        source_url = excluded.source_url,
        title = excluded.title,
        city = excluded.city,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        is_active = excluded.is_active,
        content_hash = excluded.content_hash,
        raw_data = excluded.raw_data,
        catalog_data = excluded.catalog_data,
        last_seen_at = excluded.last_seen_at,
        retired_at = excluded.retired_at,
        updated_at = now()
    `, [catalog.id, catalog.url, catalog.title, catalog.city, catalog.startsAt, catalog.endsAt, isActive, hashJson({ event, vacancies }), JSON.stringify(event), JSON.stringify(catalog), seenAt]);

    for (const city of matchedCities) {
      await client.query(`
        insert into event_cities (event_id, city, last_seen_at) values ($1, $2, $3::timestamptz)
        on conflict (event_id, city) do update set last_seen_at = excluded.last_seen_at
      `, [catalog.id, city, seenAt]);
    }

    const seenVacancyIds = [];
    for (const vacancy of vacancies) {
      if (vacancy.id == null) continue;
      const vacancyId = String(vacancy.id);
      seenVacancyIds.push(vacancyId);
      const subject = annotationSubject(event, vacancy, matchedCities);
      const inputHash = annotationInputHash(subject);
      const vacancyActive = isActive && !vacancy.deleted && !vacancy.hidden && !vacancy.archive;
      await client.query(`
        insert into vacancies (
          id, event_id, source_url, title, is_active, input_hash, raw_data,
          first_seen_at, last_seen_at, retired_at, updated_at
        ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $8::timestamptz,
          case when $5 then null else now() end, now())
        on conflict (id) do update set
          event_id = excluded.event_id,
          source_url = excluded.source_url,
          title = excluded.title,
          is_active = excluded.is_active,
          input_hash = excluded.input_hash,
          raw_data = excluded.raw_data,
          last_seen_at = excluded.last_seen_at,
          retired_at = excluded.retired_at,
          updated_at = now()
      `, [vacancyId, catalog.id, subject.sourceUrl, vacancy.name || event.name || null, vacancyActive, inputHash, JSON.stringify(vacancy), seenAt]);
      if (vacancyActive) {
        const queuedResult = await client.query(`
        insert into annotation_jobs (vacancy_id, status, attempts, available_at, locked_at, last_error, updated_at)
        select $1, 'pending', 0, now(), null, null, now()
        where not exists (
          select 1 from event_annotations where vacancy_id = $1 and input_hash = $2
        )
        on conflict (vacancy_id) do update set
          status = 'pending', attempts = 0, available_at = now(), locked_at = null, last_error = null, updated_at = now()
      `, [vacancyId, inputHash]);
        queued += queuedResult.rowCount;
      }
    }

    if (seenVacancyIds.length) {
      await client.query(`
        update vacancies set is_active = false, retired_at = coalesce(retired_at, now()), updated_at = now()
        where event_id = $1 and not (id = any($2::text[]))
      `, [catalog.id, seenVacancyIds]);
    } else {
      await client.query("update vacancies set is_active = false, retired_at = coalesce(retired_at, now()), updated_at = now() where event_id = $1", [catalog.id]);
    }
    await client.query("commit");
    return { eventId: catalog.id, vacancies: vacancies.length, queued };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function runCatalogSync({ pool, client = createDobroClient(), cities = dobroCities(), concurrency = 4 } = {}) {
  const lockClient = await pool.connect();
  let runId = null;
  try {
    const locked = (await lockClient.query("select pg_try_advisory_lock(hashtext('dobro_catalog_sync')) as locked")).rows[0].locked;
    if (!locked) return { status: "skipped", reason: "another catalog sync is running" };
    await pool.query(`
      update sync_runs
      set status = 'failed', error = 'Worker stopped before the sync completed', finished_at = now()
      where kind = 'dobro_catalog' and status = 'running'
    `);
    const startedAt = new Date().toISOString();
    runId = (await pool.query(`
      insert into sync_runs (kind, status, scope) values ('dobro_catalog', 'running', $1::jsonb) returning id
    `, [JSON.stringify({ cities: cities.map((city) => city.name) })])).rows[0].id;

    const searches = [];
    for (const city of cities) searches.push(await client.searchCity(city));
    const cityByEvent = new Map();
    for (const search of searches) for (const eventId of search.eventIds) {
      if (!cityByEvent.has(eventId)) cityByEvent.set(eventId, []);
      cityByEvent.get(eventId).push(search.city.name);
    }
    const eventIds = [...cityByEvent.keys()];
    const counters = { searchedEvents: eventIds.length, searchedVacancies: searches.reduce((sum, item) => sum + item.vacancyIds.length, 0), importedEvents: 0, importedVacancies: 0, queuedAnnotations: 0, detailErrors: 0 };
    const errors = [];
    await mapConcurrent(eventIds, Math.max(1, Math.min(8, concurrency)), async (eventId) => {
      try {
        const [event, vacancies] = await Promise.all([client.event(eventId), client.vacancies(eventId)]);
        const result = await upsertActivity(pool, { event, vacancies, matchedCities: cityByEvent.get(eventId), seenAt: startedAt });
        counters.importedEvents += 1;
        counters.importedVacancies += result.vacancies;
        counters.queuedAnnotations += result.queued;
      } catch (error) {
        counters.detailErrors += 1;
        errors.push({ eventId, error: error.message });
      }
    });

    // Never hide the whole catalog after a transient empty search response.
    // A non-empty result set is required before stale rows are retired.
    if (eventIds.length) {
      const scope = cities.map((city) => city.name);
      await pool.query(`
        update events e
        set is_active = false, retired_at = coalesce(retired_at, now()), updated_at = now()
        where e.source = 'dobro'
          and exists (select 1 from event_cities ec where ec.event_id = e.id and ec.city = any($1::text[]))
          and not (e.id = any($3::text[]))
          and not exists (
            select 1 from event_cities ec
            where ec.event_id = e.id and ec.city = any($1::text[]) and ec.last_seen_at >= $2::timestamptz
          )
      `, [scope, startedAt, eventIds]);
    }
    await pool.query(`
      update events set is_active = false, retired_at = coalesce(retired_at, now()), updated_at = now()
      where is_active and ends_at is not null and ends_at <= now()
    `);
    await pool.query(`
      update vacancies v set is_active = false, retired_at = coalesce(v.retired_at, now()), updated_at = now()
      where v.is_active and not exists (select 1 from events e where e.id = v.event_id and e.is_active)
    `);
    await pool.query(`
      update sync_runs set status = 'completed', counters = $2::jsonb, error = $3, finished_at = now() where id = $1
    `, [runId, JSON.stringify(counters), errors.length ? JSON.stringify(errors.slice(0, 20)) : null]);
    return { status: "completed", runId, counters, errors };
  } catch (error) {
    if (runId) await pool.query("update sync_runs set status = 'failed', error = $2, finished_at = now() where id = $1", [runId, error.message]).catch(() => {});
    throw error;
  } finally {
    await lockClient.query("select pg_advisory_unlock(hashtext('dobro_catalog_sync'))").catch(() => {});
    lockClient.release();
  }
}
