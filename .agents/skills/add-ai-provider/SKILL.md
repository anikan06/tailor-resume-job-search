---
name: add-ai-provider
description: Add a new LLM provider (e.g. Mistral, Groq, DeepSeek, Azure OpenAI, OpenRouter) or change default models for the app's resume tailoring - AiProvider union, llm.ts callProvider/DEFAULT_MODELS, telemetry, httpServer key masking, and the Settings and Usage screens. Use when asked to support another model vendor in the app.
---
# Add an AI provider to the app

The app's LLM layer is `server/src/llm.ts`. All feature code calls
`completeText(prompt, maxTokens, profile, context)` and never a vendor SDK directly.

1. **Types.** Extend `AiProvider` and the `ai` block of `Profile` (`<name>_api_key?`,
   plus any base URL) in `server/src/types.ts`, and mirror both in `web/src/app/core/models.ts`.
2. **llm.ts.**
   - Add the provider to `AI_PROVIDERS` and `DEFAULT_MODELS`. Pick a current,
     inexpensive model and check its id against the vendor's docs. Don't guess.
   - Add a `case` in `callProvider`. If the vendor speaks the OpenAI chat-completions
     format, reuse `openAiCompatible(id, baseUrl, key, model, …)`. Otherwise write a
     small function next to `anthropic()` and `gemini()` that returns the same
     `Completion` shape, *including token usage*, so telemetry works.
   - Update `activeProvider` / `isAiConfigured` if the provider needs no key (as Ollama does).
3. **Key handling.** In `server/src/httpServer.ts`, extend the `${provider}_api_key`
   mapping and the `keepKey(...)` block, so keys are kept on save and never returned to the client.
4. **Telemetry.** If `telemetry.ts` has per-provider pricing or rate-limit parsing,
   add entries for the new provider.
5. **Web.** Add the provider option, key field, and help link in
   `features/settings/sections/ai-section.component.ts`, and its display name in
   `features/usage/usage.component.ts`.
6. **README.** Add it to the provider list in Quick start.
7. Run `.ai/scripts/verify.sh`. Ask the user to test with their own key. Never put a
   key in code, tests, or logs.
