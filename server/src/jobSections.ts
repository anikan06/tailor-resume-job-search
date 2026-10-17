import { completeText, extractJson, isAiConfigured } from "./llm.js";
import type { Profile } from "./types.js";

/** The parts of a job description the dashboard shows on their own, one item per line. */
export interface JobSections {
  responsibilities: string[];
  skills: string[];
  source: "ai" | "heuristic";
}

/**
 * Pulls the key responsibilities and the must-have/required skills out of a job description.
 * Uses the AI provider when one is set up (postings word their headings every which way),
 * falling back to heading matching otherwise or if that call fails.
 */
export async function extractJobSections(description: string, profile: Profile): Promise<JobSections> {
  const heuristic = extractJobSectionsHeuristically(description);
  if (!isAiConfigured(profile)) return heuristic;
  try {
    return await extractJobSectionsWithAI(description, profile);
  } catch (err) {
    console.error(`[aahvya-job-aggregator] AI job section extraction failed, using headings instead: ${(err as Error).message}`);
    return heuristic;
  }
}

async function extractJobSectionsWithAI(description: string, profile: Profile): Promise<JobSections> {
  const prompt = `From the job posting text below, extract two lists.

1. "responsibilities": what the person in this role will do (key responsibilities, duties, "what you'll do").
2. "skills": the must-have / required skills, qualifications and experience. Leave out anything marked preferred, nice-to-have, good-to-have or a bonus.

RULES:
- Copy the posting's own wording; you may shorten an item but never add anything that isn't in the text.
- One item per entry, without bullet characters. If a skills table lists a skill with a required depth, write "Skill - depth".
- Ignore navigation, application-form fields, company background, benefits and legal text.
- Use an empty list when the posting has no such content.

Reply with only JSON: {"responsibilities": string[], "skills": string[]}

JOB POSTING:
${description}`;
  const parsed = JSON.parse(extractJson(await completeText(prompt, 2000, profile, { activity: "read_job" }))) as Partial<JobSections>;
  return { responsibilities: cleanItems(parsed.responsibilities), skills: cleanItems(parsed.skills), source: "ai" };
}

// ---- heuristics ---------------------------------------------------------

const RESPONSIBILITIES = /responsibilit|what you('|’)?ll (do|be doing)|what you will (do|be doing)|\bduties\b|day[- ]to[- ]day|in this role,? you/i;
const SKILLS = /must[- ]haves?|skills? required|required skills|requirements|qualifications|what you('|’)?ll (bring|need)|what we('|’)?re looking for|who you are|(you|you'll|you will) (have|bring|need)|if you have|key skills|technical skills|^skills:?$/i;
const NICE_TO_HAVE = /nice[- ]to[- ]have|good[- ]to[- ]have|preferred|bonus|not required|added plus|plus if/i;
const OTHER_HEADING = /^(about|benefits|perks|compensation|salary|pay|why join|who we are|our (team|company|culture)|equal (opportunity|employment)|location|how to apply|apply|annexure)\b/i;
const MAX_ITEMS = 25;

export function extractJobSectionsHeuristically(description: string): JobSections {
  const lines = description.split("\n").map((l) => l.trim());
  return {
    responsibilities: sectionAfter(lines, (l) => RESPONSIBILITIES.test(l)),
    skills: sectionAfter(lines, (l) => SKILLS.test(l) && !NICE_TO_HAVE.test(l)),
    source: "heuristic",
  };
}

function isHeading(line: string): boolean {
  if (!line || line.length > 80) return false;
  if (line.endsWith(":")) return true;
  if (/[A-Z]/.test(line) && line === line.toUpperCase()) return true;
  return RESPONSIBILITIES.test(line) || SKILLS.test(line) || NICE_TO_HAVE.test(line) || OTHER_HEADING.test(line);
}

/** The lines under the first heading `matches` accepts, up to the next heading. */
function sectionAfter(lines: string[], matches: (line: string) => boolean): string[] {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!matches(line)) continue;
    // A heading run into its content on one line, e.g. a flattened table: keep what follows the heading words.
    if (line.length > 80) return cleanItems([line.replace(/^.*?(must[- ]have skills?|skills? required|requirements|responsibilities)[:\s]*/i, "")]);
    if (!isHeading(line)) continue;
    const items: string[] = [];
    for (let j = i + 1; j < lines.length && items.length < MAX_ITEMS; j++) {
      if (isHeading(lines[j]) || OTHER_HEADING.test(lines[j])) break;
      if (lines[j]) items.push(lines[j]);
    }
    if (items.length) return cleanItems(items);
  }
  return [];
}

function cleanItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i): i is string => typeof i === "string")
    .map((i) => i.replace(/^[\s•●▪◦\-*–—]+/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}
