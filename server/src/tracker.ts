import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { ApplicationRecord } from "./types.js";

const DEFAULT_STORE = new URL("../data/applications.json", import.meta.url).pathname;

function storePath(): string {
  return process.env.JOB_AGENT_DATA ?? DEFAULT_STORE;
}

export function jobIdFor(url: string): string {
  // Strip querystring/tracking params so the same posting isn't treated as
  // "new" just because it was found via a different search/referrer link.
  const clean = url.split("?")[0].replace(/\/$/, "");
  return createHash("sha256").update(clean).digest("hex").slice(0, 16);
}

async function readStore(): Promise<ApplicationRecord[]> {
  const path = storePath();
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as ApplicationRecord[];
  } catch {
    return [];
  }
}

async function writeStore(records: ApplicationRecord[]): Promise<void> {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(records, null, 2), "utf-8");
}

/** Returns the existing record if this job URL was already applied to/prefilled, else undefined. */
export async function findExisting(url: string): Promise<ApplicationRecord | undefined> {
  const id = jobIdFor(url);
  const records = await readStore();
  return records.find((r) => r.id === id);
}

export async function recordApplication(record: Omit<ApplicationRecord, "id" | "appliedAt">): Promise<ApplicationRecord> {
  const full: ApplicationRecord = {
    ...record,
    id: jobIdFor(record.url),
    appliedAt: new Date().toISOString(),
  };
  const records = await readStore();
  const idx = records.findIndex((r) => r.id === full.id);
  if (idx >= 0) {
    records[idx] = full;
  } else {
    records.push(full);
  }
  await writeStore(records);
  return full;
}

export async function listApplications(): Promise<ApplicationRecord[]> {
  return readStore();
}
