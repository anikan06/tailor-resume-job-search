import { newPage } from "../browser.js";
import type { JobListing, Profile, FieldAnswer } from "../types.js";
import { fillApplicationForm } from "../formFiller.js";

/**
 * LinkedIn search + apply. Uses YOUR already-logged-in Chrome (see
 * browser.ts) - no credentials stored here.
 *
 * IMPORTANT / hard policy: this module has NO code path that clicks a final
 * submit/"Review and submit" button. It only opens the job, opens the Easy
 * Apply (or external) form, fills what it confidently can, and stops.
 * LinkedIn actively detects and bans automated applying - do not add a
 * submit step here.
 *
 * Selectors below are best-effort against LinkedIn's current markup as of
 * writing and WILL need occasional updates when LinkedIn changes its DOM -
 * if search returns zero results, that's the first thing to check.
 */

export async function searchLinkedInJobs(keywords: string[], location = "", limit = 20): Promise<JobListing[]> {
  const page = await newPage();
  const params = new URLSearchParams({
    keywords: keywords.join(" "),
    location,
  });
  await page.goto(`https://www.linkedin.com/jobs/search/?${params.toString()}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2000);

  const cards = page.locator("ul.jobs-search__results-list li, div.job-card-container");
  const count = Math.min(await cards.count().catch(() => 0), limit);
  const results: JobListing[] = [];

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const title = await card.locator("h3, .job-card-list__title").first().innerText().catch(() => "");
    const company = await card.locator("h4, .job-card-container__company-name").first().innerText().catch(() => "");
    const href = await card.locator("a").first().getAttribute("href").catch(() => null);
    if (!title || !href) continue;
    results.push({
      platform: "linkedin",
      title: title.trim(),
      company: company.trim(),
      url: href.startsWith("http") ? href : `https://www.linkedin.com${href}`,
    });
  }

  await page.close();
  return results;
}

export interface LinkedInApplyResult {
  url: string;
  prefilled: FieldAnswer[];
  note: string;
}

export async function prefillLinkedInApplication(
  jobUrl: string,
  profile: Profile,
  resumeFilePath?: string,
  extraAnswers: Record<string, string> = {}
): Promise<LinkedInApplyResult> {
  const page = await newPage();
  await page.goto(jobUrl, { waitUntil: "domcontentloaded" });

  const easyApplyButton = page.getByRole("button", { name: /easy apply/i }).first();
  if (await easyApplyButton.count().catch(() => 0)) {
    await easyApplyButton.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  const prefilled = await fillApplicationForm(page, profile, resumeFilePath, extraAnswers);

  // Deliberately leaves the page/modal open and does NOT click Next/Review/Submit.
  return {
    url: jobUrl,
    prefilled,
    note:
      "Prefilled the Easy Apply form and stopped. This tool never submits on LinkedIn - " +
      "switch to the open browser window, review the filled fields (especially any marked " +
      "'unanswered'), and click through to submit yourself.",
  };
}
