import { annotationInputHash } from "../scripts/lib/annotation-contract.js";
import { compactUsage, createResponse, responseOutputText } from "../scripts/lib/responses-client.js";
import {
  buildSemanticRequest,
  deterministicSourceFacts,
  highReviewReason,
  normalizeSemanticComplexity,
  semanticConfig,
  validateSemanticAnnotation,
} from "../scripts/lib/semantic-annotation-contract.js";
import { compactAnnotation } from "./annotation-projection.js";
import { annotationSubject } from "./catalog-sync.js";

async function runPass(subject, reasoningEffort, reviewReason, responseClient) {
  let validationErrors = [];
  let response = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const request = buildSemanticRequest(subject, { evidenceMode: "none", reasoningEffort, reviewReason });
    if (attempt > 1) request.instructions += `\n\nИсправь только нарушения формата: ${validationErrors.join("; ")}. Не используй их как источник фактов.`;
    response = await responseClient(request);
    const text = responseOutputText(response);
    if (!text) throw new Error("LLM returned no output text");
    let semantic;
    try { semantic = normalizeSemanticComplexity(JSON.parse(text)); }
    catch (error) { validationErrors = [`invalid JSON: ${error.message}`]; continue; }
    validationErrors = validateSemanticAnnotation(semantic, subject, { evidenceMode: "none" });
    if (!validationErrors.length) return { semantic, response };
  }
  throw new Error(`Semantic validation failed: ${validationErrors.join("; ")}`);
}

export async function annotateSubject(subject, options = {}) {
  const responseClient = options.responseClient || ((request) => createResponse(request));
  const primary = await runPass(subject, semanticConfig.primaryReasoningEffort, null, responseClient);
  const reviewReason = highReviewReason(primary.semantic, subject);
  const final = reviewReason
    ? await runPass(subject, semanticConfig.reviewReasoningEffort, reviewReason, responseClient)
    : primary;
  const facts = deterministicSourceFacts(subject);
  const record = {
    key: `${facts.eventId}:${facts.vacancyId ?? "event"}`,
    eventId: facts.eventId,
    vacancyId: facts.vacancyId,
    eventTitle: subject.event?.name || subject.event?.title || "",
    sourceUrl: facts.sourceUrl,
    matchedCities: facts.matchedCities,
    inputHash: annotationInputHash(subject),
    schemaVersion: semanticConfig.schemaVersion,
    model: process.env.LLM_MODEL || semanticConfig.model,
    evidenceMode: "none",
    reasoning: {
      primaryEffort: semanticConfig.primaryReasoningEffort,
      primaryResponseId: primary.response?.id || null,
      reviewRequired: Boolean(reviewReason),
      reviewReason: reviewReason || null,
      reviewEffort: reviewReason ? semanticConfig.reviewReasoningEffort : null,
      reviewResponseId: reviewReason ? final.response?.id || null : null,
    },
    usage: { primary: compactUsage(primary.response?.usage), review: reviewReason ? compactUsage(final.response?.usage) : null },
    annotatedAt: new Date().toISOString(),
    sourceFacts: facts,
    semantic: final.semantic,
  };
  return { record, compact: compactAnnotation(record, 1) };
}

async function claimJob(pool) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(`
      select j.vacancy_id, j.attempts, v.event_id, v.input_hash, v.raw_data as vacancy,
        e.raw_data as event,
        coalesce((select array_agg(ec.city order by ec.city) from event_cities ec where ec.event_id = e.id), array[]::text[]) as matched_cities
      from annotation_jobs j
      join vacancies v on v.id = j.vacancy_id and v.is_active
      join events e on e.id = v.event_id and e.is_active
      where j.status = 'pending' and j.available_at <= now()
      order by j.available_at, j.created_at
      for update of j skip locked
      limit 1
    `);
    const row = result.rows[0];
    if (!row) { await client.query("commit"); return null; }
    await client.query(`
      update annotation_jobs set status = 'processing', attempts = attempts + 1, locked_at = now(), updated_at = now()
      where vacancy_id = $1
    `, [row.vacancy_id]);
    await client.query("commit");
    return { ...row, attempts: row.attempts + 1 };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function completeJob(pool, job, record, compact) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query("select input_hash from vacancies where id = $1 for update", [job.vacancy_id]);
    if (current.rows[0]?.input_hash !== record.inputHash) {
      await client.query("update annotation_jobs set status = 'pending', attempts = 0, available_at = now(), locked_at = null, updated_at = now() where vacancy_id = $1", [job.vacancy_id]);
      await client.query("commit");
      return false;
    }
    await client.query(`
      insert into event_annotations (
        vacancy_id, event_id, input_hash, schema_version, model, quality_status,
        review_required, annotation, compact_annotation, annotated_at, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::timestamptz, now())
      on conflict (vacancy_id) do update set
        event_id = excluded.event_id,
        input_hash = excluded.input_hash,
        schema_version = excluded.schema_version,
        model = excluded.model,
        quality_status = excluded.quality_status,
        review_required = excluded.review_required,
        annotation = excluded.annotation,
        compact_annotation = excluded.compact_annotation,
        annotated_at = excluded.annotated_at,
        updated_at = now()
    `, [job.vacancy_id, job.event_id, record.inputHash, record.schemaVersion, record.model, record.semantic.quality.status, record.reasoning.reviewRequired, JSON.stringify(record), JSON.stringify(compact), record.annotatedAt]);
    await client.query("update annotation_jobs set status = 'completed', locked_at = null, last_error = null, updated_at = now() where vacancy_id = $1", [job.vacancy_id]);
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function failJob(pool, job, error, maxAttempts) {
  const terminal = job.attempts >= maxAttempts;
  const delayMinutes = Math.min(60, 2 ** Math.max(0, job.attempts - 1));
  await pool.query(`
    update annotation_jobs
    set status = $2,
        available_at = case when $2 = 'pending' then now() + ($3 * interval '1 minute') else available_at end,
        locked_at = null,
        last_error = left($4, 4000),
        updated_at = now()
    where vacancy_id = $1
  `, [job.vacancy_id, terminal ? "failed" : "pending", delayMinutes, error.message]);
}

export async function recoverStaleAnnotationJobs(pool) {
  const result = await pool.query(`
    update annotation_jobs
    set status = 'pending', locked_at = null, available_at = now(), updated_at = now()
    where status = 'processing' and locked_at < now() - interval '20 minutes'
  `);
  return result.rowCount;
}

export async function processAnnotationQueue({ pool, catalogRepository, concurrency = 5, maxJobs = 100, maxAttempts = 5, responseClient } = {}) {
  if (!responseClient && (!process.env.LLM_API_KEY || !process.env.LLM_BASE_URL)) return { status: "paused", reason: "LLM_API_KEY or LLM_BASE_URL is missing", completed: 0, failed: 0 };
  let claimed = 0;
  let completed = 0;
  let failed = 0;
  const errors = [];
  async function worker() {
    while (claimed < maxJobs) {
      claimed += 1;
      const job = await claimJob(pool);
      if (!job) return;
      try {
        const subject = annotationSubject(job.event, job.vacancy, job.matched_cities);
        const { record, compact } = await annotateSubject(subject, { responseClient });
        if (await completeJob(pool, job, record, compact)) {
          await catalogRepository.refreshEventProjection(job.event_id);
          completed += 1;
        }
      } catch (error) {
        failed += 1;
        errors.push({ vacancyId: job.vacancy_id, error: error.message });
        await failJob(pool, job, error, maxAttempts);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(20, concurrency)) }, worker));
  return { status: "completed", completed, failed, errors };
}
