import { completeText, extractJson } from "./llm.js";
import type { Profile } from "./types.js";

export interface TailorContentResult {
  headerTitle: string;
  contactLine: string;
  summary: string;
  sections: { heading: string; lines: string[] }[];
}

/**
 * Calls the user's chosen AI provider with their own key (never stored
 * anywhere but their local profile.yaml, never sent anywhere except that
 * provider) to rewrite/reorder the candidate's real resume content for one specific job
 * description. It is explicitly told not to invent experience - only to
 * re-emphasize, reorder and trim what's already in the resume text.
 */
export async function tailorResumeWithAI(
  resumeText: string,
  jobTitle: string,
  company: string,
  jobDescription: string,
  profile: Profile
): Promise<TailorContentResult> {
  const prompt = `You are tailoring a real candidate's resume for one specific job application.

RULES:
- Do NOT invent, exaggerate, or add experience, skills, titles or dates that are not already present in the RESUME TEXT below.
- You MAY reorder bullets, rephrase for clarity/impact, trim irrelevant content, and foreground the parts of the real experience that match the JOB DESCRIPTION.
- Keep every claim traceable to something actually in the resume text.
- Output ONLY valid JSON, no prose, no markdown fences, matching exactly this shape:
{
  "headerTitle": "string - candidate name and a title matching the target role",
  "contactLine": "string - contact details pulled from the resume text",
  "summary": "string - 2-4 sentence summary tailored to this JD, grounded in the resume",
  "sections": [ { "heading": "string e.g. Experience / Skills / Education", "lines": ["string bullet", "..."] } ]
}

JOB TITLE: ${jobTitle}
COMPANY: ${company}

JOB DESCRIPTION:
${jobDescription.slice(0, 6000)}

RESUME TEXT:
${resumeText.slice(0, 12000)}`;

  const jsonText = extractJson(await completeText(prompt, 2000, profile));
  try {
    return JSON.parse(jsonText) as TailorContentResult;
  } catch (err) {
    throw new Error(`AI tailoring returned non-JSON content that couldn't be parsed: ${(err as Error).message}`);
  }
}

