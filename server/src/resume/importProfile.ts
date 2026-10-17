import { newPage } from "../browser.js";
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

/**
 * Reads a LinkedIn profile through the user's own logged-in Chrome (see browser.ts) -
 * LinkedIn has no public profile API and shows nothing useful to logged-out visitors.
 * With no URL it opens /in/me/, which LinkedIn redirects to the signed-in user's profile.
 * The page text is then run through the same extractor used for resumes.
 */
export async function importFromLinkedIn(url: string | undefined, profile: Profile): Promise<ResumeExtraction> {
  const target = url?.trim() ? linkedinProfileUrl(url) : "https://www.linkedin.com/in/me/";
  if (!target) throw new Error("Enter a LinkedIn profile URL (https://www.linkedin.com/in/<handle>).");

  const page = await newPage();
  try {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (/\/(login|authwall|checkpoint)/.test(page.url())) {
      throw new Error("LinkedIn asked to sign in - log in to LinkedIn in the connected Chrome window, then retry.");
    }
    await page.waitForSelector("main h1", { timeout: 15000 });

    // Experience/skills sections render lazily as you scroll.
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(400);
    }

    const { name, headline, location, text } = await page.evaluate(() => {
      const main = document.querySelector("main");
      const top = main?.querySelector("section");
      const pick = (sel: string) => top?.querySelector<HTMLElement>(sel)?.innerText.trim() || undefined;
      return {
        name: main?.querySelector<HTMLElement>("h1")?.innerText.trim(),
        headline: pick(".text-body-medium"),
        location: pick(".text-body-small.inline"),
        text: main?.innerText ?? "",
      };
    });
    const profileUrl = linkedinProfileUrl(page.url()) ?? target;

    // Put the name and headline first so the resume heuristics read them as a header.
    const extracted = await extractProfileFromResume([name, headline, location, text].filter(Boolean).join("\n"), profile, "import_profile");
    return {
      ...extracted,
      personal: stripEmpty({
        ...extracted.personal,
        full_name: name || extracted.personal.full_name,
        location: location || extracted.personal.location,
        linkedin_url: profileUrl,
      }),
      suggestedRoles: headline ? dedupe([headline.split(/\s*[|@•]\s*/)[0], ...extracted.suggestedRoles]) : extracted.suggestedRoles,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

// ---- helpers --------------------------------------------------------------

async function githubGet(path: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "job-search-agent" },
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
