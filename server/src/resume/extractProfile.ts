import { completeText, extractJson, isAiConfigured } from "../llm.js";
import type { LlmActivity } from "../telemetry.js";
import type { CareerProfile, Profile } from "../types.js";
import { careerToText, extractCareerHeuristically, stripEmptyCareer } from "./careerSections.js";

export interface ResumeExtraction {
  personal: Partial<
    Pick<
      Profile["personal"],
      "full_name" | "email" | "phone" | "location" | "linkedin_url" | "github_url" | "portfolio_url" | "years_experience"
    >
  >;
  /** Job titles the candidate is a plausible fit for, best match first. */
  suggestedRoles: string[];
  /** Skills/technologies found in the resume, most prominent first. */
  skills: string[];
  /** Headline, summary, experience, education etc. for the Profile page. Absent in extractions saved before it existed. */
  career?: CareerProfile;
  source: "ai" | "heuristic";
}

/**
 * Pulls form-fillable details and role suggestions out of resume text so the
 * Settings page can prefill itself. Heuristics always run (no API key needed);
 * if the user has configured an AI provider, its reading takes priority
 * and the heuristics only fill whatever it left blank.
 */
export async function extractProfileFromResume(
  text: string,
  profile: Profile,
  activity: LlmActivity = "extract_resume"
): Promise<ResumeExtraction> {
  const heuristic = extractHeuristically(text);
  if (!isAiConfigured(profile)) return heuristic;

  try {
    const ai = await extractWithAI(text, profile, activity);
    return {
      personal: { ...heuristic.personal, ...stripEmpty(ai.personal) },
      suggestedRoles: dedupe([...(ai.suggestedRoles ?? []), ...heuristic.suggestedRoles]).slice(0, 10),
      skills: dedupe([...(ai.skills ?? []), ...heuristic.skills]).slice(0, 15),
      career: mergeCareer(stripEmptyCareer(ai.career ?? {}), heuristic.career ?? {}),
      source: "ai",
    };
  } catch (err) {
    console.error("[job-search-agent] AI resume extraction failed, using heuristics:", (err as Error).message);
    return heuristic;
  }
}

// ---- AI ---------------------------------------------------------------

async function extractWithAI(text: string, profile: Profile, activity: LlmActivity): Promise<Omit<ResumeExtraction, "source">> {
  const prompt = `Extract structured details from this resume. Only use information actually present in the text; use null for anything missing.

"suggestedRoles": 5-8 job titles this candidate would realistically apply for next, best fit first, matching their seniority (e.g. "Senior Frontend Engineer", "Angular Architect").
"skills": up to 12 core technical skills/tools, most prominent first.
"years_experience": total years of professional experience as an integer, from an explicit statement or the work history dates.
"career": the resume's content, copied faithfully (do not rewrite, summarize or invent):
  - "headline": the candidate's current title/tagline, e.g. "Senior Frontend Engineer".
  - "summary": the summary/objective paragraph as written, or null.
  - "skills": every skill/tool listed in the resume.
  - "experience": every job, most recent first; "highlights" are its bullet points verbatim; "current" is true if it runs to the present (then "end_date" is null).
  - "education", "projects", "certifications": every entry listed.
  - "languages": spoken languages only (programming languages go in "skills"), with proficiency if stated.
  - "additional_sections": any other section (e.g. Achievements, Awards, Publications, Volunteering, Interests) with its heading and items verbatim; skip declarations and references.
  - Dates exactly as written in the resume (e.g. "Jan 2020", "2019").

Output ONLY valid JSON, no prose, no markdown fences, exactly this shape:
{
  "personal": {
    "full_name": string|null, "email": string|null, "phone": string|null, "location": string|null,
    "linkedin_url": string|null, "github_url": string|null, "portfolio_url": string|null, "years_experience": number|null
  },
  "suggestedRoles": string[],
  "skills": string[],
  "career": {
    "headline": string|null, "summary": string|null, "skills": string[],
    "experience": [{ "title": string|null, "company": string|null, "location": string|null, "start_date": string|null, "end_date": string|null, "current": boolean, "highlights": string[] }],
    "education": [{ "institution": string|null, "degree": string|null, "field": string|null, "start_date": string|null, "end_date": string|null, "grade": string|null, "details": string[] }],
    "projects": [{ "name": string|null, "url": string|null, "technologies": string[], "highlights": string[] }],
    "certifications": [{ "name": string|null, "issuer": string|null, "date": string|null, "url": string|null }],
    "languages": [{ "name": string|null, "proficiency": string|null }],
    "additional_sections": [{ "heading": string|null, "items": string[] }]
  }
}

RESUME TEXT:
${text.slice(0, 12000)}`;

  // The career block copies the whole resume, so it needs far more room than the personal details.
  return JSON.parse(extractJson(await completeText(prompt, 6000, profile, { activity })));
}

// ---- heuristics ---------------------------------------------------------

/** Skill → canonical display name. Matched case-insensitively on word boundaries. */
const SKILLS: Record<string, string> = {
  angular: "Angular", angularjs: "AngularJS", react: "React", "react native": "React Native", "next.js": "Next.js",
  vue: "Vue", svelte: "Svelte", typescript: "TypeScript", javascript: "JavaScript", rxjs: "RxJS", ngrx: "NgRx",
  redux: "Redux", html: "HTML", css: "CSS", scss: "SCSS", tailwind: "Tailwind", webpack: "Webpack",
  "micro frontends": "Micro Frontends", "micro-frontends": "Micro Frontends", "module federation": "Module Federation",
  "node.js": "Node.js", nodejs: "Node.js", express: "Express", nestjs: "NestJS", python: "Python", django: "Django",
  flask: "Flask", fastapi: "FastAPI", java: "Java", spring: "Spring", kotlin: "Kotlin", go: "Go", golang: "Go",
  rust: "Rust", "c#": "C#", ".net": ".NET", ruby: "Ruby", rails: "Rails", php: "PHP", swift: "Swift", flutter: "Flutter",
  graphql: "GraphQL", rest: "REST", sql: "SQL", postgresql: "PostgreSQL", mysql: "MySQL", mongodb: "MongoDB",
  redis: "Redis", kafka: "Kafka", aws: "AWS", azure: "Azure", gcp: "GCP", docker: "Docker", kubernetes: "Kubernetes",
  terraform: "Terraform", "ci/cd": "CI/CD", jenkins: "Jenkins", jest: "Jest", cypress: "Cypress", playwright: "Playwright",
  "machine learning": "Machine Learning", "deep learning": "Deep Learning", pytorch: "PyTorch", tensorflow: "TensorFlow",
  pandas: "Pandas", spark: "Spark", tableau: "Tableau", "power bi": "Power BI", figma: "Figma", llm: "LLMs",
  selenium: "Selenium", agile: "Agile", scrum: "Scrum",
};

/** Role families scored by how many of their signal skills appear in the resume. */
const ROLE_FAMILIES: { role: string; signals: string[] }[] = [
  { role: "Frontend Engineer", signals: ["Angular", "AngularJS", "React", "Vue", "Svelte", "TypeScript", "JavaScript", "RxJS", "NgRx", "Redux", "HTML", "CSS", "SCSS", "Next.js", "Micro Frontends"] },
  { role: "Angular Developer", signals: ["Angular", "AngularJS", "RxJS", "NgRx"] },
  { role: "React Developer", signals: ["React", "Redux", "Next.js", "React Native"] },
  { role: "UI Architect", signals: ["Micro Frontends", "Module Federation", "Webpack", "Angular", "React"] },
  { role: "Full Stack Engineer", signals: ["Node.js", "Express", "NestJS", "React", "Angular", "SQL", "MongoDB", "PostgreSQL", "REST", "GraphQL"] },
  { role: "Backend Engineer", signals: ["Node.js", "Java", "Spring", "Go", "Python", "Django", "FastAPI", ".NET", "C#", "SQL", "PostgreSQL", "Kafka", "Redis"] },
  { role: "Mobile Developer", signals: ["React Native", "Flutter", "Swift", "Kotlin"] },
  { role: "DevOps Engineer", signals: ["Docker", "Kubernetes", "Terraform", "AWS", "Azure", "GCP", "CI/CD", "Jenkins"] },
  { role: "Data Engineer", signals: ["Spark", "Kafka", "SQL", "Python", "AWS"] },
  { role: "Data Scientist", signals: ["Machine Learning", "Deep Learning", "PyTorch", "TensorFlow", "Pandas", "Python"] },
  { role: "Data Analyst", signals: ["SQL", "Tableau", "Power BI", "Pandas"] },
  { role: "QA Automation Engineer", signals: ["Selenium", "Cypress", "Playwright", "Jest"] },
];

const TITLE_RE =
  /\b(?:(?:Senior|Sr\.?|Lead|Principal|Staff|Junior|Associate)\s+)?(?:(?:Front[- ]?end|Back[- ]?end|Full[- ]?stack|Software|Web|UI|Mobile|Data|ML|Machine Learning|DevOps|Cloud|QA|Platform|Angular|React|Java|Python|\.NET|Node(?:\.js)?)\s+){1,2}(?:Engineer|Developer|Architect|Scientist|Analyst|Lead|Manager|Consultant)\b|\b(?:Engineering Manager|Tech(?:nical)? Lead|Solutions? Architect)\b/gi;

export function extractHeuristically(text: string): ResumeExtraction {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const header = lines.slice(0, 10).join("\n");

  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  const phone = header.match(/(?:\+\d{1,3}[\s-]*)?(?:\(?\d{2,5}\)?[\s-]?){1,4}\d{2,5}/)?.[0]?.trim();
  const linkedin = text.match(/(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/in\/[\w%-]+\/?/i)?.[0];
  const github = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/i)?.[0];
  const portfolio = (text.match(/(?:https?:\/\/|www\.)[^\s|,;]+/gi) ?? []).find((u) => !/linkedin|github/i.test(u));

  const yearsExperience = extractYears(text);
  const skills = extractSkills(text);

  return {
    personal: stripEmpty({
      full_name: extractName(lines),
      email,
      phone: phone && phone.replace(/\D/g, "").length >= 10 ? phone : undefined,
      location: extractLocation(lines.slice(0, 10)),
      linkedin_url: linkedin && withProtocol(linkedin),
      github_url: github && withProtocol(github),
      portfolio_url: portfolio && withProtocol(portfolio),
      years_experience: yearsExperience,
    }),
    suggestedRoles: suggestRoles(text, skills, yearsExperience),
    skills: skills.slice(0, 15),
    career: extractCareerHeuristically(text),
    source: "heuristic",
  };
}

function extractName(lines: string[]): string | undefined {
  const name = lines
    .slice(0, 5)
    .find((l) => /^[\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*){1,3}$/u.test(l) && !/resume|curriculum|vitae|profile/i.test(l));
  // Resume headers are often set in all caps ("JANE DOE").
  return name && name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()) : name;
}

function extractLocation(headerLines: string[]): string | undefined {
  const parts = headerLines.flatMap((l) => l.split(/\s*[|•·◦▪]\s*/));
  return parts.find(
    (p) => /^[A-Z][\p{L} .]+,\s*[A-Z][\p{L} .]+$/u.test(p) && p.length <= 40 && !/@|\d/.test(p)
  );
}

function extractYears(text: string): number | undefined {
  const explicit = text.match(/(\d{1,2})\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:\w+\s+){0,3}experience/i);
  if (explicit) return Number(explicit[1]);

  const now = new Date().getFullYear();
  const starts = [...text.matchAll(/\b((?:19|20)\d{2})\s*(?:[-–—]|to)\s*(?:(?:19|20)\d{2}|present|current|now|till date)\b/gi)]
    .map((m) => Number(m[1]))
    .filter((y) => y <= now && y > now - 50);
  return starts.length ? now - Math.min(...starts) : undefined;
}

function extractSkills(text: string): string[] {
  const counts = new Map<string, number>();
  for (const [needle, name] of Object.entries(SKILLS)) {
    const re = new RegExp(`(?<![\\w.])${escapeRe(needle)}(?![\\w])`, "gi");
    const n = text.match(re)?.length ?? 0;
    if (n) counts.set(name, (counts.get(name) ?? 0) + n);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

function suggestRoles(text: string, skills: string[], years: number | undefined): string[] {
  // Titles the candidate has actually held are the strongest signal.
  const held = dedupe((text.match(TITLE_RE) ?? []).map(titleCase));

  const skillSet = new Set(skills);
  const prefix = years === undefined ? "" : years >= 8 ? "Senior " : years >= 4 ? "" : "Junior ";
  // Broad families (many signals) need more evidence than narrow ones before they're suggested.
  const inferred = ROLE_FAMILIES.map((f) => ({ ...f, score: f.signals.filter((s) => skillSet.has(s)).length }))
    .filter((f) => f.score >= Math.min(3, Math.ceil(f.signals.length / 2)))
    .sort((a, b) => b.score - a.score)
    .map((f) => prefix + f.role);

  const leadership = years !== undefined && years >= 8 && skills.length ? ["Tech Lead"] : [];
  return dedupe([...held, ...inferred, ...leadership]).slice(0, 10);
}

/**
 * Re-derives skill and role suggestions from the Profile page's career data, so
 * skills the user adds there (and not just what the resume said) shape the
 * suggestions. Works with or without an uploaded resume.
 */
export function withCareerSuggestions(
  extracted: ResumeExtraction | undefined,
  profile: Profile
): ResumeExtraction | undefined {
  const text = careerToText(profile.career);
  if (!text) return extracted;
  const years = profile.personal?.years_experience ?? extracted?.personal.years_experience;
  const skills = dedupe([...(profile.career?.skills ?? []), ...extractSkills(text)]);
  const roles = suggestRoles(text, extractSkills(text), years);
  if (!extracted) return { personal: {}, suggestedRoles: roles, skills: skills.slice(0, 15), source: "heuristic" };
  return {
    ...extracted,
    // The resume's best few stay on top; roles the profile newly supports come next.
    suggestedRoles: dedupe([...extracted.suggestedRoles.slice(0, 4), ...roles, ...extracted.suggestedRoles]).slice(0, 10),
    skills: dedupe([...skills, ...extracted.skills]).slice(0, 15),
  };
}

// ---- utils --------------------------------------------------------------

/** The AI's reading wins per field; heuristics only fill fields it left empty. */
function mergeCareer(ai: CareerProfile, heuristic: CareerProfile): CareerProfile {
  const merged: Record<string, unknown> = { ...heuristic };
  for (const [key, value] of Object.entries(ai)) {
    if (Array.isArray(value) ? value.length : value) merged[key] = value;
  }
  return merged as CareerProfile;
}

function titleCase(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (/^(UI|ML|QA|\.NET)$/i.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ")
    .replace(/^Sr\.? /, "Senior ");
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripEmpty<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "")) as T;
}

function withProtocol(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^www\./i, "www.")}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
