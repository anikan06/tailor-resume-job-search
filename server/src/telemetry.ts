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

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Gemini 2.5+ "thinking" tokens; billed as output but reported separately. */
  reasoningTokens?: number;
}

export interface LlmUsageRecord extends LlmCallContext, TokenUsage {
  at: string;
  provider: AiProvider;
  model: string;
  totalTokens: number;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface UsageTotals {
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageSummary {
  totals: UsageTotals;
  byActivity: Record<string, UsageTotals>;
  byModel: Record<string, UsageTotals>;
  /** Tailoring tokens keyed by job id. */
  byJob: Record<string, UsageTotals>;
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
  return { calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function add(totals: UsageTotals, r: LlmUsageRecord): void {
  totals.calls++;
  if (!r.ok) totals.failedCalls++;
  totals.inputTokens += r.inputTokens;
  totals.outputTokens += r.outputTokens;
  totals.totalTokens += r.totalTokens;
}

export function summarizeLlmUsage(recentLimit = 50): UsageSummary {
  const records = readLlmUsage();
  const summary: UsageSummary = { totals: emptyTotals(), byActivity: {}, byModel: {}, byJob: {}, recent: [] };
  for (const r of records) {
    add(summary.totals, r);
    add((summary.byActivity[r.activity] ??= emptyTotals()), r);
    add((summary.byModel[`${r.provider}/${r.model}`] ??= emptyTotals()), r);
    if (r.jobId) add((summary.byJob[r.jobId] ??= emptyTotals()), r);
  }
  summary.recent = records.slice(-recentLimit).reverse();
  return summary;
}
