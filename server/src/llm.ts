import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, Profile } from "./types.js";

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

/**
 * Sends one prompt to the user's chosen provider and returns its text reply.
 * Keys come only from the local profile.yaml and are only ever sent to that
 * provider's own API (or the user's own Ollama server).
 */
export async function completeText(prompt: string, maxTokens: number, profile: Profile): Promise<string> {
  const provider = activeProvider(profile);
  if (!provider || !isAiConfigured(profile)) {
    throw new Error("No AI provider configured. Pick one and add its API key in Settings → AI tailoring.");
  }
  const ai = profile.ai!;
  const model = ai.model || DEFAULT_MODELS[provider];

  switch (provider) {
    case "anthropic": {
      const client = new Anthropic({ apiKey: ai.anthropic_api_key! });
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
      const block = response.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("Claude returned no text content.");
      return block.text;
    }
    case "openai":
      return openAiCompatible("https://api.openai.com/v1", ai.openai_api_key, model, prompt, maxTokens, "OpenAI");
    case "ollama": {
      const base = (ai.ollama_base_url || DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
      return openAiCompatible(`${base}/v1`, undefined, model, prompt, maxTokens, "Ollama");
    }
    case "gemini":
      return gemini(ai.gemini_api_key!, model, prompt);
  }
}

async function openAiCompatible(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  prompt: string,
  maxTokens: number,
  label: string
): Promise<string> {
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
  const data = (await readJson(res, label)) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${label} returned no text content.`);
  return text;
}

async function gemini(apiKey: string, model: string, prompt: string): Promise<string> {
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
  const data = (await readJson(res, "Gemini")) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned no text content.");
  return text;
}

async function readJson(res: Response, label: string): Promise<unknown> {
  const body = await res.text();
  if (!res.ok) {
    let message = body.slice(0, 300);
    try {
      const parsed = JSON.parse(body);
      message = parsed.error?.message ?? message;
    } catch {
      // not JSON - keep the raw snippet
    }
    throw new Error(`${label} API error (${res.status}): ${message}`);
  }
  return JSON.parse(body);
}

/** Strips ```json fences some models wrap around their output. */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1] : trimmed;
}
