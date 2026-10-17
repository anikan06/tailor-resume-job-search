---
name: add-job-platform
description: Add a new job board or ATS platform (search and/or apply) to the server - Platform union, platform module under server/src/platforms/, aggregation in jobsStore.ts, apply routing, MCP tools, and the web platform label/boards settings - while respecting the auto-submit policy. Use when asked to support a new job site.
---
# Add a job platform

## Decide the policy first

- **Company-hosted ATS** (like Greenhouse, Lever, Workday): may auto-submit, but only
  through `platforms/ats.ts` and only when `canAutoSubmit()` allows it. Adding one
  to `AUTO_SUBMIT_ALLOWED` is a **policy change**. Ask the user explicitly and update
  `check-invariants.mjs` in the same change.
- **Job board with accounts** (like LinkedIn, Naukri, Indeed): **prefill only.**
  Copy the structure of `platforms/indeed.ts`: open the job, click the entry *Apply*
  button, call `fillApplicationForm`, return a "finish it yourself" message. Never
  click Submit, Review, Next, or Send, and never press keys. Add the new file to the
  prefill list in `.ai/scripts/check-invariants.mjs`.

## Touch points

1. Add the name to the `Platform` union in `server/src/types.ts`, and mirror it in
   `web/src/app/core/models.ts`.
2. Add `server/src/platforms/<name>.ts` with `search<Name>Jobs(keywords, location)`
   returning `JobListing[]`, and the apply/prefill function. Use `newPage()` from
   `browser.ts`, best-effort selectors, and `.catch(() => …)` on optional reads, as
   the existing modules do.
3. Wire search into the aggregation in `server/src/jobsStore.ts`, with a per-source
   error entry.
4. Route apply by platform where the existing platforms are dispatched (`httpServer.ts`,
   `index.ts`). Add the platform to the zod enums in `index.ts`.
5. If the platform needs login, add it to the `needsLogin` check in `jobDescription.ts`.
6. On the web side, add the label and icon in `web/src/app/shared/platform.ts` and the
   toggle in `features/settings/sections/boards-section.component.ts`.
7. Update the apply-policy table in `README.md`.
8. Run `.ai/scripts/verify.sh` (the invariants must pass) and get a review that
   includes a second opinion.
