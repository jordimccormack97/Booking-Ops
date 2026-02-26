import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { optionalEnv } from "../lib/env";
import { log } from "../lib/logger";

const MIGRATIONS_DIR = resolve(import.meta.dir, "migrations");

/**
 * Initializes the SQLite database and applies SQL migrations.
 */
export function initDatabase() {
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
    const alreadyApplied = db
      .prepare("select 1 from _migrations where name = ?")
      .get(fileName) as Record<string, unknown> | null;
    if (alreadyApplied) continue;

    const sql = readFileSync(resolve(MIGRATIONS_DIR, fileName), "utf8");
    db.exec(sql);
    db.prepare("insert into _migrations(name) values (?)").run(fileName);
    log("info", "db.migration.applied", { fileName });
  }

  return db;
}
