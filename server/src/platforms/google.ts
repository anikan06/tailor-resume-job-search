import type { Page } from "playwright";
import { newPage } from "../browser.js";
import type { JobListing, Platform } from "../types.js";

/**
 * Google Jobs search (google.com/search?udm=8), using the same Chrome session.
 * Google is only an aggregator - each listing is resolved to one of its
 * "Apply on ..." links and tagged with the platform that link lands on, so
 * applying goes through that platform's normal flow and policy (a LinkedIn
 * posting found here is still prefill-only). Selectors are best-effort and
 * may need updates as Google changes its markup.
 */

const CARD_SELECTOR = "div.EimVGf";

/** Auto-submit ATS first, then the employer's own site, then boards we have apply flows for, then everything else. */
const PLATFORM_RANK: Record<Platform, number> = {
  greenhouse: 0,
  lever: 0,
  workday: 0,
  other_ats: 2,
  linkedin: 3,
  indeed: 3,
  naukri: 3,
};

export function platformForUrl(url: string): Platform {
  const host = new URL(url).hostname.toLowerCase();
  if (host.endsWith("linkedin.com")) return "linkedin";
  if (host.endsWith("naukri.com")) return "naukri";
  if (/(^|\.)indeed\./.test(host)) return "indeed";
  if (host.endsWith("greenhouse.io")) return "greenhouse";
  if (host.endsWith("lever.co")) return "lever";
  if (host.endsWith("myworkdayjobs.com") || host.endsWith("workday.com")) return "workday";
  return "other_ats";
}

interface ApplyOption {
  via: string;
  href: string;
}

export async function searchGoogleJobs(keywords: string[], location = "", limit = 20): Promise<JobListing[]> {
  const page = await newPage();
  try {
    const q = `${keywords.join(" ")} jobs${location ? ` in ${location}` : ""}`;
    await page.goto(`https://www.google.com/search?${new URLSearchParams({ q, udm: "8" })}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2000);

    const cards = page.locator(CARD_SELECTOR);
    await loadMoreCards(page, limit);
    const count = Math.min(await cards.count().catch(() => 0), limit);
    const results: JobListing[] = [];

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      // Card text: [avatar letter], title, company, "location • via Source", posted, ...
      const lines = (await card.innerText().catch(() => ""))
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 2)
        .map((l) => l.replace(/\bu0026\b/g, "&")); // Google sometimes leaves "&" JSON-escaped
      const [title, company = "", locationLine = "", postedAt] = lines;
      if (!title) continue;

      await card.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await expandDescription(page, title);
      const detail = await readDetailPane(page, title);
      if (!detail || detail.options.length === 0) continue;

      const url = await pickApplyUrl(page, detail.options, company);
      if (!url) continue;

      results.push({
        platform: platformForUrl(url),
        title,
        company,
        location: locationLine.split("•")[0].trim() || undefined,
        url,
        postedAt: /ago$/i.test(postedAt ?? "") ? postedAt : undefined,
        // Usually the full JD, which saves a (possibly login-gated) page fetch when tailoring.
        snippet: detail.description || undefined,
      });
    }

    return results;
  } finally {
    await page.close().catch(() => {});
  }
}

/** The list lazy-loads ~10 at a time as you scroll it. */
async function loadMoreCards(page: Page, limit: number): Promise<void> {
  const cards = page.locator(CARD_SELECTOR);
  for (let round = 0; round < 5; round++) {
    const before = await cards.count().catch(() => 0);
    if (before === 0 || before >= limit) return;
    await cards.nth(before - 1).scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1500);
    if ((await cards.count().catch(() => 0)) === before) return;
  }
}

async function expandDescription(page: Page, title: string): Promise<void> {
  const clicked = await page.evaluate((title) => {
    const panes = [...document.querySelectorAll<HTMLElement>("[role=dialog]")].filter(
      (d) => d.checkVisibility() && (d.innerText || "").includes(title)
    );
    const pane = panes.find((d) => !panes.some((other) => other !== d && d.contains(other)));
    const more = [...(pane?.querySelectorAll<HTMLElement>("div, span, a, button") ?? [])].find(
      (el) => el.checkVisibility() && (el.innerText || "").trim() === "Show full description"
    );
    more?.click();
    return Boolean(more);
  }, title);
  if (clicked) await page.waitForTimeout(500);
}

/**
 * Google pre-renders a carousel of detail panes inside an outer dialog, so the
 * one for this job is the innermost visible dialog that mentions its title.
 */
async function readDetailPane(
  page: Page,
  title: string
): Promise<{ options: ApplyOption[]; description: string } | undefined> {
  return page.evaluate((title) => {
    const matching = [...document.querySelectorAll<HTMLElement>("[role=dialog]")].filter(
      (d) => d.checkVisibility() && (d.innerText || "").includes(title)
    );
    const pane = matching.find((d) => !matching.some((other) => other !== d && d.contains(other)));
    if (!pane) return undefined;

    const options = [...pane.querySelectorAll<HTMLAnchorElement>("a")]
      .filter((a) => /^Apply (directly )?on /i.test(a.innerText || ""))
      .map((a) => ({ via: a.innerText.replace(/^Apply (directly )?on /i, "").trim(), href: a.href }));

    const text = pane.innerText || "";
    const jdStart = text.indexOf("Job description");
    let description = jdStart >= 0 ? text.slice(jdStart + "Job description".length) : "";
    // The pane continues with company ratings and links after the JD.
    for (const marker of ["Show full description", "Show less", "Report this listing"]) {
      const end = description.indexOf(marker);
      if (end >= 0) description = description.slice(0, end);
    }
    description = description.trim();
    return { options, description };
  }, title);
}

/**
 * Apply links are google.com/goto redirects; resolve a few likely-best ones
 * (by their "via" label) and keep whichever lands on the best-ranked platform.
 */
async function pickApplyUrl(page: Page, options: ApplyOption[], company: string): Promise<string | undefined> {
  const companyLower = company.toLowerCase();
  const labelRank = (via: string): number => {
    const v = via.toLowerCase();
    if (/greenhouse|lever|workday/.test(v)) return 0;
    if (/careers|jobs at/.test(v) || (companyLower && v.includes(companyLower.split(/\s+/)[0]))) return 1;
    if (/linkedin|indeed|naukri/.test(v)) return 3;
    return 4;
  };
  const candidates = [...options].sort((a, b) => labelRank(a.via) - labelRank(b.via)).slice(0, 3);

  let best: { url: string; rank: number } | undefined;
  for (const option of candidates) {
    const url = await resolveGoogleRedirect(page, option.href);
    if (!url) continue;
    const platform = platformForUrl(url);
    // An "other_ats" link whose label is the employer's careers site beats a job board.
    let rank = platform === "other_ats" && labelRank(option.via) === 1 ? 1 : PLATFORM_RANK[platform];
    // Google sometimes attaches another company's ATS posting to a listing - don't trust (or auto-submit to) those.
    if (rank === 0 && !atsBelongsTo(url, company)) rank = 5;
    if (!best || rank < best.rank) best = { url, rank };
    if (best.rank === 0) break;
  }
  return best?.url;
}

/** Greenhouse/Lever/Workday URLs name the company (path slug or subdomain); check it loosely against the listing's company. */
function atsBelongsTo(url: string, company: string): boolean {
  const { hostname, pathname } = new URL(url);
  const slug = (hostname.endsWith("myworkdayjobs.com") ? hostname.split(".")[0] : pathname.split("/")[1] ?? "").toLowerCase();
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const tokens = company.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (!slug || tokens.length === 0) return false;
  const slugCompact = compact(slug);
  return slugCompact.includes(compact(company)) || tokens.some((t) => slugCompact.includes(t));
}

async function resolveGoogleRedirect(page: Page, href: string): Promise<string | undefined> {
  try {
    const parsed = new URL(href);
    if (!/(^|\.)google\./.test(parsed.hostname)) return stripTracking(href);
    const res = await page.request.get(href, { maxRedirects: 0 });
    const location = res.headers()["location"];
    return location ? stripTracking(new URL(location, href).toString()) : undefined;
  } catch {
    return undefined;
  }
}

/** Drops Google's utm_* params so the same posting hashes to the same job id across searches. */
function stripTracking(url: string): string {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.startsWith("utm_")) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}
