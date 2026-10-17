# job-search-agent

A self-hosted job-search app: add your details and a resume once, see
matching jobs aggregated on one dashboard, and press **Apply** to have it
tailor your resume for that specific job (via AI) and apply.

Two parts, both in this repo:

- **`server/`** — the engine. An Express HTTP API (and, separately, an MCP
  server for Claude Desktop/Code) that does the actual searching, resume
  tailoring, and browser automation.
- **`web/`** — the Angular app (Settings / Dashboard / History) that talks to
  that API.

Both run locally on your machine. Nothing is hosted for you, no account
required, no data leaves your machine except the one call per tailor to the AI
provider you choose, using your own key (or none at all with local Ollama).

## Apply policy (read this first)

| Platform | Dashboard search | Pressing "Apply" |
|---|---|---|
| Greenhouse / Lever / Workday (company career pages) | ✅ public search | **Fully automatic** — tailors the resume, fills the form, and submits in one click |
| LinkedIn | ✅ via your logged-in Chrome | Tailors and **prefills only** — a browser window opens filled in, you click submit yourself |
| Naukri | ✅ via your logged-in Chrome | Same — prefill only |
| Indeed | ✅ via your logged-in Chrome | Same — prefill only |

This is enforced in `server/src/policy.ts` and in the LinkedIn/Naukri/Indeed
modules themselves — they contain no code path that clicks a final submit
button at all, so nothing in the Angular app or the API can override it.
LinkedIn, Naukri and Indeed actively detect and can ban accounts for
automated applying; official company ATS pages don't have that same
posture. Even on the auto-submit-eligible platforms, a job with any
application field the system couldn't confidently answer stops short of
submitting and leaves the browser open for you instead.

## One-time setup

```bash
cd server
npm install
npx playwright install chromium   # only if you don't already have Chrome
npm run build

cd ../web
npm install
npm run build   # optional - `npm start` below also works straight from source
```

### Chrome, for LinkedIn / Naukri / Indeed

No password is ever stored. The server drives your own, already-logged-in
Chrome via its remote debugging port instead:

```bash
# quit Chrome first, then:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Log into LinkedIn / Naukri / Indeed in that window as yourself, and leave it
open while using the app. Greenhouse/Lever/Workday applications don't need
this — the server opens its own separate window for those.

### AI provider, for resume tailoring

The app rewrites/reorders your real resume content per job description using
whichever provider you pick in **Settings → AI tailoring**:

| Provider | Cost | Where to get access |
| --- | --- | --- |
| Google Gemini | Free tier | Free key at aistudio.google.com/apikey |
| OpenAI (GPT) | Pay per use | Key at platform.openai.com/api-keys |
| Anthropic (Claude) | Pay per use | Key at console.anthropic.com |
| Ollama (local) | Free | Install from ollama.com, then `ollama pull llama3.1` |

ChatGPT Plus, Gemini Advanced and Claude Pro chat subscriptions do **not**
include API access, so they can't be used here. If you don't want to pay,
use the free Gemini key or Ollama.

Keys are written to `server/config/profile.yaml` (gitignored) and only ever
sent to the provider they belong to. You can also override the model name
per provider.

## Running it

One command from the repo root starts both (installs deps on first run,
builds the server, Ctrl+C stops both):

```bash
./start.sh
```

Or run them separately in two terminals:

```bash
# terminal 1
cd server
npm run start:api        # HTTP API on http://localhost:4000

# terminal 2
cd web
npm start                 # Angular dev server on http://localhost:4200
```

Open **http://localhost:4200**. Go to **Settings** first: upload a resume,
add your target roles/keywords/locations, the Greenhouse/Lever company
boards you want tracked, and an AI provider. Then go to
**Dashboard**, click **Search now**, and press **Apply** on whatever looks
good.

If you turned on "run automatically in the background" in Settings, the API
process re-runs the search on that schedule as long as it keeps running —
start it with something like `pm2` or a Login Item/launchd job on macOS if
you want it to survive you closing the terminal.

## Still true from the original MCP-server design

- **Resume/role agnostic** — every API call takes a resume and search
  criteria from `config/profile.yaml`, not anything hardcoded. Anyone can
  point this at their own resume.
- **Local dedupe tracker** (`server/data/applications.json`) — the same job
  URL is never applied to twice.
- The original MCP server (`server/src/index.ts`, for using these same tools
  from Claude Desktop/Code instead of the Angular app) still works — see
  `server/README.md`.

## Known limitations (read before relying on this)

- **Selectors will break.** LinkedIn/Naukri/Indeed change their markup
  regularly; the scraping/form-filling code uses best-effort CSS/role
  selectors. If search returns 0 results or a field doesn't get filled,
  that's the first place to check (`server/src/platforms/*.ts`,
  `server/src/formFiller.ts`).
- **Workday has no public search API**, so it isn't in dashboard search —
  only reachable via a direct job URL if you add that later.
- **AI tailoring quality depends on the resume text extraction.** Scanned/
  image-only PDFs won't extract usable text; use a text-based PDF or .docx.
- This was built and compiled/tested in a sandboxed environment without
  access to a real logged-in LinkedIn/Naukri/Indeed session, a live
  AI provider key, or unrestricted network — every endpoint is logic-
  tested (profile save/load, resume upload & parsing, the dedupe tracker,
  the apply-policy guard, cron validation, graceful per-source error
  handling when a search fails) and both the server and the Angular app
  compile and build cleanly, but the live browser-automation and AI-call
  paths haven't been exercised end to end yet. Try it against a couple of
  real jobs first and expect to tweak a selector or a prompt.
