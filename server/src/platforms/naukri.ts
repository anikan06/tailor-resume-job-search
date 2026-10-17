import { newPage } from "../browser.js";
import type { JobListing, Profile, FieldAnswer } from "../types.js";
import { fillApplicationForm } from "../formFiller.js";
import { resolveResume, type ResumeSource } from "../jobDescription.js";

/**
 * Naukri search + apply, using your already-logged-in Chrome session.
 * Same hard policy as linkedin.ts: no code path here clicks the final
 * submit/apply-confirm button. Selectors are best-effort and may need
 * updates as Naukri changes its markup.
 */

export async function searchNaukriJobs(keywords: string[], location = "", limit = 20): Promise<JobListing[]> {
  const page = await newPage();
  const query = encodeURIComponent(keywords.join(" "));
  const loc = location ? `-in-${encodeURIComponent(location.toLowerCase().replace(/\s+/g, "-"))}` : "";
  await page.goto(`https://www.naukri.com/${query.replace(/%20/g, "-")}-jobs${loc}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2000);

  const cards = page.locator("div.jobTuple, article.jobTuple, div[data-job-id]");
  const count = Math.min(await cards.count().catch(() => 0), limit);
  const results: JobListing[] = [];

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const titleEl = card.locator("a.title, a.ellipsis.title").first();
    const title = await titleEl.innerText().catch(() => "");
    const href = await titleEl.getAttribute("href").catch(() => null);
    const company = await card.locator("a.subTitle, .comp-name").first().innerText().catch(() => "");
    if (!title || !href) continue;
    results.push({
      platform: "naukri",
      title: title.trim(),
      company: company.trim(),
      url: href,
    });
  }

  await page.close();
  return results;
}

export interface NaukriApplyResult {
  url: string;
  prefilled: FieldAnswer[];
  note: string;
}

export async function prefillNaukriApplication(
  jobUrl: string,
  profile: Profile,
  resume?: ResumeSource,
  extraAnswers: Record<string, string> = {}
): Promise<NaukriApplyResult> {
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

  const applyButton = page.getByRole("button", { name: /apply/i }).first();
  if (await applyButton.count().catch(() => 0)) {
    await applyButton.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  const prefilled = await fillApplicationForm(page, profile, resumeFilePath, extraAnswers);

  return {
    url: jobUrl,
    prefilled,
    note:
      "Prefilled what we could on the Naukri apply flow and stopped before submitting. " +
      "Naukri can flag/ban automated applying, so finish and submit it yourself in the open window.",
  };
}
