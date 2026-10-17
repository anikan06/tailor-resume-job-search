import { completeText, extractJson } from "./llm.js";
import type { TailoredResumeInput } from "./resume/generate.js";
import type { CareerProfile, Profile } from "./types.js";

export interface TailorContentResult extends TailoredResumeInput {
  /** The job description's most important keywords, in its own wording - used for the ATS match report. */
  jdKeywords?: string[];
}

/** How many of the job description's keywords the resume contains, before and after tailoring. */
export interface AtsReport {
  keywords: string[];
  matched: string[];
  /** Keywords the candidate's real resume/profile doesn't show - deliberately not invented. */
  missing: string[];
  /** Percent of keywords found in the original resume text and in the tailored resume. */
  scoreBefore: number;
  scoreAfter: number;
}

/** What the resume is written for: one job description, or the candidate's target roles in general. */
type ResumeTarget =
  | { kind: "job"; jobTitle: string; company: string; jobDescription: string }
  | { kind: "general"; roles: string[] };

/**
 * The resume-writing prompt shared by job tailoring and the Profile page's general ATS resume:
 * the same truthfulness, ATS and content rules, aimed either at one JD or at the target roles.
 */
function resumePrompt(target: ResumeTarget, resumeText: string, profile: Profile): string {
  const career = profile.career && Object.keys(profile.career).length ? JSON.stringify(profile.career).slice(0, 12000) : "";
  const contact = JSON.stringify(
    Object.fromEntries(
      (["full_name", "email", "phone", "location", "linkedin_url", "github_url", "portfolio_url"] as const)
        .map((k) => [k, profile.personal?.[k]])
        .filter(([, v]) => v)
    )
  );
  const job = target.kind === "job";
  const sources = resumeText ? "the RESUME TEXT or the CANDIDATE PROFILE" : "the CANDIDATE PROFILE";
  const roles = !job && target.roles.length ? target.roles.join(", ") : "";

  return `You are an expert resume writer and ATS (Applicant Tracking System) specialist, ${
    job ? "tailoring a real candidate's resume for one specific job application" : `writing a polished, ATS-friendly master resume for a real candidate${roles ? `, aimed at these target roles: ${roles}` : ""}`
  }.

TRUTHFULNESS (non-negotiable):
- Do NOT invent, exaggerate, or add experience, skills, titles, employers, dates, degrees, certifications or metrics that are not present in ${sources} below.
- The CANDIDATE PROFILE is the candidate's own up-to-date record: ${resumeText ? "where it differs from the resume text it wins, and " : ""}anything it contains (skills, languages, extra sections) is true and may be used.
- Keep every claim traceable to something actually in ${sources}. Only use numbers that appear there.

ATS OPTIMISATION:
- Use only standard section headings, in this order where content exists: "Skills", "Professional Experience", "Projects", "Education", "Certifications", "Languages" (plus any other real section the candidate has, e.g. "Awards", "Publications"). The summary goes in the "summary" field, not a section.
${
  job
    ? `- Mirror the JOB DESCRIPTION's exact wording for skills and tools the candidate genuinely has (e.g. if the JD says "Kubernetes" and the resume says "K8s", write "Kubernetes (K8s)"). Spell out an acronym once alongside its short form when the JD uses either.
- Work the JD's most important keywords the candidate truly has into the summary, the Skills section AND the experience bullets where they were actually used - naturally, never as keyword stuffing.`
    : `- Use the industry-standard names recruiters search for${roles ? ` in ${roles} postings` : ""} (e.g. "Kubernetes (K8s)" rather than only "K8s"). Spell out an acronym once alongside its short form.
- Work the candidate's strongest, most in-demand skills into the summary, the Skills section AND the experience bullets where they were actually used - naturally, never as keyword stuffing.`
}
- Plain text only: no tables, columns, icons, emojis, symbols like ★ or ►, or first-person pronouns ("I", "my").

CONTENT QUALITY:
- headline: ${job ? "the target job title as the JD phrases it, if the candidate's background fits it; otherwise their closest real title." : `${roles ? "the target role that best fits the candidate's real background, or " : ""}the candidate's own headline/current title.`}
- summary: 3-4 sentences - years/level of experience, core expertise${job ? " matching the JD" : ""}, 1-2 standout real achievements, and what they bring${job ? " to this role" : ""}.
- Experience in reverse-chronological order. Keep every role (no unexplained gaps) but give recent/relevant roles 3-6 bullets and older/less relevant ones 1-3.
- Each bullet: starts with a strong action verb (past tense for past roles, present for the current one), shows what was done, how, and the measurable result where the source has one. One idea per bullet, at most ~30 words. Lead each role with its most ${job ? "JD-relevant" : "impressive"} bullet. Vary the action verbs.
- Dates as "MMM YYYY - MMM YYYY" or "MMM YYYY - Present", consistent everywhere.
- Skills: group into a few lines of the form "Category: skill, skill, skill" (e.g. "Languages: ...", "Frameworks: ...", "Cloud & DevOps: ..."), ${job ? "JD-matching" : "the most in-demand"} skills first. List EVERY skill in the CANDIDATE PROFILE's "skills" - drop none of them.
- Languages section lists EVERY entry in the CANDIDATE PROFILE's "languages".
- Aim for a resume that fits on 1 page for under ~7 years of experience, 2 pages otherwise - trim the least relevant content to get there.
${
  job
    ? `
jdKeywords: separately, list the 15-25 most important hard skills, tools, technologies, methodologies, certifications and qualifications the JOB DESCRIPTION asks for, most important first - whether or not the candidate has them. One term per entry in the JD's own wording, 1-3 words, no parentheses, slashes or version numbers (e.g. "JavaScript", "REST API", "Agile", "Scrum", "Accessibility", "WCAG" - not "JavaScript (ES6+)" or "Agile/Scrum").
`
    : ""
}
Output ONLY valid JSON, no prose, no markdown fences, matching exactly this shape:
{
  "headerTitle": "string - candidate's full name only",
  "headline": "string - professional title, see above",
  "contactLine": "string - contact details separated by ' | ' (email | phone | city, country | LinkedIn | GitHub/portfolio)",
  "summary": "string",
  "sections": [
    { "heading": "Skills", "lines": ["Category: skill, skill"] },
    { "heading": "Professional Experience", "entries": [ { "title": "Job title", "organization": "Company", "location": "City, Country", "dates": "MMM YYYY - Present", "bullets": ["..."] } ] },
    { "heading": "Education", "entries": [ { "title": "Degree, Field", "organization": "Institution", "location": "", "dates": "YYYY - YYYY", "bullets": [] } ] },
    { "heading": "Certifications", "lines": ["..."] }
  ]${job ? `,
  "jdKeywords": ["..."]` : ""}
}
Use "entries" for sections made of roles/projects/degrees and "lines" for lists (skills, certifications, languages).
${
  job
    ? `
JOB TITLE: ${target.jobTitle}
COMPANY: ${target.company}

JOB DESCRIPTION:
${target.jobDescription.slice(0, 8000)}
`
    : ""
}
CONTACT DETAILS (JSON, from the candidate's settings - prefer these):
${contact}${resumeText ? `

RESUME TEXT:
${resumeText.slice(0, 12000)}` : ""}${career ? `

CANDIDATE PROFILE (JSON, edited by the candidate):
${career}` : ""}`;
}

/** Sends a resume prompt and parses the JSON content it returns, with the Profile page's skills guaranteed in. */
async function writeResume(prompt: string, profile: Profile, jobId?: string): Promise<TailorContentResult> {
  const jsonText = extractJson(await completeText(prompt, 4000, profile, { activity: "tailor_resume", jobId }));
  let content: TailorContentResult;
  try {
    content = JSON.parse(jsonText) as TailorContentResult;
  } catch (err) {
    throw new Error(`AI tailoring returned non-JSON content that couldn't be parsed: ${(err as Error).message}`);
  }
  return withProfileSkills(content, profile.career);
}

/**
 * Calls the user's chosen AI provider with their own key (never stored
 * anywhere but their local profile.yaml, never sent anywhere except that
 * provider) to rewrite/reorder the candidate's real resume content for one specific job
 * description. It is explicitly told not to invent experience - only to
 * re-emphasize, reorder and trim what's already in the resume text or the
 * candidate's own edits on the Profile page (skills, languages etc. added there).
 */
export async function tailorResumeWithAI(
  resumeText: string,
  jobTitle: string,
  company: string,
  jobDescription: string,
  profile: Profile,
  jobId?: string
): Promise<TailorContentResult> {
  return writeResume(resumePrompt({ kind: "job", jobTitle, company, jobDescription }, resumeText, profile), profile, jobId);
}

/**
 * The Profile page's "Generate ATS resume": a general, job-independent resume written from the
 * Profile details (plus the uploaded resume text, if any, for anything the profile lacks),
 * aimed at the target roles from Settings. Same truthfulness rules as tailoring.
 */
export async function generateAtsResumeWithAI(profile: Profile, resumeText = ""): Promise<TailorContentResult> {
  const roles = (profile.search?.target_roles ?? []).filter((r) => r.trim()).slice(0, 5);
  return writeResume(resumePrompt({ kind: "general", roles }, resumeText, profile), profile);
}

const SKILLS_HEADING_RE = /skill|technolog|tech stack|competenc|tools/i;
const LANGUAGES_HEADING_RE = /language/i;

/**
 * The AI tends to trim skills it finds irrelevant to the job, but anything the candidate
 * added on the Profile page (a new framework, a spoken language) must show up on the
 * resume - so whatever it left out is appended to the matching section here.
 */
export function withProfileSkills(content: TailorContentResult, career: CareerProfile | undefined): TailorContentResult {
  const sections = (content.sections ?? []).map((s) => ({ ...s, heading: s.heading, lines: [...(s.lines ?? [])] }));
  const isLanguages = (h: string) => LANGUAGES_HEADING_RE.test(h) && !/programming/i.test(h);
  const skillsSection = sections.find((s) => SKILLS_HEADING_RE.test(s.heading) && !isLanguages(s.heading));
  const languagesSection = sections.find((s) => isLanguages(s.heading));

  // Programming languages often sit under a "Programming Languages" heading, so search all skill-ish sections.
  const skillText = sections.filter((s) => SKILLS_HEADING_RE.test(s.heading) || LANGUAGES_HEADING_RE.test(s.heading)).flatMap((s) => s.lines);
  const missingSkills = (career?.skills ?? []).filter((skill) => skill.trim() && !mentions(skillText, skill));
  if (missingSkills.length) {
    if (skillsSection) skillsSection.lines.push(missingSkills.join(", "));
    else sections.push({ heading: "Skills", lines: [missingSkills.join(", ")] });
  }

  const missingLanguages = (career?.languages ?? [])
    .filter((l) => l.name?.trim() && !mentions(languagesSection?.lines ?? [], l.name))
    .map((l) => (l.proficiency ? `${l.name} (${l.proficiency})` : l.name!));
  if (missingLanguages.length) {
    if (languagesSection) languagesSection.lines.push(missingLanguages.join(", "));
    else sections.push({ heading: "Languages", lines: [missingLanguages.join(", ")] });
  }

  return { ...content, sections };
}

/**
 * Checks each JD keyword against the original resume text and the tailored resume, the way
 * an ATS keyword filter would - so the user sees what tailoring gained and what's genuinely missing.
 */
export function atsKeywordReport(content: TailorContentResult, resumeText: string): AtsReport {
  const seen = new Set<string>();
  const keywords = (content.jdKeywords ?? [])
    .map((k) => String(k ?? "").trim())
    .filter((k) => k && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()))
    .slice(0, 30);
  const tailoredText = resumeLines(content);
  const found = (lines: string[], keyword: string) => keywordVariants(keyword).some((v) => mentions(lines, v));
  const matched = keywords.filter((k) => found(tailoredText, k));
  const before = keywords.filter((k) => found([resumeText], k)).length;
  const pct = (n: number) => (keywords.length ? Math.round((n / keywords.length) * 100) : 0);
  return {
    keywords,
    matched,
    missing: keywords.filter((k) => !matched.includes(k)),
    scoreBefore: pct(before),
    scoreAfter: pct(matched.length),
  };
}

/**
 * The spellings a keyword counts as found under, roughly as lenient as ATS matching:
 * "JavaScript (ES6+)" -> JavaScript / ES6+, "Agile/Scrum" -> Agile / Scrum,
 * "REST APIs" -> REST API, "CSS3" -> CSS.
 */
function keywordVariants(keyword: string): string[] {
  const parts = [keyword.replace(/\s*\([^)]*\)/g, ""), ...[...keyword.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])]
    .flatMap((p) => (/^[^/\s]+\/[^/\s]+$/.test(p) && !/^ci\/cd$/i.test(p) ? [p, ...p.split("/")] : [p]))
    .map((p) => p.trim())
    .filter(Boolean);
  const variants = new Set(parts);
  for (const p of parts) {
    if (/[a-z]{3,}s$/i.test(p) && !/ss$/i.test(p)) variants.add(p.slice(0, -1));
    if (/^[a-z]{3,}\d+$/i.test(p)) variants.add(p.replace(/\d+$/, ""));
  }
  return [...variants];
}

/** Every piece of text the rendered resume contains. */
function resumeLines(content: TailoredResumeInput): string[] {
  return [
    content.headerTitle,
    content.headline ?? "",
    content.summary,
    ...(content.sections ?? []).flatMap((s) => [
      s.heading,
      ...(s.lines ?? []),
      ...(s.entries ?? []).flatMap((e) => [e.title, e.organization ?? "", ...(e.bullets ?? [])]),
    ]),
  ];
}

/** Whole-term, case-insensitive match, so "Java" isn't found inside "JavaScript" nor "C" inside "C++". */
function mentions(lines: string[], term: string): boolean {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w+#.])${escaped}(?![\\w+#])`, "i");
  return lines.some((line) => re.test(line));
}
