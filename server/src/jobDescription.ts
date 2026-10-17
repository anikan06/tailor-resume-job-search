import { chromium, type Page } from "playwright";
import { newPage } from "./browser.js";
import type { Platform } from "./types.js";

/**
 * A resume to attach when applying: either a ready PDF path, or a callback
 * that produces one from the already-open job page (e.g. tailoring against
 * the description shown there), so applying never opens the posting twice.
 */
export type ResumeSource = string | ((jobPage: Page) => Promise<string>);

export async function resolveResume(source: ResumeSource | undefined, jobPage: Page): Promise<string | undefined> {
  return typeof source === "function" ? source(jobPage) : source;
}

/** Job description text from a page that's already showing the posting. */
export async function readJobDescription(page: Page): Promise<string> {
  await page.waitForTimeout(1500);
  return clean(await page.innerText("body").catch(() => ""));
}

/**
 * Best-effort full job description text for platforms whose search results
 * don't already include it (Greenhouse/Lever do, via their public APIs -
 * see platforms/ats.ts - so this is mainly exercised for LinkedIn/Naukri/
 * Indeed/Workday postings). Used by the standalone "Tailor resume" action;
 * applying reads the description from the page it opens instead.
 *
 * Reads the posting in a headless browser first so no tab flashes open in
 * your Chrome; only falls back to your logged-in Chrome when the headless
 * read hits a login wall on LinkedIn/Naukri/Indeed.
 */
export async function fetchJobDescriptionText(url: string, platform: Platform): Promise<string> {
  return (await fetchJobPosting(url, platform)).text;
}

/** The posting's description text plus the page's <title>, which often names the role and company. */
export async function fetchJobPosting(url: string, platform: Platform): Promise<{ text: string; pageTitle: string }> {
  const needsLogin = platform === "linkedin" || platform === "naukri" || platform === "indeed";

  const browser = await chromium.launch({ headless: true });
  let headless = { text: "", pageTitle: "", blocked: true };
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // Workday and other script-rendered career sites fill the page in after load.
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    const text = await readJobDescription(page);
    headless = {
      text,
      pageTitle: await page.title().catch(() => ""),
      blocked: /login|signin|sign-in|authwall|checkpoint/i.test(page.url()) || text.length < 500,
    };
  } catch {
    // Fall through to the logged-in browser (or return whatever we have).
  } finally {
    await browser.close().catch(() => {});
  }
  if (!needsLogin || !headless.blocked) return { text: headless.text, pageTitle: headless.pageTitle };

  const page = await newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return { text: await readJobDescription(page), pageTitle: await page.title().catch(() => "") };
  } finally {
    await page.close().catch(() => {});
  }
}

function clean(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
}
