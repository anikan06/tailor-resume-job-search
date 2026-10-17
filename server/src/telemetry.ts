import type { AiProvider } from "./types.js";
import { getDb } from "./db.js";

/* Every LLM call is logged as a row in the llm_usage table, so token spend can be totalled later. */

/** What an LLM call was made for. */
export type LlmActivity = "tailor_resume" | "extract_resume" | "import_profile" | "read_job";

/** Who's asking, passed down to completeText so the call can be attributed. */
export interface LlmCallContext {
  activity: LlmActivity;
  /** The job a tailor call was for, so its cost can be shown next to that application. */
  jobId?: string;
}

/**
 * Token counts normalised across providers so they can be added up:
 * input includes any cached part, output is the visible reply only, and
 * reasoning ("thinking") is counted separately, so total = input + output + reasoning.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Thinking tokens (OpenAI o-series/GPT-5, Gemini 2.5+); billed as output but reported separately. */
  reasoningTokens?: number;
  /** Part of inputTokens served from the provider's prompt cache (billed at a discount). */
  cachedInputTokens?: number;
  /** Part of inputTokens written to Anthropic's prompt cache (billed at a premium). */
  cacheWriteTokens?: number;
}

/** Rate-limit headroom the provider reported in its response headers (Anthropic and OpenAI only). */
export interface RateLimitSnapshot {
  requestsLimit?: number;
  requestsRemaining?: number;
  requestsReset?: string;
  tokensLimit?: number;
  tokensRemaining?: number;
  tokensReset?: string;
  inputTokensRemaining?: number;
  outputTokensRemaining?: number;
}

/** What the provider said about a call besides token counts. */
export interface CallDetails {
  /** The provider's id for this request, for quoting to their support. */
  requestId?: string;
  /** The exact model version that served the call, which can differ from the alias asked for. */
  responseModel?: string;
  /** Why generation stopped, as the provider names it (end_turn, stop, max_tokens, length, STOP, SAFETY...). */
  stopReason?: string;
  serviceTier?: string;
  httpStatus?: number;
  rateLimit?: RateLimitSnapshot;
}

export interface LlmUsageRecord extends LlmCallContext, TokenUsage, CallDetails {
  at: string;
  provider: AiProvider;
  model: string;
  totalTokens: number;
  durationMs: number;
  /** The output cap sent with the request (Gemini calls send none). */
  maxTokens?: number;
  promptChars: number;
  responseChars: number;
  ok: boolean;
  error?: string;
}

export interface UsageTotals {
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  /** Summed wall-clock time, for averaging. */
  durationMs: number;
}

/** The latest rate-limit headers seen from one provider. */
export interface RateLimitStatus extends RateLimitSnapshot {
  at: string;
  model: string;
}

/** Latency and throughput for one activity, over its successful calls. */
export interface ActivityStats {
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  /** Output (visible + thinking) tokens per second of wall-clock time. */
  outputTokensPerSecond?: number;
  /** Prompt characters per input token, for calls that logged prompt size. */
  promptCharsPerToken?: number;
}

/** Failed calls grouped by error message (numbers ignored, so "retry in 12s" and "retry in 30s" group together). */
export interface ErrorGroup {
  /** The most recent message in the group. */
  message: string;
  count: number;
  lastAt: string;
  activities: LlmActivity[];
  providers: AiProvider[];
}

export interface UsageSummary {
  totals: UsageTotals;
  byActivity: Record<string, UsageTotals>;
  byModel: Record<string, UsageTotals>;
  byProvider: Record<string, UsageTotals>;
  /** How many calls ended for each reason, e.g. { end_turn: 40, max_tokens: 2 }. */
  stopReasons: Record<string, number>;
  rateLimits: Partial<Record<AiProvider, RateLimitStatus>>;
  /** Tailoring tokens keyed by job id. */
  byJob: Record<string, UsageTotals>;
  activityStats: Record<string, ActivityStats>;
  /** Most frequent first. */
  errors: ErrorGroup[];
  /** Keyed by local calendar day (YYYY-MM-DD), oldest first. */
  byDay: Record<string, UsageTotals>;
  recent: LlmUsageRecord[];
}

export function recordLlmUsage(record: LlmUsageRecord): void {
  try {
    getDb()
      .prepare("INSERT INTO llm_usage (at, provider, model, activity, job_id, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run(record.at, record.provider, record.model, record.activity, record.jobId ?? null, JSON.stringify(record));
  } catch (err) {
    // Telemetry must never break the call it's measuring.
    console.error(`[aahvya-job-aggregator] couldn't write LLM usage: ${(err as Error).message}`);
  }
  console.error(
    `[aahvya-job-aggregator] llm ${record.activity} ${record.provider}/${record.model} ` +
      `in=${record.inputTokens} out=${record.outputTokens} ${record.durationMs}ms${record.ok ? "" : " FAILED"}`
  );
}

/** All logged calls, oldest first. */
export function readLlmUsage(): LlmUsageRecord[] {
  const rows = getDb().prepare("SELECT data FROM llm_usage ORDER BY seq").all() as Array<{ data: string }>;
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row.data) as LlmUsageRecord];
    } catch {
      return [];
    }
  });
}

function emptyTotals(): UsageTotals {
  return {
    calls: 0,
    failedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    durationMs: 0,
  };
}

function add(totals: UsageTotals, r: LlmUsageRecord): void {
  totals.calls++;
  if (!r.ok) totals.failedCalls++;
  totals.inputTokens += r.inputTokens;
  totals.outputTokens += r.outputTokens;
  totals.reasoningTokens += r.reasoningTokens ?? 0;
  totals.cachedInputTokens += r.cachedInputTokens ?? 0;
  totals.totalTokens += r.totalTokens;
  totals.durationMs += r.durationMs ?? 0;
}

/** "2026-10-17T03:00:00Z" -> the server's local calendar day, e.g. "2026-10-16". */
function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA");
}

/** Nearest-rank percentile of an ascending list. */
function percentile(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0;
}

function activityStats(records: LlmUsageRecord[]): ActivityStats {
  const ok = records.filter((r) => r.ok && r.durationMs > 0);
  const durations = ok.map((r) => r.durationMs).sort((a, b) => a - b);
  const outTokens = ok.reduce((sum, r) => sum + r.outputTokens + (r.reasoningTokens ?? 0), 0);
  const outMs = ok.reduce((sum, r) => sum + r.durationMs, 0);
  const sized = ok.filter((r) => r.promptChars && r.inputTokens);
  const promptChars = sized.reduce((sum, r) => sum + r.promptChars, 0);
  const promptTokens = sized.reduce((sum, r) => sum + r.inputTokens, 0);
  return {
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: durations.at(-1) ?? 0,
    outputTokensPerSecond: outTokens && outMs ? outTokens / (outMs / 1000) : undefined,
    promptCharsPerToken: promptTokens ? promptChars / promptTokens : undefined,
  };
}

function groupErrors(records: LlmUsageRecord[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const r of records) {
    if (r.ok) continue;
    const message = r.error?.trim() || "Unknown error";
    const key = message.replace(/\d+(\.\d+)?/g, "#");
    const g = groups.get(key) ?? { message, count: 0, lastAt: r.at, activities: [], providers: [] };
    g.count++;
    // Records are in time order, so later ones replace the shown message.
    g.message = message;
    g.lastAt = r.at;
    if (!g.activities.includes(r.activity)) g.activities.push(r.activity);
    if (!g.providers.includes(r.provider)) g.providers.push(r.provider);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

export function summarizeLlmUsage(recentLimit = 50): UsageSummary {
  const records = readLlmUsage();
  const summary: UsageSummary = {
    totals: emptyTotals(),
    byActivity: {},
    byModel: {},
    byProvider: {},
    stopReasons: {},
    rateLimits: {},
    byJob: {},
    activityStats: {},
    errors: groupErrors(records),
    byDay: {},
    recent: [],
  };
  for (const r of records) {
    add(summary.totals, r);
    add((summary.byActivity[r.activity] ??= emptyTotals()), r);
    add((summary.byModel[`${r.provider}/${r.model}`] ??= emptyTotals()), r);
    add((summary.byProvider[r.provider] ??= emptyTotals()), r);
    if (r.stopReason) summary.stopReasons[r.stopReason] = (summary.stopReasons[r.stopReason] ?? 0) + 1;
    // Records are in time order, so the last one with headers wins.
    if (r.rateLimit) summary.rateLimits[r.provider] = { ...r.rateLimit, at: r.at, model: r.responseModel ?? r.model };
    if (r.jobId) add((summary.byJob[r.jobId] ??= emptyTotals()), r);
    add((summary.byDay[localDay(r.at)] ??= emptyTotals()), r);
  }
  for (const activity of Object.keys(summary.byActivity)) {
    summary.activityStats[activity] = activityStats(records.filter((r) => r.activity === activity));
  }
  summary.recent = records.slice(-recentLimit).reverse();
  return summary;
}
