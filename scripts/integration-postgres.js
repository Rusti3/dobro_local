import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, runMigrations } from "../server/database.js";
import { createCatalogRepository } from "../server/catalog-repository.js";
import { runCatalogSync } from "../server/catalog-sync.js";
import { processAnnotationQueue } from "../server/annotation-worker.js";

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");

const pilotPath = path.resolve("D:/des/afisha/razmetka/pilot/annotations.normalized.jsonl");
const firstPilot = JSON.parse(fs.readFileSync(pilotPath, "utf8").split(/\r?\n/).find(Boolean));
const semantic = structuredClone(firstPilot.semantic);
semantic.evidence = [];

const eventId = "integration-test-event";
const vacancyId = "integration-test-vacancy";
const event = {
  id: eventId,
  name: firstPilot.eventTitle || "Тестовая экологическая помощь",
  description: "Тестовая вакансия для проверки импорта, очереди разметки и сохранения результата.",
  categories: firstPilot.sourceFacts.officialCategoryTitles.map((title) => ({ title })),
  tags: [],
  online: firstPilot.sourceFacts.format === "online",
  eventPeriod: {
    startDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    endDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  },
  location: { settlement: "Москва", title: "Онлайн", x: null, y: null },
};
const vacancy = {
  id: vacancyId,
  name: firstPilot.eventTitle || "Тестовая вакансия",
  description: "Тестовая задача с сохранением результата в PostgreSQL.",
  categories: event.categories,
  tasks: firstPilot.sourceFacts.structuredTasks,
  requirements: firstPilot.sourceFacts.structuredRequirements,
  conditions: firstPilot.sourceFacts.organizerConditions,
  online: event.online,
  vacancyPeriod: event.eventPeriod,
  location: event.location,
  deleted: false,
  hidden: false,
  archive: false,
};

const fakeDobro = {
  async searchCity(city) { return { city, eventIds: [eventId], vacancyIds: [vacancyId] }; },
  async event() { return event; },
  async vacancies() { return [vacancy]; },
};

const pool = createPool({ connectionString: databaseUrl, applicationName: "dobrie_dela_integration" });
const repository = createCatalogRepository(pool);
try {
  await runMigrations(pool);
  const sync = await runCatalogSync({
    pool,
    client: fakeDobro,
    cities: [{ name: "Интеграционный тест", settlement: "Москва" }],
    concurrency: 1,
  });
  // Keep the smoke test deterministic when a real worker has already queued
  // hundreds of vacancies: only the synthetic vacancy should be claimable.
  await pool.query("update annotation_jobs set available_at = now() + interval '1 day' where status = 'pending' and vacancy_id <> $1", [vacancyId]);
  const queue = await processAnnotationQueue({
    pool,
    catalogRepository: repository,
    concurrency: 2,
    maxJobs: 5,
    responseClient: async () => ({ id: "integration-response", output_text: JSON.stringify(semantic), usage: {} }),
  });
  const counts = await repository.counts();
  const check = await pool.query(`
    select v.is_active, j.status as annotation_status, a.quality_status,
      (e.catalog_data->'annotation'->>'schemaVersion') as projected_schema
    from app.vacancies v
    left join app.annotation_jobs j on j.vacancy_id = v.id
    left join app.event_annotations a on a.vacancy_id = v.id
    left join app.events e on e.id = v.event_id
    where v.id = $1
  `, [vacancyId]);
  if (!check.rows[0] || check.rows[0].annotation_status !== "completed" || !check.rows[0].projected_schema)
    throw new Error(`Integration assertion failed: ${JSON.stringify(check.rows[0])}`);
  console.log(JSON.stringify({ sync, queue, counts, persisted: check.rows[0] }, null, 2));
} finally {
  await pool.query("update annotation_jobs set available_at = now() where status = 'pending'").catch(() => {});
  await pool.query("delete from events where id = $1", [eventId]).catch(() => {});
  await pool.end();
}
