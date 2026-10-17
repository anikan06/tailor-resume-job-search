import { newPage } from "../browser.js";
import type { JobListing, Profile, FieldAnswer } from "../types.js";
import { fillApplicationForm } from "../formFiller.js";
import { resolveResume, type ResumeSource } from "../jobDescription.js";

/**
 * Indeed search + apply, using your already-logged-in Chrome session.
 * Same hard policy as linkedin.ts/naukri.ts: never auto-submits. Selectors
 * are best-effort and may need updates as Indeed changes its markup.
 * Defaults to indeed.co.in; pass a full domain override if you search from
 * elsewhere.
 */

export async function searchIndeedJobs(
  keywords: string[],
  location = "",
  limit = 20,
  domain = "in.indeed.com"
): Promise<JobListing[]> {
  const page = await newPage();
  const params = new URLSearchParams({ q: keywords.join(" "), l: location });
  await page.goto(`https://${domain}/jobs?${params.toString()}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const cards = page.locator("div.job_seen_beacon, td.resultContent, div[data-jk]");
  const count = Math.min(await cards.count().catch(() => 0), limit);
  const results: JobListing[] = [];

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const titleEl = card.locator("h2 a, a.jcs-JobTitle").first();
    const title = await titleEl.innerText().catch(() => "");
    const href = await titleEl.getAttribute("href").catch(() => null);
    const company = await card.locator("span.companyName, [data-testid='company-name']").first().innerText().catch(() => "");
    if (!title || !href) continue;
    results.push({
      platform: "indeed",
      title: title.trim(),
      company: company.trim(),
      url: href.startsWith("http") ? href : `https://${domain}${href}`,
    });
  }

  await page.close();
  return results;
}

export interface IndeedApplyResult {
  url: string;
  prefilled: FieldAnswer[];
  note: string;
}

export async function prefillIndeedApplication(
  jobUrl: string,
  profile: Profile,
  resume?: ResumeSource,
  extraAnswers: Record<string, string> = {}
): Promise<IndeedApplyResult> {
  const page = await newPage();
  await page.goto(jobUrl, { waitUntil: "domcontentloaded" });

  // Tailoring (when the resume is a callback) reads the description from this same page.
  let resumeFilePath: string | undefined;
  try {
    resumeFilePath = await resolveResume(resume, page);
  } catch (err) {
    await page.close().catch(() => {});
    throw err;
  }

  const applyButton = page.getByRole("button", { name: /apply now|apply/i }).first();
  if (await applyButton.count().catch(() => 0)) {
    await applyButton.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  const prefilled = await fillApplicationForm(page, profile, resumeFilePath, extraAnswers);

  return {
    url: jobUrl,
    prefilled,
    note:
      "Prefilled what we could on Indeed's apply flow and stopped before submitting - " +
      "finish and submit it yourself in the open window.",
  };
}
