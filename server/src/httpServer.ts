#!/usr/bin/env node
import express, { type Request, type Response } from "express";
import cors from "cors";
import type { Page } from "playwright";
import multer from "multer";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isCareerEmpty, loadProfile, saveProfile } from "./config.js";
import { extractResumeText } from "./resume/parse.js";
import { extractProfileFromResume, extractHeuristically, withCareerSuggestions } from "./resume/extractProfile.js";
import { importFromGitHub, importFromLinkedIn } from "./resume/importProfile.js";
import { generateResumePdf } from "./resume/pdf.js";
import { generateResumeDocx } from "./resume/generate.js";
import { getState, setState } from "./state.js";
import { aggregateJobs, readCachedAggregation } from "./jobsStore.js";
import { fetchJobDescriptionText, fetchJobPosting, readJobDescription } from "./jobDescription.js";
import { guessJobDetails } from "./jobLink.js";
import { extractJobSections } from "./jobSections.js";
import { platformForUrl } from "./platforms/google.js";
import { atsKeywordReport, generateAtsResumeWithAI, tailorResumeWithAI } from "./aiTailor.js";
import { AI_PROVIDERS, activeProvider, isAiConfigured } from "./llm.js";
import { applyToAtsJob } from "./platforms/ats.js";
import { prefillLinkedInApplication } from "./platforms/linkedin.js";
import { prefillNaukriApplication } from "./platforms/naukri.js";
import { prefillIndeedApplication } from "./platforms/indeed.js";
import { findExisting, getRecord, jobIdFor, recordApplication, listApplications } from "./tracker.js";
import { policyExplanation, canAutoSubmit } from "./policy.js";
import { applySchedule } from "./scheduler.js";
import { summarizeLlmUsage } from "./telemetry.js";
import type { Profile, AggregatedJob, Platform } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const UPLOADS_DIR = join(DATA_DIR, "uploads");
const TAILORED_DIR = join(DATA_DIR, "tailored");
mkdirSync(UPLOADS_DIR, { recursive: true });
mkdirSync(TAILORED_DIR, { recursive: true });

const API_KEY_MASK = "••••••••";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    // Keep the original extension (.pdf/.docx/.txt/.md) - extractResumeText picks its
    // parser from it, and multer's own default filename strips extensions entirely.
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
});

// ---- helpers --------------------------------------------------------

function toProfileDTO(profile: Profile) {
  return {
    ...profile,
    ai: {
      provider: activeProvider(profile) ?? "anthropic",
      model: profile.ai?.model ?? "",
      ollama_base_url: profile.ai?.ollama_base_url ?? "",
      apiKeyConfigured: isAiConfigured(profile),
      keysConfigured: Object.fromEntries(AI_PROVIDERS.map((p) => [p, p === "ollama" || Boolean(profile.ai?.[keyField(p)])])),
    },
  };
}

function keyField(provider: (typeof AI_PROVIDERS)[number]) {
  return `${provider}_api_key` as "anthropic_api_key" | "openai_api_key" | "gemini_api_key";
}

async function findCachedJob(id: string): Promise<AggregatedJob | undefined> {
  return readCachedAggregation()?.jobs.find((j) => j.id === id);
}

function tailoredPdfPath(jobId: string): string {
  return join(TAILORED_DIR, `${basename(jobId)}.pdf`);
}

/** Fingerprint of the Profile page's career details, stored beside each tailored PDF. */
function careerFingerprint(profile: Profile): string {
  return createHash("sha256").update(JSON.stringify(profile.career ?? {})).digest("hex");
}

function careerStampPath(pdfPath: string): string {
  return pdfPath.replace(/\.pdf$/, ".career");
}

/** True when the PDF was tailored from the current Profile details (new skills etc. would be missing otherwise). */
function isTailoredUpToDate(pdfPath: string, profile: Profile): boolean {
  if (!existsSync(pdfPath)) return false;
  try {
    return readFileSync(careerStampPath(pdfPath), "utf8") === careerFingerprint(profile);
  } catch {
    return false;
  }
}

async function writeTailoredPdf(content: Parameters<typeof generateResumePdf>[0], pdfPath: string, profile: Profile): Promise<void> {
  await generateResumePdf(content, pdfPath);
  writeFileSync(careerStampPath(pdfPath), careerFingerprint(profile));
}

/**
 * Tailors (if not already done for this job) and returns the PDF path, reusing a cached tailor if present
 * and the Profile page hasn't changed since - otherwise it re-tailors so added skills/languages show up.
 * `readJd` reads the description from a page the caller already has open; without it the posting is
 * fetched separately when search results didn't include a full description.
 */
async function ensureTailoredResume(job: AggregatedJob, profile: Profile, readJd?: () => Promise<string>): Promise<string> {
  const pdfPath = tailoredPdfPath(job.id);
  if (isTailoredUpToDate(pdfPath, profile)) return pdfPath;

  const { resumeText } = getState();
  if (!resumeText) throw new Error("No resume uploaded yet - upload one in Settings first.");

  const jdText =
    job.snippet && job.snippet.length > 200
      ? job.snippet
      : await (readJd ? readJd() : fetchJobDescriptionText(job.url, job.platform));
  const content = await tailorResumeWithAI(resumeText, job.title, job.company, jdText, profile, job.id);
  await writeTailoredPdf(content, pdfPath, profile);
  return pdfPath;
}

// ---- profile ----------------------------------------------------------

app.get("/api/profile", (_req: Request, res: Response) => {
  res.json(toProfileDTO(loadProfile()));
});

app.put("/api/profile", (req: Request, res: Response) => {
  const current = loadProfile();
  const body = req.body as Partial<Profile>;
  const incoming = body.ai ?? {};
  // A blank/masked key means "keep the saved one"; a blank model or URL means "use the default".
  const keepKey = (field: ReturnType<typeof keyField>) =>
    incoming[field] && incoming[field] !== API_KEY_MASK ? incoming[field] : current.ai?.[field];
  const orDefault = (value: string | undefined, saved: string | undefined) =>
    value === undefined ? saved : value.trim() || undefined;
  const merged: Partial<Profile> = {
    ...body,
    ai: {
      provider: incoming.provider && AI_PROVIDERS.includes(incoming.provider) ? incoming.provider : current.ai?.provider,
      model: orDefault(incoming.model, current.ai?.model),
      ollama_base_url: orDefault(incoming.ollama_base_url, current.ai?.ollama_base_url),
      anthropic_api_key: keepKey("anthropic_api_key"),
      openai_api_key: keepKey("openai_api_key"),
      gemini_api_key: keepKey("gemini_api_key"),
    },
  };
  const saved = saveProfile(merged);
  applySchedule(saved);
  res.json(toProfileDTO(saved));
});

// ---- resume -------------------------------------------------------------

app.post("/api/resume", upload.single("resume"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded (field name must be 'resume')" });
  try {
    const text = await extractResumeText(req.file.path);
    const profile = loadProfile();
    const extracted = await extractProfileFromResume(text, profile);
    setState({ resumePath: req.file.path, resumeText: text, resumeFileName: req.file.originalname, resumeExtraction: extracted });
    // Seed the Profile page from the first resume; after that it's the user's to edit (or re-fetch there).
    const careerImported = isCareerEmpty(profile.career) && !isCareerEmpty(extracted.career);
    if (careerImported) saveProfile({ career: extracted.career });
    res.json({
      fileName: req.file.originalname,
      length: text.length,
      preview: text.slice(0, 400),
      extracted: withCareerSuggestions(extracted, loadProfile()),
      careerImported,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/resume", (_req: Request, res: Response) => {
  const { resumeFileName, resumeText, resumeExtraction } = getState();
  const profile = loadProfile();
  if (!resumeText) return res.json({ uploaded: false, extracted: withCareerSuggestions(undefined, profile) });
  // Resumes uploaded before extraction existed get it computed (heuristics only) on first read.
  const extracted = withCareerSuggestions(resumeExtraction ?? extractHeuristically(resumeText), profile);
  res.json({ uploaded: true, fileName: resumeFileName, length: resumeText.length, preview: resumeText.slice(0, 400), extracted });
});

app.delete("/api/resume", (_req: Request, res: Response) => {
  const { resumePath } = getState();
  if (resumePath) rmSync(resumePath, { force: true });
  setState({ resumePath: undefined, resumeText: undefined, resumeFileName: undefined, resumeExtraction: undefined });
  res.json({ uploaded: false });
});

// ---- career profile ---------------------------------------------------------

/**
 * Reads experience/education/etc. from the uploaded resume for the Profile page to fill in;
 * nothing is saved here. Uses the reading done at upload time unless `refresh` is set or
 * that reading predates career extraction.
 */
app.post("/api/profile/career/from-resume", async (req: Request, res: Response) => {
  const { resumeText, resumeExtraction } = getState();
  if (!resumeText) return res.status(400).json({ error: "No resume uploaded yet - upload one in Settings first." });
  try {
    if (resumeExtraction?.career && !req.body?.refresh) return res.json({ career: resumeExtraction.career, source: resumeExtraction.source });
    const extracted = await extractProfileFromResume(resumeText, loadProfile());
    setState({ resumeExtraction: extracted });
    res.json({ career: extracted.career ?? {}, source: extracted.source });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** File id (in TAILORED_DIR) of the Profile page's general ATS resume - there's only ever one. */
const PROFILE_RESUME_ID = "ats-profile";

/**
 * Profile page → "Generate ATS resume": writes a general, job-independent ATS-friendly resume
 * from the Profile details (and the uploaded resume, if any), as both PDF and Word.
 */
app.post("/api/profile/ats-resume", async (_req: Request, res: Response) => {
  const profile = loadProfile();
  const { resumeText } = getState();
  if (isCareerEmpty(profile.career) && !resumeText) {
    return res.status(400).json({ error: "Add your experience on this page (or upload a resume in Settings) first." });
  }
  try {
    const content = await generateAtsResumeWithAI(profile, resumeText ?? "");
    const pdfPath = tailoredPdfPath(PROFILE_RESUME_ID);
    await writeTailoredPdf(content, pdfPath, profile);
    await generateResumeDocx(content, pdfPath.replace(/\.pdf$/, ".docx"));
    res.json({
      jobId: PROFILE_RESUME_ID,
      name: content.headerTitle || profile.personal?.full_name || "Resume",
      headline: content.headline ?? "",
      pdfUrl: `/api/tailored/${PROFILE_RESUME_ID}.pdf`,
      docxUrl: `/api/tailored/${PROFILE_RESUME_ID}.docx`,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---- profile import (LinkedIn / GitHub) ---------------------------------

/** Fetches profile details from LinkedIn or GitHub for Settings to prefill; nothing is saved here. */
app.post("/api/profile/import/:source", async (req: Request, res: Response) => {
  const url = typeof req.body?.url === "string" ? req.body.url : "";
  try {
    if (req.params.source === "github") return res.json(await importFromGitHub(url));
    if (req.params.source === "linkedin") return res.json(await importFromLinkedIn(url, loadProfile()));
    res.status(404).json({ error: "Unknown import source." });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---- jobs -----------------------------------------------------------

app.get("/api/jobs", (_req: Request, res: Response) => {
  const cached = readCachedAggregation() ?? { jobs: [], errors: [], aggregatedAt: null };
  // A resume tailored before the Profile page changed counts as not tailored, so it gets redone.
  const profile = loadProfile();
  res.json({ ...cached, jobs: cached.jobs.map((j) => ({ ...j, tailored: isTailoredUpToDate(tailoredPdfPath(j.id), profile) })) });
});

app.post("/api/jobs/aggregate", async (req: Request, res: Response) => {
  const { resumeText } = getState();
  const effectiveResume = (req.body?.resumeText as string | undefined) ?? resumeText;
  if (!effectiveResume) return res.status(400).json({ error: "No resume uploaded yet - upload one in Settings first." });
  try {
    const result = await aggregateJobs(loadProfile(), effectiveResume);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/jobs/:id/tailor", async (req: Request, res: Response) => {
  const job = await findCachedJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found in the last aggregation - re-run aggregate first." });
  try {
    const profile = loadProfile();
    await ensureTailoredResume(job, profile);
    res.json({ jobId: job.id, pdfUrl: `/api/tailored/${job.id}.pdf` });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

const MIN_DESCRIPTION_LENGTH = 500;
const UNREADABLE_POSTING = "Couldn't read the job description from that page. Paste it below and try again.";

/** The posting URL from a request body, with its platform; throws a user-facing message if it isn't a link. */
function postingUrl(body: unknown): { url: string; platform: Platform } {
  const url = typeof (body as { url?: unknown })?.url === "string" ? (body as { url: string }).url.trim() : "";
  try {
    if (!/^https?:\/\//i.test(url)) throw new Error();
    return { url, platform: platformForUrl(url) };
  } catch {
    throw new Error("Enter the full job link, starting with https://");
  }
}

/**
 * Reads a pasted job link for the dashboard to show before tailoring: the description text
 * plus a guessed title and company, all of which the user can correct.
 */
app.post("/api/job-posting", async (req: Request, res: Response) => {
  let link;
  try {
    link = postingUrl(req.body);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
  try {
    const posting = await fetchJobPosting(link.url, link.platform);
    const guess = guessJobDetails(link.url, posting.pageTitle);
    const readable = posting.text.length >= MIN_DESCRIPTION_LENGTH;
    const sections = readable ? await extractJobSections(posting.text, loadProfile()) : undefined;
    res.json({
      platform: link.platform,
      title: guess.title ?? "",
      company: guess.company ?? "",
      description: readable ? posting.text : "",
      responsibilities: sections?.responsibilities ?? [],
      skills: sections?.skills ?? [],
      ...(readable ? {} : { warning: UNREADABLE_POSTING }),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Key responsibilities and must-have skills from a job description the user pasted in. */
app.post("/api/job-sections", async (req: Request, res: Response) => {
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  if (!description) return res.status(400).json({ error: "Paste the job description first." });
  try {
    const { responsibilities, skills } = await extractJobSections(description.slice(0, 8000), loadProfile());
    res.json({ responsibilities, skills });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * "Tailor from a job link": tailors the resume for any posting the user pastes a link to
 * (Workday, a company careers page, ...) and hands back the PDF for them to apply with
 * themselves - no form filling. `description` (as shown by /api/job-posting, or pasted)
 * skips reading the page again; `title`/`company` override what's guessed from the link;
 * `responsibilities`/`skills` (the user-checked sections) are put first for the tailoring to lean on.
 */
app.post("/api/tailor-from-link", async (req: Request, res: Response) => {
  const field = (name: string) => (typeof req.body?.[name] === "string" ? (req.body[name] as string).trim() : "");
  let link;
  try {
    link = postingUrl(req.body);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
  const { url, platform } = link;
  const { resumeText } = getState();
  if (!resumeText) return res.status(400).json({ error: "No resume uploaded yet - upload one in Settings first." });

  try {
    const pasted = field("description");
    const posting = pasted ? { text: pasted, pageTitle: "" } : await fetchJobPosting(url, platform);
    // The sections the user checked on the dashboard go first, so the tailoring leans on them.
    const focus = [
      field("skills") && `MUST-HAVE SKILLS (prioritise these):\n${field("skills")}`,
      field("responsibilities") && `KEY RESPONSIBILITIES:\n${field("responsibilities")}`,
    ].filter(Boolean);
    const jdText = focus.length ? `${focus.join("\n\n")}\n\nFULL JOB DESCRIPTION:\n${posting.text}` : posting.text;
    if (posting.text.length < (pasted ? 100 : MIN_DESCRIPTION_LENGTH)) {
      return res.status(422).json({ error: UNREADABLE_POSTING, needsDescription: true });
    }
    const guess = guessJobDetails(url, posting.pageTitle);
    const title = field("title") || guess.title || "Job";
    const company = field("company") || guess.company || "Company";
    const jobId = jobIdFor(url);

    const profile = loadProfile();
    const content = await tailorResumeWithAI(resumeText, title, company, jdText, profile, jobId);
    await writeTailoredPdf(content, tailoredPdfPath(jobId), profile);

    // Shows in History for re-downloading, without overwriting a real application to the same job.
    const existing = await getRecord(url);
    if (!existing || existing.status === "tailored") {
      await recordApplication({ platform, title, company, url, status: "tailored", note: "Resume tailored from a job link - apply yourself." });
    }
    res.json({ jobId, title, company, platform, pdfUrl: `/api/tailored/${jobId}.pdf` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * "Just tailor & download": tailors the resume to a pasted job description - no link, no
 * search, nothing recorded in History - and writes both a PDF and a Word copy. Also returns
 * how many of the JD's keywords the resume covered before and after, as an ATS would see it.
 */
app.post("/api/tailor-quick", async (req: Request, res: Response) => {
  const field = (name: string) => (typeof req.body?.[name] === "string" ? (req.body[name] as string).trim() : "");
  const description = field("description");
  const title = field("title") || "Target role";
  const company = field("company") || "Company";
  if (description.length < 100) return res.status(400).json({ error: "Paste the full job description (at least a few lines) first." });
  const { resumeText } = getState();
  if (!resumeText) return res.status(400).json({ error: "No resume uploaded yet - upload one in Settings first." });

  try {
    const jobId = createHash("sha256").update(`quick\n${title}\n${company}\n${description}`).digest("hex").slice(0, 16);
    const profile = loadProfile();
    const content = await tailorResumeWithAI(resumeText, title, company, description, profile, jobId);
    const pdfPath = tailoredPdfPath(jobId);
    await writeTailoredPdf(content, pdfPath, profile);
    await generateResumeDocx(content, pdfPath.replace(/\.pdf$/, ".docx"));
    res.json({
      jobId,
      title,
      company,
      pdfUrl: `/api/tailored/${jobId}.pdf`,
      docxUrl: `/api/tailored/${jobId}.docx`,
      ats: atsKeywordReport(content, resumeText),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Serves a tailored PDF inline (for the in-app preview) or, with ?download=1 (always for
 * a .docx), as an attachment named by ?name= instead of the job-id hash.
 */
app.get("/api/tailored/:fileName", (req: Request, res: Response) => {
  const fileName = basename(req.params.fileName);
  const ext = extname(fileName);
  if (ext !== ".pdf" && ext !== ".docx") return res.status(404).end();
  const path = join(TAILORED_DIR, fileName);
  if (!existsSync(path)) return res.status(404).end();

  // Word copies (from "Just tailor & download") are only ever downloaded.
  if (req.query.download || ext === ".docx") {
    const requested = typeof req.query.name === "string" ? req.query.name.replace(/[^\w .()-]+/g, "_").slice(0, 120) : "";
    return res.download(path, requested ? `${requested.replace(/\.(pdf|docx)$/i, "")}${ext}` : fileName);
  }
  res.type("application/pdf").sendFile(path);
});

/**
 * The one-button "Apply" action: tailors (if not already tailored), then
 * applies per the mixed platform policy -
 *   Greenhouse/Lever/Workday -> filled AND submitted (if every field was
 *     answerable), no further click needed.
 *   LinkedIn/Naukri/Indeed   -> filled, browser left open, NEVER submitted -
 *     policy.ts makes this true regardless of what this route asks for.
 */
app.post("/api/jobs/:id/apply", async (req: Request, res: Response) => {
  const job = await findCachedJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found in the last aggregation - re-run aggregate first." });

  const profile = loadProfile();
  if (profile.apply?.tailor_only) {
    return res.status(409).json({ error: "Tailor-only mode is on in Settings - tailor and download the resume instead." });
  }
  const existing = await findExisting(job.url);
  if (existing && !req.body?.force) {
    return res.json({ status: "skipped_duplicate", existing });
  }

  try {
    // Tailors inside the job page the apply flow opens, so the posting isn't opened twice.
    const resume = (jobPage: Page) => ensureTailoredResume(job, profile, () => readJobDescription(jobPage));

    if (job.platform === "greenhouse" || job.platform === "lever" || job.platform === "workday") {
      const result = await applyToAtsJob(job.platform, job.url, profile, resume, {}, true);
      const record = await recordApplication({
        platform: job.platform,
        title: job.title,
        company: job.company,
        url: job.url,
        status: result.submitted ? "submitted" : "prefilled",
        note: result.note,
      });
      return res.json({ ...result, record });
    }

    const prefill =
      job.platform === "linkedin"
        ? await prefillLinkedInApplication(job.url, profile, resume)
        : job.platform === "naukri"
        ? await prefillNaukriApplication(job.url, profile, resume)
        : await prefillIndeedApplication(job.url, profile, resume);

    const record = await recordApplication({
      platform: job.platform,
      title: job.title,
      company: job.company,
      url: job.url,
      status: "prefilled",
      note: prefill.note,
    });
    return res.json({ ...prefill, submitted: false, record });
  } catch (err) {
    await recordApplication({
      platform: job.platform,
      title: job.title,
      company: job.company,
      url: job.url,
      status: "failed",
      note: (err as Error).message,
    });
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/jobs/:id/policy", async (req: Request, res: Response) => {
  const job = await findCachedJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found." });
  res.json({ explanation: policyExplanation(job.platform), autoSubmitEligible: canAutoSubmit(job.platform) });
});

// ---- LLM usage telemetry ---------------------------------------------------

app.get("/api/usage", (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  res.json(summarizeLlmUsage(limit));
});

// ---- applications & schedule --------------------------------------------

app.get("/api/applications", async (_req: Request, res: Response) => {
  const records = await listApplications();
  res.json(records.map((r) => ({ ...r, tailored: existsSync(tailoredPdfPath(r.id)) })));
});

app.get("/api/schedule", (_req: Request, res: Response) => {
  const profile = loadProfile();
  res.json(profile.schedule ?? { enabled: false });
});

app.put("/api/schedule", (req: Request, res: Response) => {
  const profile = saveProfile({ schedule: req.body });
  const status = applySchedule(profile);
  res.json({ schedule: profile.schedule, status });
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.error(`[aahvya-job-aggregator] HTTP API listening on http://localhost:${PORT}`);
  applySchedule(loadProfile());
});
