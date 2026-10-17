#!/usr/bin/env node
// SessionStart context for Claude Code, Gemini CLI and Codex: the current
// branch, what's already dirty (so the agent doesn't take credit for or revert
// the user's work), and a one-line reminder of the orchestrator flow.
import { execFileSync } from "node:child_process";
import { readInput, repoRoot, sessionContext } from "./lib.mjs";

const input = await readInput();
const root = repoRoot(input.cwd);
const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
  } catch {
    return "";
  }
};

const branch = git("branch", "--show-current") || "(detached)";
const dirty = git("status", "--porcelain").split("\n").filter(Boolean);
const lines = [
  `Repo: aahvya-job-aggregator on branch ${branch}.`,
  dirty.length
    ? `${dirty.length} file(s) already had uncommitted changes when this session started (the user's work - don't revert it):\n${dirty.slice(0, 15).join("\n")}`
    : "Working tree was clean at session start.",
  "For multi-file work use the orchestrator flow (`orchestrate` skill, .ai/workflow.md): planner -> server-dev/web-dev -> verifier -> reviewer.",
  "Hard rules: never auto-submit on LinkedIn/Naukri/Indeed; never touch server/data or profile.yaml. Gate: .ai/scripts/verify.sh",
];
if (branch === "main") lines.push("You are on main: create a feature branch before committing.");
sessionContext(lines.join("\n"));
