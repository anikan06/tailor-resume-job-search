#!/usr/bin/env node
// Pre-tool guard for Claude Code (PreToolUse), Gemini CLI (BeforeTool) and
// Codex (PreToolUse). Blocks access to personal data, edits to generated files,
// and destructive shell commands. Exit 2 = block; the stderr text goes to the model.
import { block, readInput, repoRoot, shellCommand, touchedFiles } from "./lib.mjs";

const input = await readInput();
const root = repoRoot(input.cwd);

// Personal data: never read, written, or printed by an agent.
const PRIVATE = [
  [/^server\/config\/profile\.yaml$/, "the user's real profile"],
  [/^server\/data\//, "the user's database, uploads and tailored resumes"],
  [/(^|\/)\.env(\.|$)/, "secrets"],
];
// Generated or vendored: editing these directly is always a mistake.
const GENERATED = [
  [/(^|\/)(node_modules|dist|\.angular)\//, "build output / dependencies"],
  [/^\.(claude|gemini|codex)\/agents\//, "generated from .ai/roles/ - edit the role there and run `node .ai/scripts/sync-agents.mjs`"],
];

const { files, writes } = touchedFiles(input, root);
for (const f of files) {
  if (f.startsWith("..")) continue; // outside the repo: not ours to police
  for (const [re, what] of PRIVATE) {
    if (re.test(f)) block(`Blocked: ${f} holds ${what}. Agents must not access it (AGENTS.md hard rule 2). Use server/config/profile.example.yaml for the shape.`);
  }
  if (writes) {
    for (const [re, what] of GENERATED) {
      if (re.test(f)) block(`Blocked: ${f} is ${what}.`);
    }
  }
}

// Text written through `cat > f <<EOF`, `tee` or `git commit -F - <<EOF` is content, not commands
// (docs often mention the very things this guard blocks). Interpreter heredocs
// such as `python3 - <<EOF` are code, so they are still checked.
const stripFileHeredocs = (s) =>
  s.replace(/(\b(?:cat|tee|git\s+commit)\b[^\n]*<<-?\s*['"]?(\w+)['"]?[^\n]*)\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g, "$1");

const cmd = shellCommand(input) && stripFileHeredocs(shellCommand(input));
if (cmd) {
  const DANGEROUS = [
    [/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(\/|~|\$HOME|\.|\*)(\s|$)/, "recursive delete of a root, home or the whole repo"],
    // [^;&|\n]* keeps each rule inside one command, so a later `rm -f` doesn't count.
    [/\bgit\s+push\b[^;&|\n]*(\s--force(?!-with-lease)|\s-f\b|\s\+\S)/, "force push (use --force-with-lease, and only if the user asked)"],
    [/\bgit\s+reset\s+--hard\b/, "git reset --hard discards uncommitted work"],
    [/\bgit\s+clean\s+-[a-zA-Z]*f/, "git clean deletes untracked files"],
    [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, "discards all uncommitted changes"],
    [/\bgit\s+(commit|push)\b[^;&|\n]*--no-verify/, "skipping git hooks"],
    // Only when curl/wget is in command position, so docs that mention it don't trip.
    [/(^|[;&|(]\s*|\n\s*)(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/, "piping a download into a shell"],
    [/\bnpm\s+publish\b/, "publishing a package"],
    [/(^|[\s/"'])profile\.yaml\b|server\/data\b|\bapp\.db\b/, "touches the user's personal data (profile.yaml / server/data)"],
  ];
  for (const [re, why] of DANGEROUS) {
    if (re.test(cmd)) block(`Blocked shell command (${why}):\n  ${cmd}\nIf the user explicitly asked for this, tell them to run it themselves.`);
  }
}

process.exit(0);
