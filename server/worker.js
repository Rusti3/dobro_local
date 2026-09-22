import { createPool, runMigrations } from "./database.js";
import { createStore } from "./store.js";
import { createCatalogRepository } from "./catalog-repository.js";
import { runCatalogSync } from "./catalog-sync.js";
import { processAnnotationQueue, recoverStaleAnnotationJobs } from "./annotation-worker.js";

const pool = createPool({ applicationName: "dobrie_dela_worker" });
await runMigrations(pool);
const store = createStore(pool);
const catalogRepository = createCatalogRepository(pool);
await catalogRepository.seedFromBundledCatalog();
await recoverStaleAnnotationJobs(pool);

const syncEnabled = process.env.CATALOG_SYNC_ENABLED !== "false";
const syncOnStart = process.env.CATALOG_SYNC_ON_START !== "false";
const syncInterval = Math.max(60_000, Number.parseInt(process.env.CATALOG_SYNC_INTERVAL_MS || "3600000", 10));
const annotationPollInterval = Math.max(5_000, Number.parseInt(process.env.ANNOTATION_POLL_INTERVAL_MS || "15000", 10));
const annotationConcurrency = Math.max(1, Math.min(20, Number.parseInt(process.env.ANNOTATION_CONCURRENCY || "5", 10)));
const annotationBatchSize = Math.max(1, Number.parseInt(process.env.ANNOTATION_BATCH_SIZE || "100", 10));

let stopping = false;
let nextSyncAt = syncOnStart ? 0 : Date.now() + syncInterval;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const writeHeartbeat = () => store.setMeta("worker_heartbeat", new Date().toISOString())
  .catch((error) => console.error("Worker heartbeat failed:", error.message));
const heartbeatTimer = setInterval(writeHeartbeat, 30_000);
heartbeatTimer.unref();

console.log(JSON.stringify({
  service: "worker",
  syncEnabled,
  syncOnStart,
  syncInterval,
  annotationConcurrency,
  annotationBatchSize,
}));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { stopping = true; });
}

while (!stopping) {
  try {
    await writeHeartbeat();
    if (syncEnabled && Date.now() >= nextSyncAt) {
      const result = await runCatalogSync({ pool, concurrency: Number.parseInt(process.env.DOBRO_CONCURRENCY || "4", 10) });
      await store.setMeta("last_catalog_sync", JSON.stringify({ ...result, at: new Date().toISOString() }));
      console.log("Catalog sync:", JSON.stringify(result));
      nextSyncAt = Date.now() + syncInterval;
    }
    const annotations = await processAnnotationQueue({
      pool,
      catalogRepository,
      concurrency: annotationConcurrency,
      maxJobs: annotationBatchSize,
    });
    await store.setMeta("last_annotation_batch", JSON.stringify({ ...annotations, at: new Date().toISOString() }));
    if (annotations.completed || annotations.failed) console.log("Annotation batch:", JSON.stringify(annotations));
  } catch (error) {
    console.error("Worker cycle failed:", error);
    await store.setMeta("last_worker_error", JSON.stringify({ message: error.message, at: new Date().toISOString() })).catch(() => {});
    if (Date.now() >= nextSyncAt) nextSyncAt = Date.now() + Math.min(syncInterval, 5 * 60_000);
  }
  await sleep(annotationPollInterval);
}

clearInterval(heartbeatTimer);
await store.close();
