import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, Profile } from "./types.js";
import {
  recordLlmUsage,
  type CallDetails,
  type LlmCallContext,
  type RateLimitSnapshot,
  type TokenUsage,
} from "./telemetry.js";

export const AI_PROVIDERS: AiProvider[] = ["anthropic", "openai", "gemini", "ollama"];

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4.1-mini",
  gemini: "gemini-2.5-flash",
  ollama: "llama3.1",
};

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/**
 * The provider in use: the one picked in Settings, or (for profiles saved
 * before providers existed) whichever one has a key.
 */
export function activeProvider(profile: Profile): AiProvider | undefined {
  const ai = profile.ai ?? {};
  if (ai.provider) return ai.provider;
  return (["anthropic", "openai", "gemini"] as const).find((p) => ai[`${p}_api_key`]);
}

/** True when the active provider has what it needs to make a call (Ollama needs no key). */
export function isAiConfigured(profile: Profile): boolean {
  const provider = activeProvider(profile);
  if (!provider) return false;
  return provider === "ollama" || Boolean(profile.ai?.[`${provider}_api_key`]);
}

interface Completion {
  text: string;
  usage: TokenUsage;
  details: CallDetails;
}

/** What a failed call still knows: tokens it billed, and whatever the provider reported. */
interface CallFailure {
  usage?: TokenUsage;
  details?: CallDetails;
}

const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

/**
 * Sends one prompt to the user's chosen provider and returns its text reply.
 * Keys come only from the local profile.yaml and are only ever sent to that
 * provider's own API (or the user's own Ollama server). Every call, failed or
 * not, is logged with its token usage and response metadata via telemetry.ts.
 */
export async function completeText(prompt: string, maxTokens: number, profile: Profile, context: LlmCallContext): Promise<string> {
  const provider = activeProvider(profile);
  if (!provider || !isAiConfigured(profile)) {
    throw new Error("No AI provider configured. Pick one and add its API key in Settings → AI tailoring.");
  }
  const ai = profile.ai!;
  const model = ai.model || DEFAULT_MODELS[provider];

  const started = Date.now();
  let usage = NO_USAGE;
  let details: CallDetails = {};
  let text = "";
  let error: string | undefined;
  try {
    const completion = await callProvider(provider, ai, model, prompt, maxTokens);
    ({ usage, details, text } = completion);
    return text;
  } catch (err) {
    const failure = err as CallFailure;
    usage = failure.usage ?? NO_USAGE;
    details = failure.details ?? {};
    error = (err as Error).message;
    throw err;
  } finally {
    recordLlmUsage({
      ...context,
      ...usage,
      ...details,
      at: new Date(started).toISOString(),
      provider,
      model,
      totalTokens: usage.inputTokens + usage.outputTokens + (usage.reasoningTokens ?? 0),
      durationMs: Date.now() - started,
      ...(provider === "gemini" ? {} : { maxTokens }),
      promptChars: prompt.length,
      responseChars: text.length,
      ok: !error,
      ...(error ? { error: error.slice(0, 300) } : {}),
    });
  }
}

/** A provider error that still carries what the call cost and reported (e.g. a reply that came back empty). */
function callError(message: string, failure: CallFailure): Error {
  return Object.assign(new Error(message), failure);
}

/** Drops undefined fields so records stay compact. */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")) as T;
}

/** Fetch-style Headers, or the plain lowercase-keyed record the Anthropic SDK puts on its errors. */
type HeaderSource = { get(name: string): string | null } | Record<string, string | null | undefined>;

function headerValue(headers: HeaderSource, name: string): string | undefined {
  if (typeof headers.get === "function") return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  return (headers as Record<string, string | null | undefined>)[name] ?? undefined;
}

function headerNumber(headers: HeaderSource, name: string): number | undefined {
  const value = headerValue(headers, name);
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Reads the rate-limit headers Anthropic and OpenAI send with every response. */
function rateLimitFrom(provider: AiProvider, headers: HeaderSource | undefined): RateLimitSnapshot | undefined {
  if (!headers) return undefined;
  const snapshot: RateLimitSnapshot =
    provider === "anthropic"
      ? {
          requestsLimit: headerNumber(headers, "anthropic-ratelimit-requests-limit"),
          requestsRemaining: headerNumber(headers, "anthropic-ratelimit-requests-remaining"),
          requestsReset: headerValue(headers, "anthropic-ratelimit-requests-reset"),
          tokensLimit: headerNumber(headers, "anthropic-ratelimit-tokens-limit"),
          tokensRemaining: headerNumber(headers, "anthropic-ratelimit-tokens-remaining"),
          tokensReset: headerValue(headers, "anthropic-ratelimit-tokens-reset"),
          inputTokensRemaining: headerNumber(headers, "anthropic-ratelimit-input-tokens-remaining"),
          outputTokensRemaining: headerNumber(headers, "anthropic-ratelimit-output-tokens-remaining"),
        }
      : {
          requestsLimit: headerNumber(headers, "x-ratelimit-limit-requests"),
          requestsRemaining: headerNumber(headers, "x-ratelimit-remaining-requests"),
          requestsReset: headerValue(headers, "x-ratelimit-reset-requests"),
          tokensLimit: headerNumber(headers, "x-ratelimit-limit-tokens"),
          tokensRemaining: headerNumber(headers, "x-ratelimit-remaining-tokens"),
          tokensReset: headerValue(headers, "x-ratelimit-reset-tokens"),
        };
  const cleaned = compact(snapshot);
  return Object.keys(cleaned).length ? cleaned : undefined;
}

async function callProvider(
  provider: AiProvider,
  ai: NonNullable<Profile["ai"]>,
  model: string,
  prompt: string,
  maxTokens: number
): Promise<Completion> {
  switch (provider) {
    case "anthropic":
      return anthropic(ai.anthropic_api_key!, model, prompt, maxTokens);
    case "openai":
      return openAiCompatible("openai", "https://api.openai.com/v1", ai.openai_api_key, model, prompt, maxTokens, "OpenAI");
    case "ollama": {
      const base = (ai.ollama_base_url || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
      return openAiCompatible("ollama", `${base}/v1`, undefined, model, prompt, maxTokens, "Ollama");
    }
    case "gemini":
      return gemini(ai.gemini_api_key!, model, prompt);
  }
}

/** Usage fields the API returns that this SDK version's types don't declare yet. */
interface AnthropicUsageExtras {
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  service_tier?: string | null;
}

async function anthropic(apiKey: string, model: string, prompt: string, maxTokens: number): Promise<Completion> {
  const client = new Anthropic({ apiKey });
  let result;
  try {
    result = await client.messages
      .create({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] })
      .withResponse();
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw callError(err.message, {
        details: compact({
          httpStatus: err.status,
          requestId: err.request_id ?? undefined,
          rateLimit: rateLimitFrom("anthropic", err.headers),
        }),
      });
    }
    throw err;
  }
  const { data: message, response } = result;
  const extras = message.usage as typeof message.usage & AnthropicUsageExtras;
  const cacheRead = extras.cache_read_input_tokens ?? 0;
  const cacheWrite = extras.cache_creation_input_tokens ?? 0;
  // Anthropic's input_tokens excludes cached tokens; fold them in so input means the same across providers.
  const usage: TokenUsage = compact({
    inputTokens: message.usage.input_tokens + cacheRead + cacheWrite,
    outputTokens: message.usage.output_tokens,
    cachedInputTokens: cacheRead || undefined,
    cacheWriteTokens: cacheWrite || undefined,
  });
  const details: CallDetails = compact({
    requestId: response.headers.get("request-id") ?? message.id,
    responseModel: message.model,
    stopReason: message.stop_reason ?? undefined,
    serviceTier: extras.service_tier ?? undefined,
    httpStatus: response.status,
    rateLimit: rateLimitFrom("anthropic", response.headers),
  });
  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw callError("Claude returned no text content.", { usage, details });
  return { text: block.text, usage, details };
}

async function openAiCompatible(
  provider: "openai" | "ollama",
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  prompt: string,
  maxTokens: number,
  label: string
): Promise<Completion> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model,
        max_completion_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    throw new Error(`Couldn't reach ${label} at ${baseUrl}: ${(err as Error).message}`);
  }
  const responseDetails: CallDetails = compact({
    requestId: res.headers.get("x-request-id") ?? undefined,
    httpStatus: res.status,
    rateLimit: provider === "openai" ? rateLimitFrom("openai", res.headers) : undefined,
  });
  const data = (await readJson(res, label, responseDetails)) as {
    id?: string;
    model?: string;
    service_tier?: string;
    choices?: { finish_reason?: string; message?: { content?: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  // OpenAI counts reasoning inside completion_tokens; split it out so output means visible reply only.
  const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const usage: TokenUsage = compact({
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: (data.usage?.completion_tokens ?? 0) - reasoning,
    reasoningTokens: reasoning || undefined,
    cachedInputTokens: data.usage?.prompt_tokens_details?.cached_tokens || undefined,
  });
  const details: CallDetails = compact({
    ...responseDetails,
    requestId: responseDetails.requestId ?? data.id,
    responseModel: data.model,
    stopReason: data.choices?.[0]?.finish_reason,
    serviceTier: data.service_tier,
  });
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw callError(`${label} returned no text content.`, { usage, details });
  return { text, usage, details };
}

async function gemini(apiKey: string, model: string, prompt: string): Promise<Completion> {
  // Key goes in a header rather than the ?key= query param so it never shows up in URL logs.
  // No maxOutputTokens: 2.5+ models count "thinking" against it, which can truncate the JSON.
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  const data = (await readJson(res, "Gemini", { httpStatus: res.status })) as {
    responseId?: string;
    modelVersion?: string;
    promptFeedback?: { blockReason?: string };
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      cachedContentTokenCount?: number;
    };
  };
  const meta = data.usageMetadata;
  const usage: TokenUsage = compact({
    inputTokens: meta?.promptTokenCount ?? 0,
    outputTokens: meta?.candidatesTokenCount ?? 0,
    reasoningTokens: meta?.thoughtsTokenCount || undefined,
    cachedInputTokens: meta?.cachedContentTokenCount || undefined,
  });
  const blocked = data.promptFeedback?.blockReason;
  const details: CallDetails = compact({
    requestId: data.responseId,
    responseModel: data.modelVersion,
    stopReason: data.candidates?.[0]?.finishReason ?? (blocked ? `BLOCKED_${blocked}` : undefined),
    httpStatus: res.status,
  });
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) {
    const why = blocked ? ` (prompt blocked: ${blocked})` : "";
    throw callError(`Gemini returned no text content${why}.`, { usage, details });
  }
  return { text, usage, details };
}

async function readJson(res: Response, label: string, details: CallDetails): Promise<unknown> {
  const body = await res.text();
  if (!res.ok) {
    let message = body.slice(0, 300);
    try {
      const parsed = JSON.parse(body);
      message = parsed.error?.message ?? message;
    } catch {
      // not JSON - keep the raw snippet
    }
    throw callError(`${label} API error (${res.status}): ${message}`, { details });
  }
  return JSON.parse(body);
}

/** Strips ```json fences some models wrap around their output. */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1] : trimmed;
}
