import { createPool, runMigrations } from "../server/database.js";
import { createCatalogRepository } from "../server/catalog-repository.js";
import { processAnnotationQueue, recoverStaleAnnotationJobs } from "../server/annotation-worker.js";

const pool = createPool({ applicationName: "dobrie_dela_manual_annotations" });
try {
  await runMigrations(pool);
  const catalogRepository = createCatalogRepository(pool);
  await recoverStaleAnnotationJobs(pool);
  const result = await processAnnotationQueue({
    pool,
    catalogRepository,
    concurrency: Number.parseInt(process.env.ANNOTATION_CONCURRENCY || "5", 10),
    maxJobs: Number.parseInt(process.env.ANNOTATION_BATCH_SIZE || "100", 10),
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}

