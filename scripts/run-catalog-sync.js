import { createPool, runMigrations } from "../server/database.js";
import { createCatalogRepository } from "../server/catalog-repository.js";
import { runCatalogSync } from "../server/catalog-sync.js";

const pool = createPool({ applicationName: "dobrie_dela_manual_sync" });
try {
  await runMigrations(pool);
  await createCatalogRepository(pool).seedFromBundledCatalog();
  const result = await runCatalogSync({ pool, concurrency: Number.parseInt(process.env.DOBRO_CONCURRENCY || "4", 10) });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}

