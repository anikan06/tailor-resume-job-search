import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Profile } from "./types.js";

const DEFAULT_PROFILE: Profile = {
  personal: {},
  search: {},
  custom_question_answers: [],
  resume: {},
  boards: { greenhouse: [], lever: [] },
  ai: {},
  schedule: { enabled: false, cron: "0 7 * * *" },
  apply: { tailor_only: false },
};

function profilePath(): string {
  return process.env.JOB_AGENT_PROFILE ?? new URL("../config/profile.yaml", import.meta.url).pathname;
}

/**
 * Loads the user's profile.yaml. Resolution order:
 *   1. JOB_AGENT_PROFILE env var (explicit path)
 *   2. ./config/profile.yaml next to this package
 *   3. falls back to an empty profile (the server still works - every tool
 *      also accepts per-call overrides, since the whole point of this
 *      server is to work for ANYONE with ANY resume, profile.yaml or not).
 */
export function loadProfile(): Profile {
  const path = profilePath();
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf-8");
      const parsed = parseYaml(raw) as Partial<Profile>;
      return mergeWithDefaults(parsed);
    } catch (err) {
      console.error(`[job-search-agent] Failed to parse profile at ${path}:`, err);
    }
  }
  return DEFAULT_PROFILE;
}

/** Used by the Angular app's Settings page (PUT /api/profile) to persist changes. */
export function saveProfile(profile: Partial<Profile>): Profile {
  const merged = mergeWithDefaults({ ...loadProfile(), ...profile });
  const path = profilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyYaml(merged), "utf-8");
  return merged;
}

function mergeWithDefaults(parsed: Partial<Profile>): Profile {
  return {
    personal: { ...DEFAULT_PROFILE.personal, ...parsed.personal },
    search: { ...DEFAULT_PROFILE.search, ...parsed.search },
    custom_question_answers: parsed.custom_question_answers ?? [],
    resume: { ...DEFAULT_PROFILE.resume, ...parsed.resume },
    boards: { ...DEFAULT_PROFILE.boards, ...parsed.boards },
    ai: { ...DEFAULT_PROFILE.ai, ...parsed.ai },
    schedule: { ...DEFAULT_PROFILE.schedule, ...parsed.schedule },
    apply: { ...DEFAULT_PROFILE.apply, ...parsed.apply },
  };
}

/** Best-effort match of a form question's label text to a configured answer. */
export function findAnswerForQuestion(profile: Profile, questionText: string): string | undefined {
  const q = questionText.toLowerCase();
  for (const entry of profile.custom_question_answers ?? []) {
    if (q.includes(entry.question_contains.toLowerCase())) {
      return entry.answer;
    }
  }
  return undefined;
}
