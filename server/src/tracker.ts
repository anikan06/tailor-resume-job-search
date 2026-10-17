import { createHash } from "node:crypto";
import type { ApplicationRecord } from "./types.js";
import { getDb } from "./db.js";

export function jobIdFor(url: string): string {
  // Strip querystring/tracking params so the same posting isn't treated as
  // "new" just because it was found via a different search/referrer link.
  const clean = url.split("?")[0].replace(/\/$/, "");
  return createHash("sha256").update(clean).digest("hex").slice(0, 16);
}

function parseRows(rows: unknown[]): ApplicationRecord[] {
  return (rows as Array<{ data: string }>).map((row) => JSON.parse(row.data) as ApplicationRecord);
}

/** Returns the existing record if this job URL was already applied to/prefilled, else undefined. */
export async function findExisting(url: string): Promise<ApplicationRecord | undefined> {
  const record = await getRecord(url);
  // A resume tailored for the user to apply with by hand isn't an application.
  return record?.status === "tailored" ? undefined : record;
}

/** This job URL's tracker record of any status, including "tailored". */
export async function getRecord(url: string): Promise<ApplicationRecord | undefined> {
  const row = getDb().prepare("SELECT data FROM applications WHERE id = ?").get(jobIdFor(url));
  return row ? parseRows([row])[0] : undefined;
}

export async function recordApplication(record: Omit<ApplicationRecord, "id" | "appliedAt">): Promise<ApplicationRecord> {
  const full: ApplicationRecord = {
    ...record,
    id: jobIdFor(record.url),
    appliedAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO applications (id, url, platform, status, applied_at, data) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET url = excluded.url, platform = excluded.platform, status = excluded.status,
         applied_at = excluded.applied_at, data = excluded.data`
    )
    .run(full.id, full.url, full.platform, full.status, full.appliedAt, JSON.stringify(full));
  return full;
}

/** Oldest first, matching the order records were added. */
export async function listApplications(): Promise<ApplicationRecord[]> {
  return parseRows(getDb().prepare("SELECT data FROM applications ORDER BY applied_at").all());
}
