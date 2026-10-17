#!/usr/bin/env node
// Generates each tool's native subagent files from the canonical roles in
// .ai/roles/*.md, so every LLM gets the same planner / server-dev / web-dev /
// verifier / reviewer team.
//
//   node .ai/scripts/sync-agents.mjs          write .claude/agents, .gemini/agents, .codex/agents
//   node .ai/scripts/sync-agents.mjs --check  exit 1 if any generated file is stale
//
// Role frontmatter: name, description, access:
//   read  - inspect only
//   shell - inspect + run commands (git, gh), but never edit files
//   write - inspect, run commands, edit files
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rolesDir = join(root, ".ai/roles");
const check = process.argv.includes("--check");
const NOTICE = "Generated from .ai/roles/{name}.md by .ai/scripts/sync-agents.mjs - edit the role, not this file.";

function parseRole(file) {
  const src = readFileSync(join(rolesDir, file), "utf8");
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const meta = Object.fromEntries(
    m[1].split("\n").filter(Boolean).map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  for (const key of ["name", "description", "access"]) {
    if (!meta[key]) throw new Error(`${file}: frontmatter needs ${key}`);
  }
  if (!["read", "shell", "write"].includes(meta.access)) throw new Error(`${file}: access must be read, shell or write`);
  return { ...meta, body: m[2].trim() + "\n" };
}

const yamlString = (s) => JSON.stringify(s); // JSON strings are valid YAML scalars
const tomlMultiline = (s) => '"""\n' + s.replace(/\\/g, "\\\\").replace(/"""/g, '\\"""') + '"""';
const ACCESS_NOTE = {
  read: "\n**You are read-only: do not create, edit, or delete files.**\n",
  shell: "\n**Do not edit source files. You may only run commands (git, gh, the repo's scripts).**\n",
  write: "",
};

const targets = {
  claude: {
    dir: ".claude/agents",
    file: (r) => `${r.name}.md`,
    render: (r) =>
      [
        "---",
        `name: ${r.name}`,
        `description: ${yamlString(r.description)}`,
        `tools: ${r.access === "write" ? "Read, Grep, Glob, Bash, Edit, Write" : "Read, Grep, Glob, Bash"}`,
        "---",
        `<!-- ${NOTICE.replace("{name}", r.name)} -->`,
        "",
        r.body + ACCESS_NOTE[r.access],
      ].join("\n"),
  },
  gemini: {
    dir: ".gemini/agents",
    file: (r) => `${r.name}.md`,
    render: (r) =>
      [
        "---",
        `name: ${r.name}`,
        `description: ${yamlString(r.description)}`,
        "kind: local",
        ...(r.access !== "write"
          ? ["tools:", ...["read_file", "read_many_files", "glob", "grep_search", "list_directory", "run_shell_command"].map((t) => `  - ${t}`)]
          : []),
        `temperature: ${r.access === "read" ? 0.2 : 0.4}`,
        "max_turns: 40",
        "timeout_mins: 15",
        "---",
        `<!-- ${NOTICE.replace("{name}", r.name)} -->`,
        "",
        r.body + ACCESS_NOTE[r.access],
      ].join("\n"),
  },
  codex: {
    dir: ".codex/agents",
    file: (r) => `${r.name}.toml`,
    render: (r) =>
      [
        `# ${NOTICE.replace("{name}", r.name)}`,
        `name = ${JSON.stringify(r.name)}`,
        `description = ${JSON.stringify(r.description)}`,
        `model_reasoning_effort = ${JSON.stringify(["planner", "reviewer"].includes(r.name) ? "high" : "medium")}`,
        // Codex subagents inherit the parent's sandbox, so access limits are instructions, not a sandbox.
        `developer_instructions = ${tomlMultiline(r.body + ACCESS_NOTE[r.access])}`,
        "",
      ].join("\n"),
  },
};

const roles = readdirSync(rolesDir).filter((f) => f.endsWith(".md")).sort().map(parseRole);
let stale = 0;
for (const [tool, t] of Object.entries(targets)) {
  const dir = join(root, t.dir);
  const wanted = new Map(roles.map((r) => [t.file(r), t.render(r)]));
  const existing = existsSync(dir) ? readdirSync(dir) : [];
  for (const [file, content] of wanted) {
    const path = join(dir, file);
    if (existsSync(path) && readFileSync(path, "utf8") === content) continue;
    stale++;
    if (check) console.error(`stale: ${t.dir}/${file}`);
    else {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, content);
      console.log(`wrote ${t.dir}/${file}`);
    }
  }
  // Remove agents whose role was deleted (only files we generated).
  for (const file of existing) {
    if (wanted.has(file)) continue;
    const path = join(dir, file);
    if (!readFileSync(path, "utf8").includes("by .ai/scripts/sync-agents.mjs")) continue;
    stale++;
    if (check) console.error(`orphan: ${t.dir}/${file}`);
    else {
      rmSync(path);
      console.log(`removed ${t.dir}/${file}`);
    }
  }
  if (!check) console.log(`${tool}: ${roles.length} agents`);
}
if (check && stale) {
  console.error("Run: node .ai/scripts/sync-agents.mjs");
  process.exit(1);
}
if (check) console.log("Agents in sync");
