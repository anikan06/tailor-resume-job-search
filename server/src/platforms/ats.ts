import { chromium } from "playwright";
import type { JobListing, Platform, Profile, FieldAnswer } from "../types.js";
import { fillApplicationForm } from "../formFiller.js";
import { canAutoSubmit } from "../policy.js";

/**
 * Greenhouse and Lever both publish a public, unauthenticated JSON API for
 * a company's job board - no scraping/login needed for search. Workday has
 * no equivalent public API (every tenant is a bespoke instance), so Workday
 * search/apply is best-effort browser automation and more likely to need
 * per-company adjustment - flagged clearly in results.
 */

export async function searchGreenhouse(boardToken: string, keywords: string[] = []): Promise<JobListing[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Greenhouse board "${boardToken}" lookup failed: HTTP ${res.status}`);
  const data = (await res.json()) as { jobs: any[] };
  return data.jobs
    .filter((j) => keywords.length === 0 || keywords.some((k) => j.title.toLowerCase().includes(k.toLowerCase())))
    .map((j) => ({
      platform: "greenhouse" as Platform,
      title: j.title,
      company: boardToken,
      location: j.location?.name,
      url: j.absolute_url,
      postedAt: j.updated_at,
      snippet: j.content ? stripHtml(j.content).slice(0, 6000) : undefined,
    }));
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function searchLever(company: string, keywords: string[] = []): Promise<JobListing[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Lever board "${company}" lookup failed: HTTP ${res.status}`);
  const data = (await res.json()) as any[];
  return data
    .filter((j) => keywords.length === 0 || keywords.some((k) => j.text.toLowerCase().includes(k.toLowerCase())))
    .map((j) => ({
      platform: "lever" as Platform,
      title: j.text,
      company,
      location: j.categories?.location,
      url: j.hostedUrl,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      snippet: j.descriptionPlain ? String(j.descriptionPlain).slice(0, 6000) : undefined,
    }));
}

export interface AtsApplyResult {
  platform: Platform;
  url: string;
  prefilled: FieldAnswer[];
  submitted: boolean;
  note: string;
}

/**
 * Applies to a Greenhouse/Lever/Workday posting. Opens a *visible* Chromium
 * window (not headless) so that even when we don't auto-submit, you can see
 * exactly what got filled and finish it yourself.
 *
 * `confirmSubmit` is a second, explicit gate on top of policy.ts - even on
 * an auto-submit-eligible platform, nothing gets submitted unless the
 * caller passes confirmSubmit: true for THIS call.
 */
export async function applyToAtsJob(
  platform: Platform,
  jobUrl: string,
  profile: Profile,
  resumeFilePath?: string,
  extraAnswers: Record<string, string> = {},
  confirmSubmit = false
): Promise<AtsApplyResult> {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  try {
    await page.goto(jobUrl, { waitUntil: "domcontentloaded" });

    // Greenhouse/Lever often gate the actual form behind an "Apply" button.
    const applyButton = page.getByRole("button", { name: /apply/i }).first();
    if (await applyButton.count().catch(() => 0)) {
      await applyButton.click({ timeout: 3000 }).catch(() => {});
    }

    const prefilled = await fillApplicationForm(page, profile, resumeFilePath, extraAnswers);

    const allowed = canAutoSubmit(platform);
    const hasUnanswered = prefilled.some((f) => f.source === "unanswered");

    if (allowed && confirmSubmit && !hasUnanswered) {
      const submitButton = page
        .getByRole("button", { name: /submit application|submit|apply/i })
        .first();
      await submitButton.click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      await browser.close();
      return { platform, url: jobUrl, prefilled, submitted: true, note: "Submitted." };
    }

    const reason = !allowed
      ? "this platform is not in the auto-submit allow-list"
      : !confirmSubmit
      ? "confirmSubmit was not set to true for this call"
      : "some fields were left unanswered - review before submitting";

    // Leave the window open for manual review/submit instead of closing it.
    return {
      platform,
      url: jobUrl,
      prefilled,
      submitted: false,
      note: `Prefilled but not submitted (${reason}). Browser window left open for you to review and submit.`,
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}
