import { createPool, runMigrations } from "../server/database.js";
import { createCatalogRepository } from "../server/catalog-repository.js";

const pool = createPool({ applicationName: "dobrie_dela_migrate" });
try {
  await runMigrations(pool);
  const seeded = await createCatalogRepository(pool).seedFromBundledCatalog();
  console.log(JSON.stringify({ ok: true, seeded }));
} finally {
  await pool.end();
}

