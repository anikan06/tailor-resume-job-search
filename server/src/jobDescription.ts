import { chromium } from "playwright";
import { newPage } from "./browser.js";
import type { Platform } from "./types.js";

/**
 * Best-effort full job description text for platforms whose search results
 * don't already include it (Greenhouse/Lever do, via their public APIs -
 * see platforms/ats.ts - so this is mainly exercised for LinkedIn/Naukri/
 * Indeed/Workday postings).
 */
export async function fetchJobDescriptionText(url: string, platform: Platform): Promise<string> {
  const needsLogin = platform === "linkedin" || platform === "naukri" || platform === "indeed";

  if (needsLogin) {
    const page = await newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      return clean(await page.innerText("body").catch(() => ""));
    } finally {
      await page.close().catch(() => {});
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    return clean(await page.innerText("body").catch(() => ""));
  } finally {
    await browser.close().catch(() => {});
  }
}

function clean(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
}
