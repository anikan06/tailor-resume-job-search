import type { AdditionalSection, CareerProfile, Certification, Education, Language, Project, WorkExperience } from "../types.js";

/**
 * Best-effort, no-AI reading of a resume's sections (experience, education, skills, ...).
 * Resumes vary wildly, so this only aims to give the Profile page a sensible starting
 * point for the user to correct - an AI provider, when configured, does this far better.
 */

type SectionKey = "summary" | "experience" | "education" | "skills" | "projects" | "certifications" | "languages";

/** Matched against a whole line (trailing colon stripped) to detect a section heading. */
const HEADINGS: [SectionKey, RegExp][] = [
  ["summary", /^(?:professional |career |executive )?(?:summary|profile|objective|about(?: me)?)$/i],
  ["experience", /^(?:(?:work|professional|employment|relevant|career) )?(?:experience|history)$|^employment$/i],
  ["education", /^(?:education(?:al)?(?: (?:background|qualifications?|details))?|academic(?:s| (?:background|qualifications?))?|qualifications?)$/i],
  ["skills", /^(?:(?:technical|core|key|professional) )?(?:skills|competencies|expertise)(?: (?:&|and) (?:tools|technologies))?$|^(?:technologies|tech stack|tools(?: (?:&|and) technologies)?)$/i],
  ["projects", /^(?:(?:key|personal|academic|selected|notable|side) )?projects$/i],
  ["certifications", /^(?:certifications?|licenses?(?: (?:&|and) certifications?)?|certifications? (?:&|and) (?:courses|training)|courses|training)$/i],
  ["languages", /^(?:(?:spoken )?languages?(?: (?:known|spoken|proficiency|skills))?)$/i],
];

/** Headings kept as-is in additional_sections; anything else not tracked above is dropped. */
const ADDITIONAL_HEADING_RE =
  /^(?:interests|hobbies(?: (?:&|and) interests)?|achievements|awards(?: (?:&|and) (?:achievements|honou?rs))?|honou?rs(?: (?:&|and) awards)?|publications|volunteer(?:ing)?(?: experience)?|extra[- ]curricular(?: activities)?|leadership(?: (?:&|and) activities)?)$/i;
const DROPPED_HEADING_RE = /^(?:references|declaration|personal (?:details|information))$/i;

/** Programming languages sometimes listed under "Languages"; they belong in skills. */
const PROGRAMMING_LANGUAGE_RE =
  /^(?:java(?:script)?|typescript|python|c\+\+|c#|c|go(?:lang)?|rust|ruby|php|kotlin|swift|scala|sql|r|perl|dart|html5?|css3?|bash|shell|objective-c|matlab)$/i;

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const DATE = String.raw`(?:${MONTH},?\s*'?\d{2,4}|\d{1,2}[/.-]\d{4}|\d{4}[/.-]\d{1,2}|(?:19|20)\d{2})`;
const PRESENT = String.raw`(?:present|current|now|till date|to date|ongoing)`;
const RANGE_RE = new RegExp(String.raw`(${DATE})\s*(?:[-–—]|to|till)\s*(${DATE}|${PRESENT})`, "i");
const SINGLE_DATE_RE = new RegExp(String.raw`\b(${DATE})\b`, "i");
const PRESENT_RE = new RegExp(`^${PRESENT}$`, "i");

const BULLET_RE = /^\s*(?:[•●▪◦‣∙·*–-]|\d{1,2}[.)])\s+/;
const DEGREE_RE = /\b(?:bachelor|master|doctor|b\.?\s?tech|m\.?\s?tech|b\.?\s?e\b|m\.?\s?e\b|b\.?\s?sc|m\.?\s?sc|b\.?\s?com|m\.?\s?com|b\.?\s?a\b|m\.?\s?a\b|mba|bba|bca|mca|ph\.?\s?d|diploma|degree|b\.?\s?s\b|m\.?\s?s\b|associate|hsc|ssc|class (?:x|xii|10|12)|high school|secondary)/i;
const INSTITUTION_RE = /\b(?:university|college|institute|school|academy|iit|nit|iiit|bits|polytechnic|vidyalaya)\b/i;
const GRADE_RE = /\b(?:cgpa|gpa|grade|percentage|score)\b\s*[:\-]?\s*[\d.]+(?:\s*\/\s*[\d.]+)?|\b\d{2}(?:\.\d+)?\s*%/i;

export function extractCareerHeuristically(text: string): CareerProfile {
  const { sections, additional } = splitSections(text);
  const languageItems = listItems(sections.languages ?? []);
  return stripEmptyCareer({
    summary: sections.summary?.map(stripBullet).join(" ").replace(/\s+/g, " ").trim() || undefined,
    skills: dedupe([...parseSkills(sections.skills ?? []), ...languageItems.filter((l) => PROGRAMMING_LANGUAGE_RE.test(l))]),
    experience: parseExperience(sections.experience ?? []),
    education: parseEducation(sections.education ?? []),
    projects: parseProjects(sections.projects ?? []),
    certifications: parseCertifications(sections.certifications ?? []),
    languages: parseLanguages(languageItems.filter((l) => !PROGRAMMING_LANGUAGE_RE.test(l))),
    additional_sections: additional.map((a) => ({ heading: a.heading, items: listItems(a.lines) })),
  });
}

function splitSections(text: string): {
  sections: Partial<Record<SectionKey, string[]>>;
  additional: { heading: string; lines: string[] }[];
} {
  const sections: Partial<Record<SectionKey, string[]>> = {};
  const additional: { heading: string; lines: string[] }[] = [];
  let current: string[] | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const heading = headingOf(line);
    if (heading) {
      current = sections[heading] ??= [];
      continue;
    }
    const candidate = line.replace(/[:\s]+$/, "").trim();
    if (ADDITIONAL_HEADING_RE.test(candidate)) {
      additional.push({ heading: titleCaseHeading(candidate), lines: [] });
      current = additional[additional.length - 1].lines;
      continue;
    }
    // A heading we don't keep (e.g. "Declaration") ends the current section.
    if (current && (DROPPED_HEADING_RE.test(candidate) || looksLikeOtherHeading(line))) {
      current = undefined;
      continue;
    }
    current?.push(line);
  }
  return { sections, additional };
}

function headingOf(line: string): SectionKey | undefined {
  const candidate = line.replace(/[:\s]+$/, "").trim();
  if (candidate.length > 45) return undefined;
  return HEADINGS.find(([, re]) => re.test(candidate))?.[0];
}

function looksLikeOtherHeading(line: string): boolean {
  const candidate = line.replace(/:$/, "").trim();
  return (
    // ALL-CAPS short lines without digits are almost always headings ("LANGUAGES").
    (candidate.length <= 30 && /^[A-Z][A-Z &/]+$/.test(candidate) && candidate.split(" ").length <= 4)
  );
}

// ---- experience ------------------------------------------------------------

interface DatedEntry {
  header: string[];
  start?: string;
  end?: string;
  current: boolean;
  body: string[];
}

/** Splits a section into entries, each anchored on a line holding a date (range). */
function datedEntries(lines: string[], allowSingleDate: boolean): DatedEntry[] {
  const dateLines = lines
    .map((l, i) => ({ i, range: l.match(RANGE_RE), single: allowSingleDate ? l.match(SINGLE_DATE_RE) : null }))
    .filter((d) => !BULLET_RE.test(lines[d.i]) && (d.range || d.single));
  if (!dateLines.length) return [];

  // Header of each entry: the date line plus up to two non-bullet lines right above it.
  const starts = dateLines.map((d, k) => {
    const floor = k === 0 ? 0 : dateLines[k - 1].i + 1;
    let s = d.i;
    // Lines starting lowercase are wrapped bullets of the previous entry, never headers.
    while (s > floor && d.i - s < 2 && !BULLET_RE.test(lines[s - 1]) && !/^\p{Ll}/u.test(lines[s - 1])) s--;
    return s;
  });
  // A preceding entry's continuation lines can't be stolen as the next header.
  for (let k = 1; k < starts.length; k++) starts[k] = Math.max(starts[k], dateLines[k - 1].i + 1);

  return dateLines.map((d, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const header = lines.slice(starts[k], d.i + 1);
    const [startDate, endDate] = d.range ? [d.range[1], d.range[2]] : [undefined, d.single![1]];
    return {
      header: header.map((h) => h.replace(d.range?.[0] ?? d.single![0], "").replace(/[()\s|,–—-]+$|^[()\s|,–—-]+/g, "").trim()).filter(Boolean),
      start: startDate && tidyDate(startDate),
      end: endDate && !PRESENT_RE.test(endDate) ? tidyDate(endDate) : undefined,
      current: Boolean(endDate && PRESENT_RE.test(endDate)),
      body: lines.slice(d.i + 1, end),
    };
  });
}

function parseExperience(lines: string[]): WorkExperience[] {
  return datedEntries(lines, false).map((e) => {
    const parts = e.header.flatMap(splitHeader);
    const location = parts.find(isLocation);
    const rest = parts.filter((p) => p !== location);
    return stripEmpty({
      title: rest[0],
      company: rest[1],
      location,
      start_date: e.start,
      end_date: e.end,
      current: e.current || undefined,
      highlights: bullets(e.body),
    });
  });
}

// ---- education ---------------------------------------------------------------

function parseEducation(lines: string[]): Education[] {
  let entries = datedEntries(lines, true);
  // No dates at all: treat each line naming an institution or degree as one entry.
  if (!entries.length) {
    entries = lines
      .filter((l) => INSTITUTION_RE.test(l) || DEGREE_RE.test(l))
      .map((l) => ({ header: [l], current: false, body: [] }));
  }
  return entries.map((e) => {
    const parts = e.header.flatMap(splitHeader);
    const grade = [...e.header, ...e.body].join(" ").match(GRADE_RE)?.[0];
    const institution = parts.find((p) => INSTITUTION_RE.test(p));
    const degreePart = parts.find((p) => p !== institution && DEGREE_RE.test(p)) ?? parts.find((p) => p !== institution);
    const [degree, field] = splitDegree(degreePart);
    return stripEmpty({
      institution: institution ?? (degreePart ? parts.find((p) => p !== degreePart && !isLocation(p)) : parts[0]),
      degree,
      field,
      start_date: e.start,
      end_date: e.end,
      grade: grade?.trim(),
      details: bullets(e.body).filter((b) => !grade || !b.includes(grade.trim())),
    });
  });
}

/** "B.Tech in Computer Science" -> ["B.Tech", "Computer Science"]. */
function splitDegree(text: string | undefined): [string | undefined, string | undefined] {
  if (!text) return [undefined, undefined];
  const m = text.match(/^(.+?)\s+(?:in|of)\s+(.+)$/i) ?? text.match(/^(.+?)\s*[,(]\s*(.+?)\)?$/);
  return m ? [m[1].trim(), m[2].trim()] : [text, undefined];
}

// ---- skills / projects / certifications ---------------------------------

function parseSkills(lines: string[]): string[] {
  const items = lines.flatMap((l) => {
    // "Frontend: Angular, React" -> drop the category label.
    const value = stripBullet(l).replace(/^[^:,]{1,30}:\s*/, "");
    return value.split(/\s*[,|•;·]\s*|\s{3,}/);
  });
  return dedupe(items.map((s) => s.trim().replace(/\.$/, "")).filter((s) => s.length > 1 && s.length <= 40)).slice(0, 40);
}

function parseProjects(lines: string[]): Project[] {
  const projects: Project[] = [];
  for (const line of lines) {
    const isBullet = BULLET_RE.test(line);
    if (!isBullet || !projects.length) {
      const [name, ...rest] = splitHeader(isBullet ? stripBullet(line) : line);
      const url = line.match(/https?:\/\/\S+|(?:github\.com|gitlab\.com)\/\S+/i)?.[0];
      const tech = rest.find((r) => r.includes(",")) ?? line.match(/(?:tech(?:nologies)?|stack|tools)\s*:\s*(.+)$/i)?.[1];
      projects.push({
        name: name?.replace(url ?? "", "").trim(),
        url,
        technologies: tech ? tech.split(/\s*,\s*/).filter(Boolean) : [],
        highlights: [],
      });
    } else {
      projects[projects.length - 1].highlights!.push(stripBullet(line));
    }
  }
  return projects.filter((p) => p.name).map(stripEmpty);
}

/** One item per bullet, or per comma/pipe-separated entry when the section is a single run of text. */
function listItems(lines: string[]): string[] {
  const items = lines.some((l) => BULLET_RE.test(l)) ? bullets(lines) : lines.map(stripBullet);
  return items.flatMap((i) => (/[,|•;·]/.test(i) && i.length <= 120 ? i.split(/\s*[,|•;·]\s*/) : [i])).map((i) => i.trim()).filter(Boolean);
}

/** "English (Native)", "Hindi - Fluent", "French: Basic" -> name + proficiency. */
function parseLanguages(items: string[]): Language[] {
  return items
    .map((item) => {
      const m = item.match(/^([\p{L} ]+?)\s*(?:\(([^)]+)\)|[:–—-]\s*(.+))?$/u);
      return stripEmpty<Language>({ name: m?.[1].trim(), proficiency: (m?.[2] ?? m?.[3])?.trim() });
    })
    .filter((l) => l.name && l.name.length <= 30);
}

function parseCertifications(lines: string[]): Certification[] {
  return lines.map((line) => {
    const text = stripBullet(line);
    const url = text.match(/https?:\/\/\S+/)?.[0];
    const date = text.match(SINGLE_DATE_RE)?.[1];
    const [name, issuer] = splitHeader(text.replace(url ?? "", "").replace(date ?? "", "").replace(/\(\s*\)/g, ""));
    return stripEmpty({ name, issuer, date: date && tidyDate(date), url });
  }).filter((c) => c.name);
}

// ---- utils ------------------------------------------------------------------

/** Splits "Senior Engineer | Acme Corp, Bangalore" style header lines into parts. */
function splitHeader(line: string): string[] {
  return line
    .split(/\s*[|•·–—]\s*|\s+-\s+|\s+at\s+|\s{3,}|\t/)
    .map((p) => p.replace(/^[,\s]+|[,\s]+$/g, "").trim())
    .filter((p) => p.length > 1);
}

function isLocation(part: string): boolean {
  return /^(?:remote|hybrid|on-?site)$/i.test(part) || (/^[A-Z][\p{L} .]+,\s*[A-Z][\p{L} .]+$/u.test(part) && part.length <= 40);
}

/** Bullet lines become highlights; wrapped continuation lines join the bullet above. */
function bullets(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (BULLET_RE.test(line) || !out.length) out.push(stripBullet(line));
    else out[out.length - 1] += ` ${line}`;
  }
  return out.filter(Boolean);
}

function stripBullet(line: string): string {
  return line.replace(BULLET_RE, "").trim();
}

function titleCaseHeading(heading: string): string {
  return heading.toLowerCase().replace(/(^|[\s-])\p{Ll}/gu, (c) => c.toUpperCase()).replace(/\b(And|Of)\b/g, (w) => w.toLowerCase());
}

function tidyDate(date: string): string {
  return date.replace(/\s+/g, " ").replace(/\.(?=\s|$)/, "").trim();
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripEmpty<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
  ) as T;
}

export function stripEmptyCareer(career: CareerProfile): CareerProfile {
  return stripEmpty({
    ...career,
    experience: career.experience?.map(stripEmpty).filter((e) => e.title || e.company),
    education: career.education?.map(stripEmpty).filter((e) => e.institution || e.degree),
    projects: career.projects?.map(stripEmpty).filter((p) => p.name),
    certifications: career.certifications?.map(stripEmpty).filter((c) => c.name),
    languages: career.languages?.map(stripEmpty).filter((l) => l.name),
    additional_sections: career.additional_sections
      ?.map((a) => stripEmpty<AdditionalSection>({ heading: a.heading?.trim(), items: a.items?.map((i) => i.trim()).filter(Boolean) }))
      .filter((a) => a.heading && a.items?.length),
  });
}

/** The career profile flattened to plain text, for keyword matching (role suggestions, job relevance). */
export function careerToText(career: CareerProfile | undefined): string {
  if (!career) return "";
  return [
    career.headline,
    career.summary,
    ...(career.skills ?? []),
    ...(career.experience ?? []).flatMap((e) => [e.title, e.company, ...(e.highlights ?? [])]),
    ...(career.education ?? []).flatMap((e) => [e.degree, e.field]),
    ...(career.projects ?? []).flatMap((p) => [p.name, ...(p.technologies ?? []), ...(p.highlights ?? [])]),
    ...(career.certifications ?? []).map((c) => c.name),
    ...(career.languages ?? []).map((l) => l.name),
    ...(career.additional_sections ?? []).flatMap((a) => [a.heading, ...(a.items ?? [])]),
  ]
    .filter(Boolean)
    .join("\n");
}
