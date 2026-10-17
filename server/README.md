# aahvya-job-aggregator/server

The engine behind aahvya-job-aggregator. This folder serves two separate front
ends off the same core modules — pick whichever fits how you work:

1. **HTTP API**, for the Angular app in `../web` — see the root
   `../README.md` for the full setup/run instructions for that combination.
2. **MCP server**, for using these same tools conversationally from Claude
   Desktop or Claude Code — covered below.

Both share `src/platforms/*`, `src/formFiller.ts`, `src/resume/*`,
`src/tracker.ts` and `src/policy.ts`, so the apply-safety policy below is
identical either way.

## Apply policy (read this first)

| Platform | Search | Apply |
|---|---|---|
| Greenhouse / Lever / Workday (company career pages) | ✅ public search | **Can auto-submit** if the caller asks for it and every field was answered |
| LinkedIn | ✅ via your logged-in Chrome | **Prefill only, never submits** — a human reviews and clicks submit |
| Naukri | ✅ via your logged-in Chrome | **Prefill only, never submits** |
| Indeed | ✅ via your logged-in Chrome | **Prefill only, never submits** |

Enforced in `src/policy.ts` and in the LinkedIn/Naukri/Indeed modules
themselves (no code path in them clicks a submit button at all) — LinkedIn,
Naukri and Indeed actively detect and can ban accounts for automated
applying, unlike official ATS pages. There is no flag that loosens the
LinkedIn/Naukri/Indeed restriction.

## Install (shared by both front ends)

```bash
npm install
npx playwright install chromium   # only needed if you don't already have Chrome
npm run build
```

## Browser setup (for LinkedIn / Naukri / Indeed)

No password is stored anywhere. The server drives your own already-logged-in
Chrome via its remote debugging port:

1. Run `./chrome-debug.sh` from the repo root (macOS). It opens a separate Chrome
   window with its own profile (`~/.job-search-agent/chrome-profile`), since
   Chrome 136+ won't allow remote debugging on your default profile. Your
   normal Chrome can stay open.
2. Log in to LinkedIn / Naukri / Indeed in that window as yourself (once; the
   profile remembers it).
3. Leave that window open while using either front end.

Override the port with `CHROME_DEBUG_PORT`. Greenhouse/Lever/Workday
applications use a separate, fresh browser window instead — no login needed.

## Configure your profile (optional but recommended)

```bash
cp config/profile.example.yaml config/profile.yaml
```

Gitignored, yours alone, and never required — every tool/endpoint also takes
per-call overrides, so this works even with no profile.yaml (e.g. someone
else running it for their own search with their own resume). The Angular
app's Settings page edits this same file through the HTTP API.

## Running the MCP server (Claude Desktop / Claude Code)

```bash
npm run start       # runs dist/index.js over stdio
```

Register it in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aahvya-job-aggregator": {
      "command": "node",
      "args": ["/absolute/path/to/aahvya-job-aggregator/server/dist/index.js"],
      "env": {
        "JOB_AGENT_PROFILE": "/absolute/path/to/aahvya-job-aggregator/server/config/profile.yaml"
      }
    }
  }
}
```

or for Claude Code:

```bash
claude mcp add aahvya-job-aggregator -- node /absolute/path/to/aahvya-job-aggregator/server/dist/index.js
```

### MCP tools exposed

- `get_profile` / `parse_resume` / `generate_tailored_resume_docx`
- `search_greenhouse_jobs` / `search_lever_jobs` / `apply_ats_job`
- `search_linkedin_jobs` / `prefill_linkedin_application`
- `search_naukri_jobs` / `prefill_naukri_application`
- `search_indeed_jobs` / `prefill_indeed_application`
- `check_already_applied` / `record_application` / `list_applications`
- `explain_apply_policy`

A typical flow for the LLM client to follow: `parse_resume` → `get_profile`
→ search the relevant platforms → `check_already_applied` per candidate job
→ fetch/read the JD → decide what to tailor and call
`generate_tailored_resume_docx` → `apply_ats_job` or `prefill_*_application`
→ `record_application`.

## Running the HTTP API (for the Angular app)

```bash
npm run start:api   # listens on http://localhost:4000 by default (PORT env var)
```

See `../README.md` for the full Angular app walkthrough and the
`/api/*` endpoints it calls (profile, resume upload, job aggregation,
AI tailoring, apply, applications, schedule).

## Known limitations

- Selectors for LinkedIn/Naukri/Indeed are best-effort and may need small
  updates as those sites change their markup — `src/platforms/*.ts` and
  `src/formFiller.ts` are the place to look if search returns nothing or a
  field doesn't fill.
- Workday has no public search API (every tenant is a separate instance),
  so it's apply-only given a job URL, and more best-effort than
  Greenhouse/Lever because Workday forms are often multi-step wizards.
- Custom application questions are only answered when they match something
  in `custom_question_answers` (or an `extraAnswers`/caller override) —
  anything else is left blank on purpose and reported as `"source":
  "unanswered"` rather than guessed.
