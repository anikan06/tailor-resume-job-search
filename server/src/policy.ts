import { AUTO_SUBMIT_ALLOWED, type Platform } from "./types.js";

/**
 * Hard safety guardrail, enforced in code (not just by instructing the
 * calling LLM to behave): LinkedIn, Naukri and Indeed actively police
 * automated activity and can suspend accounts for it, so this server will
 * NEVER submit an application on those platforms itself - only prefill the
 * form and stop, however it's called. Only official ATS pages the company
 * itself hosts (Greenhouse/Lever/Workday) - which don't bot-detect
 * applicants the same way - are allowed to be auto-submitted, and only when
 * the caller explicitly asks for submission.
 *
 * `JOB_AGENT_FORCE_PREFILL_ONLY=true` can additionally force prefill-only
 * everywhere, e.g. for a cautious first run. There is deliberately no env
 * var to loosen the LinkedIn/Naukri/Indeed restriction - that one is fixed.
 */
export function canAutoSubmit(platform: Platform): boolean {
  if (process.env.JOB_AGENT_FORCE_PREFILL_ONLY === "true") return false;
  return AUTO_SUBMIT_ALLOWED.has(platform);
}

export function policyExplanation(platform: Platform): string {
  if (canAutoSubmit(platform)) {
    return `${platform}: auto-submit is allowed on this platform's own career pages.`;
  }
  return (
    `${platform}: this server only prefills the application and stops before submitting - ` +
    `${platform} can suspend accounts for automated submissions, so a human (you) must review ` +
    `and click the final submit button.`
  );
}
