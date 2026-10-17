import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AggregatedJob, JobListing, Profile } from "./types.js";
import { jobIdFor, findExisting } from "./tracker.js";
import { canAutoSubmit } from "./policy.js";
import { searchGreenhouse, searchLever } from "./platforms/ats.js";
import { searchLinkedInJobs } from "./platforms/linkedin.js";
import { searchNaukriJobs } from "./platforms/naukri.js";
import { searchIndeedJobs } from "./platforms/indeed.js";
import { searchGoogleJobs } from "./platforms/google.js";

const CACHE_PATH = process.env.JOB_AGENT_CACHE ?? new URL("../data/jobs-cache.json", import.meta.url).pathname;

export interface AggregationSourceError {
  source: string;
  message: string;
}

export interface AggregationResult {
  jobs: AggregatedJob[];
  errors: AggregationSourceError[];
  aggregatedAt: string;
}

/** Simple keyword-overlap relevance score, 0-100. No AI call - this runs on every aggregation, cheap and free. */
export function scoreRelevance(job: JobListing, resumeText: string, keywords: string[]): number {
  const haystack = `${job.title} ${job.company} ${job.snippet ?? ""}`.toLowerCase();
  const resumeLower = resumeText.toLowerCase();
  const terms = new Set(
    [...keywords, ...job.title.toLowerCase().split(/\W+/)].filter((t) => t.length > 2)
  );
  if (terms.size === 0) return 50;

  let hits = 0;
  for (const term of terms) {
    if (resumeLower.includes(term) || haystack.includes(term)) hits++;
  }
  return Math.min(100, Math.round((hits / terms.size) * 100));
}

export async function aggregateJobs(profile: Profile, resumeText: string): Promise<AggregationResult> {
  const errors: AggregationSourceError[] = [];
  const keywords = profile.search?.keywords ?? [];
  const locations = profile.search?.locations ?? [""];
  const location = locations[0] ?? "";

  const raw: JobListing[] = [];

  for (const token of profile.boards?.greenhouse ?? []) {
    try {
      raw.push(...(await searchGreenhouse(token, keywords)));
    } catch (err) {
      errors.push({ source: `greenhouse:${token}`, message: (err as Error).message });
    }
  }

  for (const company of profile.boards?.lever ?? []) {
    try {
      raw.push(...(await searchLever(company, keywords)));
    } catch (err) {
      errors.push({ source: `lever:${company}`, message: (err as Error).message });
    }
  }

  if (keywords.length > 0) {
    try {
      raw.push(...(await searchLinkedInJobs(keywords, location)));
    } catch (err) {
      errors.push({ source: "linkedin", message: `${(err as Error).message} (run ./chrome-debug.sh and log in to that site in the window it opens)` });
    }
    try {
      raw.push(...(await searchNaukriJobs(keywords, location)));
    } catch (err) {
      errors.push({ source: "naukri", message: `${(err as Error).message} (run ./chrome-debug.sh and log in to that site in the window it opens)` });
    }
    try {
      raw.push(...(await searchIndeedJobs(keywords, location)));
    } catch (err) {
      errors.push({ source: "indeed", message: `${(err as Error).message} (run ./chrome-debug.sh and log in to that site in the window it opens)` });
    }
    try {
      raw.push(...(await searchGoogleJobs(keywords, location)));
    } catch (err) {
      errors.push({ source: "google", message: `${(err as Error).message} (run ./chrome-debug.sh first)` });
    }
  }

  const excluded = new Set((profile.search?.exclude_companies ?? []).map((c) => c.toLowerCase()));

  const enriched: AggregatedJob[] = [];
  for (const job of raw) {
    if (excluded.has(job.company.toLowerCase())) continue;
    const existing = await findExisting(job.url);
    enriched.push({
      ...job,
      id: jobIdFor(job.url),
      relevanceScore: scoreRelevance(job, resumeText, keywords),
      alreadyApplied: Boolean(existing),
      autoSubmitEligible: canAutoSubmit(job.platform),
    });
  }

  // De-dupe by id (same job can surface from more than one search) and rank best-first.
  const byId = new Map<string, AggregatedJob>();
  for (const job of enriched) {
    const current = byId.get(job.id);
    if (!current || job.relevanceScore > current.relevanceScore) byId.set(job.id, job);
  }
  const jobs = [...byId.values()].sort((a, b) => b.relevanceScore - a.relevanceScore);

  const result: AggregationResult = { jobs, errors, aggregatedAt: new Date().toISOString() };
  persistCache(result);
  return result;
}

function persistCache(result: AggregationResult): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(result, null, 2), "utf-8");
  } catch (err) {
    console.error("[job-search-agent] Failed to persist jobs cache:", err);
  }
}

export function readCachedAggregation(): AggregationResult | undefined {
  if (!existsSync(CACHE_PATH)) return undefined;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as AggregationResult;
  } catch {
    return undefined;
  }
}
