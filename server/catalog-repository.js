import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { compareAnnotationRecords } from "./annotation-projection.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hashJson = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createCatalogRepository(pool) {
  return {
    async seedFromBundledCatalog() {
      const file = path.join(root, "data", "catalog.json");
      if (!fs.existsSync(file)) return 0;
      const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!catalog.length) return 0;
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (const event of catalog) {
          await client.query(`
            insert into events (
              id, source, source_url, title, city, starts_at, ends_at, is_active,
              content_hash, raw_data, catalog_data, first_seen_at, last_seen_at, updated_at
            ) values ($1, 'dobro', $2, $3, $4, $5::timestamptz, $6::timestamptz,
              coalesce($6::timestamptz, now() + interval '100 years') > now(), $7, null, $8::jsonb, now(), now(), now())
            on conflict (id) do nothing
          `, [event.id, event.url || null, event.title, event.city || null, event.startsAt || null, event.endsAt || null, hashJson(event), JSON.stringify(event)]);
          if (event.city) await client.query(`
            insert into event_cities (event_id, city, last_seen_at) values ($1, $2, now())
            on conflict (event_id, city) do nothing
          `, [event.id, event.city]);
        }
        await client.query("commit");
        return catalog.length;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async listActive() {
      const result = await pool.query(`
        select catalog_data
        from events
        where is_active
          and (ends_at is null or ends_at > now())
        order by coalesce(starts_at, first_seen_at), id
      `);
      return result.rows.map((row) => row.catalog_data);
    },

    async event(id) {
      const result = await pool.query("select catalog_data from events where id = $1", [String(id)]);
      return result.rows[0]?.catalog_data ?? null;
    },

    async counts() {
      const result = await pool.query(`
        select
          count(*) filter (where is_active and (ends_at is null or ends_at > now()))::int as active_events,
          count(*)::int as total_events,
          (select count(*)::int from vacancies where is_active) as active_vacancies,
          (select count(*)::int from event_annotations) as annotations,
          (select count(*)::int from annotation_jobs where status = 'pending') as pending_annotations
        from events
      `);
      return result.rows[0];
    },

    async refreshEventProjection(eventId) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        // Several vacancies of one event can finish in parallel. Serialize the
        // projection so the last writer never drops a just-finished alternative.
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [`annotation_projection:${String(eventId)}`]);
        const result = await client.query(`
          select a.annotation, a.compact_annotation, v.id as vacancy_id
          from event_annotations a
          join vacancies v on v.id = a.vacancy_id
          where a.event_id = $1 and v.is_active
        `, [String(eventId)]);
        if (!result.rows.length) {
          await client.query("commit");
          return;
        }
        const records = result.rows.map((row) => ({
          ...row.annotation,
          semantic: row.annotation.semantic,
          sourceFacts: row.annotation.sourceFacts,
          compact: row.compact_annotation,
        })).sort(compareAnnotationRecords);
        const best = { ...records[0].compact, alternativesCount: records.length };
        await client.query(`
          update events
          set catalog_data = jsonb_set(
                jsonb_set(catalog_data, '{annotation}', $2::jsonb, true),
                '{themes}',
                to_jsonb((array(select distinct value from jsonb_array_elements_text(
                  coalesce(catalog_data->'themes', '[]'::jsonb) || to_jsonb($3::text[])
                ) as value))[1:8]),
                true
              ),
              updated_at = now()
          where id = $1
        `, [String(eventId), JSON.stringify(best), best.themeIds || []]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
