#!/usr/bin/env node
// End-of-turn gate for Claude Code (Stop), Gemini CLI (AfterAgent) and Codex
// (Stop). If server/ or web/ have uncommitted changes that haven't passed
// verify.sh yet, run it; on failure exit 2 so the agent keeps going and fixes it.
// `stop_hook_active` (sent by all three) prevents an endless fix loop.
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { block, readInput, repoRoot } from "./lib.mjs";

const input = await readInput();
if (input.stop_hook_active) process.exit(0);

const root = repoRoot(input.cwd);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const status = git("status", "--porcelain", "--", "server", "web", ".ai/scripts");
if (!status.trim()) process.exit(0);

// Skip if this exact working tree already passed (repeated stops with no new edits).
const fingerprint = createHash("sha256").update(status).update(git("diff", "HEAD", "--", "server", "web", ".ai/scripts")).digest("hex");
const stamp = join(git("rev-parse", "--absolute-git-dir").trim(), "ai-verify-pass");
if (existsSync(stamp) && readFileSync(stamp, "utf8") === fingerprint) process.exit(0);

const run = spawnSync(join(root, ".ai/scripts/verify.sh"), ["--changed"], { cwd: root, encoding: "utf8" });
if (run.status === 0) {
  writeFileSync(stamp, fingerprint);
  process.exit(0);
}
const out = (run.stdout + run.stderr).split("\n").slice(-60).join("\n");
block(`verify.sh failed on the current changes. Fix these before finishing (or tell the user why you can't):\n${out}`);
