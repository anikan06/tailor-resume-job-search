import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Tiny persisted "what resume are we currently using" state, shared by the
 * Settings upload step, on-demand aggregation, and the background scheduler. */

const STATE_PATH = process.env.JOB_AGENT_STATE ?? new URL("../data/state.json", import.meta.url).pathname;

import type { ResumeExtraction } from "./resume/extractProfile.js";

export interface AppState {
  resumePath?: string;
  resumeText?: string;
  resumeFileName?: string;
  /** Details/suggestions parsed out of the current resume, for Settings prefill. */
  resumeExtraction?: ResumeExtraction;
}

export function getState(): AppState {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8")) as AppState;
  } catch {
    return {};
  }
}

export function setState(patch: Partial<AppState>): AppState {
  const next = { ...getState(), ...patch };
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(next, null, 2), "utf-8");
  return next;
}
