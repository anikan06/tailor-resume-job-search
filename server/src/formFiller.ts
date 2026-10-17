import type { Page } from "playwright";
import type { Profile, FieldAnswer } from "./types.js";
import { findAnswerForQuestion } from "./config.js";

/**
 * Best-effort generic application-form filler shared by every platform
 * module. Real job-application forms vary enormously (plain HTML, React
 * widgets, multi-step wizards), so this works off accessible labels/
 * placeholders rather than hardcoded selectors per site, and it is honest
 * with the caller about what it couldn't confidently fill rather than
 * guessing.
 *
 * It NEVER clicks a submit/next button itself - that's the caller's job,
 * gated by policy.ts. This function only fills fields.
 */

const FIELD_MATCHERS: Array<{ test: RegExp; profileKey: (p: Profile) => string | undefined | boolean }> = [
  { test: /first\s*name/i, profileKey: (p) => p.personal.full_name?.split(" ")[0] },
  { test: /last\s*name/i, profileKey: (p) => p.personal.full_name?.split(" ").slice(1).join(" ") },
  { test: /full\s*name|^name$|your\s*name/i, profileKey: (p) => p.personal.full_name },
  { test: /e-?mail/i, profileKey: (p) => p.personal.email },
  { test: /phone|mobile/i, profileKey: (p) => p.personal.phone },
  { test: /location|city|address/i, profileKey: (p) => p.personal.location },
  { test: /linkedin/i, profileKey: (p) => p.personal.linkedin_url },
  { test: /portfolio|website/i, profileKey: (p) => p.personal.portfolio_url },
  { test: /github/i, profileKey: (p) => p.personal.github_url },
  { test: /years?\s*of\s*experience/i, profileKey: (p) => p.personal.years_experience?.toString() },
  { test: /notice\s*period/i, profileKey: (p) => p.personal.notice_period_days?.toString() },
  { test: /current\s*ctc|current\s*salary/i, profileKey: (p) => p.personal.current_ctc },
  { test: /expected\s*ctc|expected\s*salary/i, profileKey: (p) => p.personal.expected_ctc },
  { test: /sponsorship|work\s*authorization|authorized\s*to\s*work/i, profileKey: (p) => p.personal.work_authorization },
  { test: /relocate/i, profileKey: (p) => (p.personal.willing_to_relocate ? "Yes" : "No") },
];

export async function fillApplicationForm(
  page: Page,
  profile: Profile,
  resumeFilePath?: string,
  extraAnswers: Record<string, string> = {}
): Promise<FieldAnswer[]> {
  const results: FieldAnswer[] = [];

  // 1. Resume upload - any file input is assumed to be the resume/CV field.
  if (resumeFilePath) {
    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      try {
        await fileInputs.nth(i).setInputFiles(resumeFilePath);
        results.push({ fieldLabel: `file input #${i}`, value: resumeFilePath, source: "caller" });
      } catch {
        // Some file inputs are hidden behind a styled "Upload" button and
        // can still accept setInputFiles even if not "visible" to Playwright;
        // if it still throws, we leave it for manual upload.
      }
    }
  }

  // 2. Text/textarea/select fields, matched by label/placeholder/aria-label text.
  const fields = page.locator("input:not([type='file']):not([type='hidden']), textarea, select");
  const count = await fields.count().catch(() => 0);

  for (let i = 0; i < count; i++) {
    const field = fields.nth(i);
    const labelText = await resolveLabelText(page, field);
    if (!labelText) continue;

    const existing = await field.inputValue().catch(() => "");
    if (existing) continue; // don't overwrite something already filled

    const callerOverride = Object.entries(extraAnswers).find(([k]) =>
      labelText.toLowerCase().includes(k.toLowerCase())
    );
    if (callerOverride) {
      await setField(field, callerOverride[1]);
      results.push({ fieldLabel: labelText, value: callerOverride[1], source: "caller" });
      continue;
    }

    const configuredAnswer = findAnswerForQuestion(profile, labelText);
    if (configuredAnswer) {
      await setField(field, configuredAnswer);
      results.push({ fieldLabel: labelText, value: configuredAnswer, source: "custom_question_answers" });
      continue;
    }

    const matcher = FIELD_MATCHERS.find((m) => m.test.test(labelText));
    const value = matcher?.profileKey(profile);
    if (typeof value === "string" && value) {
      await setField(field, value);
      results.push({ fieldLabel: labelText, value, source: "profile" });
      continue;
    }

    results.push({ fieldLabel: labelText, value: "", source: "unanswered" });
  }

  return results;
}

async function setField(field: ReturnType<Page["locator"]>, value: string): Promise<void> {
  const tag = await field.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
  try {
    if (tag === "select") {
      await field.selectOption({ label: value }).catch(() => field.selectOption(value));
    } else {
      await field.fill(value);
    }
  } catch {
    // Non-fatal: some widgets (custom dropdowns, date pickers) need
    // bespoke handling per site. Left unfilled rather than guessed further.
  }
}

async function resolveLabelText(page: Page, field: ReturnType<Page["locator"]>): Promise<string | undefined> {
  const aria = await field.getAttribute("aria-label").catch(() => null);
  if (aria) return aria;

  const placeholder = await field.getAttribute("placeholder").catch(() => null);
  if (placeholder) return placeholder;

  const id = await field.getAttribute("id").catch(() => null);
  if (id) {
    const label = page.locator(`label[for="${id}"]`);
    if (await label.count().catch(() => 0)) {
      const text = await label.first().innerText().catch(() => "");
      if (text) return text;
    }
  }

  // Fall back to a wrapping <label> that contains the field.
  const wrappingLabel = field.locator("xpath=ancestor::label[1]");
  if (await wrappingLabel.count().catch(() => 0)) {
    const text = await wrappingLabel.first().innerText().catch(() => "");
    if (text) return text;
  }

  const name = await field.getAttribute("name").catch(() => null);
  return name ?? undefined;
}
