// Shared helpers for the hook scripts. Each AI CLI sends a slightly different
// JSON payload on stdin; these normalise it so one script serves all of them.
//
//   Claude Code  PreToolUse  tool_name Bash | Edit | Write | MultiEdit | Read ...
//   Gemini CLI   BeforeTool  tool_name run_shell_command | write_file | replace | read_file ...
//   Codex        PreToolUse  tool_name Bash | apply_patch (patch text in tool_input.command)
//
// All three treat exit code 2 + a stderr message as "block, and tell the model why".
import { execFileSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";

export async function readInput() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function repoRoot(cwd = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return cwd;
  }
}

export function block(reason) {
  process.stderr.write(reason.trim() + "\n");
  process.exit(2);
}

const SHELL_TOOLS = new Set(["Bash", "run_shell_command", "shell", "exec_command"]);

/** The shell command this tool call will run, if it is a shell call. */
export function shellCommand(input) {
  const t = input.tool_input ?? {};
  if (!SHELL_TOOLS.has(input.tool_name)) return null;
  return typeof t.command === "string" ? t.command : Array.isArray(t.command) ? t.command.join(" ") : null;
}

/** Files this tool call reads or writes, relative to the repo root, plus whether it writes. */
export function touchedFiles(input, root) {
  const t = input.tool_input ?? {};
  const name = input.tool_name ?? "";
  let paths = [];
  if (name === "apply_patch") {
    const patch = typeof t.command === "string" ? t.command : t.input ?? "";
    paths = [...String(patch).matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)].map((m) => (m[1] ?? m[2]).trim());
  } else {
    for (const key of ["file_path", "absolute_path", "notebook_path", "path"]) {
      if (typeof t[key] === "string") paths.push(t[key]);
    }
    if (Array.isArray(t.paths)) paths.push(...t.paths.filter((p) => typeof p === "string"));
  }
  const writes = /^(Edit|Write|MultiEdit|NotebookEdit|write_file|replace|apply_patch)$/.test(name);
  const cwd = input.cwd || root;
  return {
    writes,
    files: paths.map((p) => {
      const abs = isAbsolute(p) ? p : resolve(cwd, p);
      return relative(root, abs).split("\\").join("/");
    }),
  };
}

/** JSON that Claude Code, Codex and Gemini CLI all accept for SessionStart context. */
export function sessionContext(text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
}
