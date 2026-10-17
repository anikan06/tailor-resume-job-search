import type { Page } from "playwright";
import { openPopupWindow } from "../browser.js";
import type { Profile, Project } from "../types.js";
import { extractProfileFromResume, type ResumeExtraction } from "./extractProfile.js";

/**
 * Reads the user's public GitHub profile via the GitHub REST API (no auth needed,
 * 60 requests/hour per IP) and maps it onto the same shape a resume extraction
 * produces, so Settings and the Profile page can fill in from it the same way.
 * Their most-starred own repos become projects.
 */
export async function importFromGitHub(urlOrUsername: string): Promise<ResumeExtraction> {
  const username = githubUsername(urlOrUsername);
  if (!username) throw new Error("Enter a GitHub username or profile URL (https://github.com/<username>).");

  const user = (await githubGet(`/users/${encodeURIComponent(username)}`)) as {
    login: string;
    name: string | null;
    email: string | null;
    location: string | null;
    blog: string | null;
    html_url: string;
    bio: string | null;
  };
  const repos = (await githubGet(`/users/${encodeURIComponent(username)}/repos?per_page=100&sort=pushed&type=owner`)) as {
    name: string;
    html_url: string;
    description: string | null;
    fork: boolean;
    archived?: boolean;
    language: string | null;
    topics?: string[];
    stargazers_count: number;
  }[];

  // Languages weighted by how many of the user's own (non-fork) repos use them.
  const counts = new Map<string, number>();
  for (const repo of repos.filter((r) => !r.fork)) {
    for (const skill of [repo.language, ...(repo.topics ?? []).map(prettyTopic)]) {
      if (skill) counts.set(skill, (counts.get(skill) ?? 0) + 1);
    }
  }
  const skills = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s).slice(0, 15);

  // Stars first; the API's order (most recently pushed) breaks ties. Undescribed, starless repos are usually scratch work.
  const own = repos.filter((r) => !r.fork);
  const projects: Project[] = own
    .filter((r) => !r.archived && (r.description || r.stargazers_count > 0))
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 6)
    .map((r) => stripEmpty({
      name: r.name,
      url: r.html_url,
      technologies: dedupe([r.language ?? "", ...(r.topics ?? []).map(prettyTopic)]).slice(0, 4),
      highlights: r.description ? [r.description.trim()] : [],
    }));
  // Topics are too loose ("Promise", "Npm Package") to list as skills on the profile; repo languages aren't.
  const languages = dedupe(skills.filter((s) => own.some((r) => r.language === s)));
  const bio = user.bio?.replace(/\s+/g, " ").trim();

  return {
    personal: stripEmpty({
      full_name: user.name ?? undefined,
      email: user.email ?? undefined,
      location: user.location ?? undefined,
      github_url: user.html_url,
      portfolio_url: user.blog ? withProtocol(user.blog) : undefined,
    }),
    suggestedRoles: [],
    skills,
    career: { headline: bio && bio.length <= 80 ? bio : undefined, summary: bio && bio.length > 80 ? bio : undefined, skills: languages, projects },
    source: "heuristic",
  };
}

const LINKEDIN_ME = "https://www.linkedin.com/in/me/";
/** How long the sign-in window waits for the user before giving up. */
const SIGN_IN_TIMEOUT_MS = 4 * 60_000;
/** LinkedIn pages a signed-out visitor is sent to. */
const SIGNED_OUT_RE = /linkedin\.com\/(?:$|\?|login|authwall|checkpoint|uas|signup|signin|reg)/i;

/**
 * Each profile's full lists live on /details/<slug>/ pages - the profile itself only
 * shows the first few. Headings are named so the resume reader recognises them.
 */
const DETAIL_SECTIONS: [slug: string, heading: string][] = [
  ["experience", "Experience"],
  ["education", "Education"],
  ["skills", "Skills"],
  ["certifications", "Licenses & Certifications"],
  ["projects", "Projects"],
  ["languages", "Languages"],
  ["honors", "Honors & Awards"],
  ["volunteering-experiences", "Volunteering"],
];

/**
 * Reads a LinkedIn profile through the app's own Chrome - LinkedIn has no public profile
 * API and shows nothing useful to logged-out visitors. A small window opens on the
 * profile; if LinkedIn asks the user to sign in, they do so there (the server never
 * sees their password) and the read carries on as soon as they're in.
 * With no URL it reads /in/me/, which LinkedIn redirects to the signed-in user's profile.
 * The text is then run through the same extractor used for resumes.
 */
export async function importFromLinkedIn(url: string | undefined, profile: Profile): Promise<ResumeExtraction> {
  const target = url?.trim() ? linkedinProfileUrl(url) : LINKEDIN_ME;
  if (!target) throw new Error("Enter a LinkedIn profile URL (https://www.linkedin.com/in/<handle>).");

  const page = await openPopupWindow(target);
  try {
    await waitForSignedInProfile(page, target);
    const profileUrl = linkedinProfileUrl(page.url()) ?? target;

    // The About section renders lazily as you scroll.
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(400);
    }
    const top = await page.evaluate(() => {
      const main = document.querySelector("main");
      const card = main?.querySelector("section");
      const pick = (sel: string) => card?.querySelector<HTMLElement>(sel)?.innerText.trim() || undefined;
      return {
        name: main?.querySelector<HTMLElement>("h1")?.innerText.trim(),
        headline: pick(".text-body-medium"),
        location: pick(".text-body-small.inline"),
        about: document.querySelector("#about")?.closest("section")?.innerText.trim(),
        text: main?.innerText ?? "",
      };
    });

    const contact = await readPage(page, `${profileUrl}overlay/contact-info/`, "[role=dialog], .artdeco-modal");
    const details: string[] = [];
    for (const [slug, heading] of DETAIL_SECTIONS) {
      const text = await readPage(page, `${profileUrl}details/${slug}/`, "main", "/details/");
      // Drop LinkedIn's own heading line; ours is the one the resume reader knows.
      if (text) details.push(`${heading}\n${text.split("\n").slice(1).join("\n").slice(0, 3000)}`);
    }

    const text = [
      top.name,
      top.headline,
      top.location,
      contact?.replace(/^Contact info\s*/i, ""),
      top.about?.replace(/^About\s*/i, "Summary\n"),
      // The detail pages hold everything the profile page does and more; fall back if LinkedIn changed them.
      ...(details.length ? details : [top.text]),
    ]
      .filter(Boolean)
      .join("\n\n");

    const extracted = await extractProfileFromResume(text, profile, "import_profile");
    return {
      ...extracted,
      personal: stripEmpty({
        ...extracted.personal,
        full_name: top.name || extracted.personal.full_name,
        location: top.location || extracted.personal.location,
        linkedin_url: profileUrl,
      }),
      suggestedRoles: top.headline ? dedupe([top.headline.split(/\s*[|@•]\s*/)[0], ...extracted.suggestedRoles]) : extracted.suggestedRoles,
      career: extracted.career && { ...extracted.career, headline: extracted.career.headline ?? top.headline },
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Waits until the window shows a signed-in profile page, steering it back there after sign-in. */
async function waitForSignedInProfile(page: Page, target: string): Promise<void> {
  const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
  let lastRedirect = 0;
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error("The LinkedIn window was closed before your profile could be read.");
    const current = page.url();
    if (!SIGNED_OUT_RE.test(current)) {
      // The global nav only shows when signed in; a public profile view has no such bar.
      const signedIn = await page.$("#global-nav, header.global-nav").catch(() => null);
      const onProfile = /linkedin\.com\/in\/(?!me\/?(?:[?#]|$))[^/?#]+/i.test(current);
      if (signedIn && onProfile && (await page.$("main h1").catch(() => null))) return;
      // Signed in but somewhere else (LinkedIn usually lands on the feed after sign-in).
      if (signedIn && !onProfile && Date.now() - lastRedirect > 5000) {
        lastRedirect = Date.now();
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => undefined);
        continue;
      }
    }
    await page.waitForTimeout(1000).catch(() => undefined);
  }
  throw new Error("Timed out waiting for LinkedIn sign-in - try again and sign in within 4 minutes.");
}

/** Opens a profile sub-page and returns its text, or undefined if LinkedIn doesn't have it for this profile. */
async function readPage(page: Page, url: string, selector: string, mustStayOn?: string): Promise<string | undefined> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (mustStayOn && !page.url().includes(mustStayOn)) return undefined;
    await page.waitForSelector(selector, { timeout: 8000 });
    // Long lists load more items as you scroll.
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(350);
    }
    const text = await page.locator(selector).first().innerText();
    return text.replace(/\n{3,}/g, "\n\n").trim() || undefined;
  } catch {
    return undefined;
  }
}

// ---- helpers --------------------------------------------------------------

async function githubGet(path: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "aahvya-job-aggregator" },
  });
  if (res.status === 404) throw new Error("GitHub user not found.");
  if (res.status === 403) throw new Error("GitHub rate limit hit - try again in a few minutes.");
  if (!res.ok) throw new Error(`GitHub API error (${res.status}).`);
  return res.json();
}

function githubUsername(input: string): string | undefined {
  const trimmed = input.trim().replace(/^@/, "");
  const fromUrl = trimmed.match(/github\.com\/([\w-]+)/i)?.[1];
  const name = fromUrl ?? trimmed;
  return /^[\w-]{1,39}$/.test(name) ? name : undefined;
}

function linkedinProfileUrl(input: string): string | undefined {
  const handle = input.match(/linkedin\.com\/in\/([^/?#\s]+)/i)?.[1];
  return handle ? `https://www.linkedin.com/in/${handle}/` : undefined;
}

/** "machine-learning" -> "Machine Learning" */
function prettyTopic(topic: string): string {
  return topic.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripEmpty<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== "")) as T;
}

function withProtocol(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
