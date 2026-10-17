import { kvGet, kvSet } from "./db.js";

/** Tiny persisted "what resume are we currently using" state, shared by the
 * Settings upload step, on-demand aggregation, and the background scheduler. */

import type { ResumeExtraction } from "./resume/extractProfile.js";

export interface AppState {
  resumePath?: string;
  resumeText?: string;
  resumeFileName?: string;
  /** Details/suggestions parsed out of the current resume, for Settings prefill. */
  resumeExtraction?: ResumeExtraction;
}

export function getState(): AppState {
  return kvGet<AppState>("state") ?? {};
}

export function setState(patch: Partial<AppState>): AppState {
  const next = { ...getState(), ...patch };
  kvSet("state", next);
  return next;
}
