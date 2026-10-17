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
  const needsLogin = platform === "linkedin" || platform === "naukri" || platform === "indeed";

  const browser = await chromium.launch({ headless: true });
  let headless = { text: "", blocked: true };
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const text = await readJobDescription(page);
    headless = { text, blocked: /login|signin|sign-in|authwall|checkpoint/i.test(page.url()) || text.length < 500 };
  } catch {
    // Fall through to the logged-in browser (or return whatever we have).
  } finally {
    await browser.close().catch(() => {});
  }
  if (!needsLogin || !headless.blocked) return headless.text;

  const page = await newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return await readJobDescription(page);
  } finally {
    await page.close().catch(() => {});
  }
}

function clean(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
}
