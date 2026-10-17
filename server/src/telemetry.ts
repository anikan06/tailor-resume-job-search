import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AiProvider } from "./types.js";

/** Append-only log of every LLM call (one JSON object per line), so token spend can be totalled later. */
const USAGE_PATH = process.env.JOB_AGENT_USAGE ?? new URL("../data/llm-usage.jsonl", import.meta.url).pathname;

/** What an LLM call was made for. */
export type LlmActivity = "tailor_resume" | "extract_resume" | "import_profile";

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
  /** Keyed by local calendar day (YYYY-MM-DD), oldest first. */
  byDay: Record<string, UsageTotals>;
  recent: LlmUsageRecord[];
}

export function recordLlmUsage(record: LlmUsageRecord): void {
  try {
    mkdirSync(dirname(USAGE_PATH), { recursive: true });
    appendFileSync(USAGE_PATH, JSON.stringify(record) + "\n", "utf-8");
  } catch (err) {
    // Telemetry must never break the call it's measuring.
    console.error(`[job-search-agent] couldn't write LLM usage: ${(err as Error).message}`);
  }
  console.error(
    `[job-search-agent] llm ${record.activity} ${record.provider}/${record.model} ` +
      `in=${record.inputTokens} out=${record.outputTokens} ${record.durationMs}ms${record.ok ? "" : " FAILED"}`
  );
}

export function readLlmUsage(): LlmUsageRecord[] {
  if (!existsSync(USAGE_PATH)) return [];
  return readFileSync(USAGE_PATH, "utf-8")
    .split("\n")
    .flatMap((line) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line) as LlmUsageRecord];
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
  summary.recent = records.slice(-recentLimit).reverse();
  return summary;
}
