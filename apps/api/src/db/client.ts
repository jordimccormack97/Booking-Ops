import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { optionalEnv } from "../lib/env";
import { log } from "../lib/logger";

const MIGRATIONS_DIR = resolve(import.meta.dir, "migrations");

/**
 * Initializes SQLite client and applies pending migrations.
 */
export function createDbClient() {
  const dbPath = optionalEnv("SQLITE_DB_PATH", "data/bookings.sqlite");
  const absolutePath = dbPath === ":memory:" ? dbPath : resolve(process.cwd(), dbPath);
  if (absolutePath !== ":memory:") {
    mkdirSync(dirname(absolutePath), { recursive: true });
  }

  const db = new Database(absolutePath);
  db.exec(
    "create table if not exists _migrations (name text primary key, appliedAt text not null default (datetime('now')))",
  );

  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const fileName of migrationFiles) {
    const exists = db.prepare("select 1 from _migrations where name = ?").get(fileName);
    if (exists) continue;

    const sql = readFileSync(resolve(MIGRATIONS_DIR, fileName), "utf8");
    db.exec(sql);
    db.prepare("insert into _migrations(name) values (?)").run(fileName);
    log("info", "[DB_MIGRATION] applied", { fileName });
  }

  return db;
}
