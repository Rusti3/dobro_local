import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = process.env.DB_SCHEMA || "app";

if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("DB_SCHEMA must be a lowercase PostgreSQL identifier");

export function createPool(options = {}) {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required. Start PostgreSQL with docker compose up.");
  const pool = new Pool({
    connectionString,
    max: Number.parseInt(process.env.DB_POOL_SIZE || "10", 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: false,
    application_name: options.applicationName || process.env.DB_APPLICATION_NAME || "dobrie_dela_app",
    options: `-c search_path=${schema},public -c statement_timeout=30000 -c idle_in_transaction_session_timeout=15000`,
  });
  pool.on("error", (error) => console.error("PostgreSQL pool error:", error.message));
  return pool;
}

export async function runMigrations(pool) {
  const migrationsDir = path.join(root, "server", "migrations");
  const files = fs.readdirSync(migrationsDir).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('dobrie_dela_migrations'))");
    await client.query(`create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )`);
    const applied = new Set((await client.query("select version from schema_migrations")).rows.map((row) => row.version));
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
      await client.query("insert into schema_migrations(version) values ($1)", [file]);
      console.log(`PostgreSQL migration applied: ${file}`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseHealth(pool) {
  const result = await pool.query("select now() as now, current_database() as database");
  return { ok: true, database: result.rows[0].database, now: result.rows[0].now };
}

