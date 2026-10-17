import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";

/** Single SQLite file holding applications, LLM usage, the jobs cache and app state.
 * Uploaded/tailored resume files stay on disk under data/; only their paths live here. */

const DB_PATH = process.env.JOB_AGENT_DB ?? new URL("../data/app.db", import.meta.url).pathname;

/** Where the pre-SQLite JSON stores lived, imported once on first open. */
const LEGACY = {
  applications: process.env.JOB_AGENT_DATA ?? new URL("../data/applications.json", import.meta.url).pathname,
  usage: process.env.JOB_AGENT_USAGE ?? new URL("../data/llm-usage.jsonl", import.meta.url).pathname,
  state: process.env.JOB_AGENT_STATE ?? new URL("../data/state.json", import.meta.url).pathname,
  jobsCache: process.env.JOB_AGENT_CACHE ?? new URL("../data/jobs-cache.json", import.meta.url).pathname,
};

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  // WAL lets the HTTP server and the scheduler read while the other writes;
  // busy_timeout makes a contended write wait instead of failing.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS applications (
      id         TEXT PRIMARY KEY,
      url        TEXT NOT NULL,
      platform   TEXT NOT NULL,
      status     TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      data       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS llm_usage (
      seq      INTEGER PRIMARY KEY AUTOINCREMENT,
      at       TEXT NOT NULL,
      provider TEXT NOT NULL,
      model    TEXT NOT NULL,
      activity TEXT NOT NULL,
      job_id   TEXT,
      data     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS llm_usage_job ON llm_usage(job_id);

    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  migrateLegacyFiles(db);
  return db;
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export function transaction<T>(fn: () => T): T {
  const conn = getDb();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}

export function kvGet<T>(key: string): T | undefined {
  const row = getDb().prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

export function kvSet(key: string, value: unknown): void {
  getDb()
    .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}

/** Imports any old JSON/JSONL store into the database, then renames it to *.migrated so it's kept but not re-imported. */
function migrateLegacyFiles(conn: DatabaseSync): void {
  const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf-8"));
  const steps: Array<[string, () => void]> = [
    [
      LEGACY.applications,
      () => {
        const insert = conn.prepare(
          "INSERT OR REPLACE INTO applications (id, url, platform, status, applied_at, data) VALUES (?, ?, ?, ?, ?, ?)"
        );
        for (const r of readJson(LEGACY.applications) as Array<Record<string, string>>) {
          insert.run(r.id, r.url, r.platform, r.status, r.appliedAt, JSON.stringify(r));
        }
      },
    ],
    [
      LEGACY.usage,
      () => {
        const insert = conn.prepare(
          "INSERT INTO llm_usage (at, provider, model, activity, job_id, data) VALUES (?, ?, ?, ?, ?, ?)"
        );
        for (const line of readFileSync(LEGACY.usage, "utf-8").split("\n")) {
          if (!line.trim()) continue;
          try {
            const r = JSON.parse(line) as Record<string, string>;
            insert.run(r.at, r.provider, r.model, r.activity, r.jobId ?? null, line);
          } catch {
            // Skip a torn line rather than abandon the whole import.
          }
        }
      },
    ],
    [LEGACY.state, () => kvSet("state", readJson(LEGACY.state))],
    [LEGACY.jobsCache, () => kvSet("jobs_cache", readJson(LEGACY.jobsCache))],
  ];

  for (const [path, importFile] of steps) {
    if (!existsSync(path)) continue;
    try {
      transaction(importFile);
    } catch (err) {
      console.error(`[job-search-agent] couldn't import ${path}: ${(err as Error).message}`);
      continue;
    }
    renameSync(path, `${path}.migrated`);
    console.error(`[job-search-agent] imported ${path} into ${DB_PATH}`);
  }
}
