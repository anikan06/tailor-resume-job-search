#!/usr/bin/env node
// Static checks for the repo's hard rules (see AGENTS.md). Run by verify.sh and
// by the Stop hooks of every AI tool. Exit 1 with one line per violation.
//
// These are tripwires, not proofs: they catch the obvious ways an agent (or a
// human) could make LinkedIn/Naukri/Indeed submit an application, or leak data.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const violations = [];

// Words that name a "finish the application" control. Must never appear in a
// selector on the prefill-only platforms or in the shared form filler.
const FINISH_WORDS = /submit|review|next|send|continue|confirm|finish|done/i;
const SELECTOR_CALL = /\b(locator|getByRole|getByText|getByLabel|getByTestId|getByTitle|\$\$?|waitForSelector)\s*\(([^)]*)\)/g;

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/.*$/gm, "");
}

function lineOf(src, index) {
  return src.slice(0, index).split("\n").length;
}

function checkSelectors(file, { allowKeyboard }) {
  const src = stripComments(read(file));
  for (const m of src.matchAll(SELECTOR_CALL)) {
    if (FINISH_WORDS.test(m[2])) {
      violations.push(`${file}:${lineOf(src, m.index)} selector targets a submit/next-style control: ${m[0].trim()}`);
    }
  }
  const banned = [
    [/\.(submit|requestSubmit)\s*\(/g, "submits a form"],
    [/\.dispatchEvent\s*\(/g, "dispatches synthetic events"],
    ...(allowKeyboard ? [] : [[/\.press\s*\(|\bkeyboard\./g, "presses keys (Enter can submit a form)"]]),
  ];
  for (const [re, why] of banned) {
    for (const m of src.matchAll(re)) violations.push(`${file}:${lineOf(src, m.index)} ${why}`);
  }
}

// 1. Prefill-only platforms never finish an application.
for (const p of ["linkedin", "naukri", "indeed"]) {
  const file = `server/src/platforms/${p}.ts`;
  checkSelectors(file, { allowKeyboard: false });
  if (/canAutoSubmit|platforms\/ats/.test(stripComments(read(file)))) {
    violations.push(`${file} imports the auto-submit path (canAutoSubmit / ats.ts)`);
  }
}
checkSelectors("server/src/formFiller.ts", { allowKeyboard: true });

// 2. Only company-hosted ATS platforms may auto-submit.
{
  const src = read("server/src/types.ts");
  const m = src.match(/AUTO_SUBMIT_ALLOWED[^=]*=\s*new Set<Platform>\(\[([\s\S]*?)\]\)/);
  const allowed = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort().join(",") : null;
  if (allowed !== "greenhouse,lever,workday") {
    violations.push(`server/src/types.ts AUTO_SUBMIT_ALLOWED must be exactly greenhouse, lever, workday (found: ${allowed ?? "unparseable"})`);
  }
}

// 3. policy.ts has no way to loosen the restriction.
{
  const src = stripComments(read("server/src/policy.ts"));
  const envs = [...src.matchAll(/process\.env\.(\w+)/g)].map((x) => x[1]).filter((e) => e !== "JOB_AGENT_FORCE_PREFILL_ONLY");
  if (envs.length) violations.push(`server/src/policy.ts reads env vars that could loosen the policy: ${envs.join(", ")}`);
  if (/["'`](linkedin|naukri|indeed)["'`]/.test(src)) violations.push("server/src/policy.ts special-cases a prefill-only platform");
}

// 4. No personal data tracked or staged.
{
  const tracked = execFileSync("git", ["ls-files", "--cached", "server/data", "server/config"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && f !== "server/config/profile.example.yaml");
  for (const f of tracked) violations.push(`${f} is tracked/staged by git but holds personal data`);
}

if (violations.length) {
  console.error("Safety invariants FAILED:\n" + violations.map((v) => "  - " + v).join("\n"));
  process.exit(1);
}
console.log("Safety invariants: pass");
