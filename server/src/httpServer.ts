#!/usr/bin/env node
import express, { type Request, type Response } from "express";
import cors from "cors";
import multer from "multer";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadProfile, saveProfile } from "./config.js";
import { extractResumeText } from "./resume/parse.js";
import { extractProfileFromResume, extractHeuristically } from "./resume/extractProfile.js";
import { importFromGitHub, importFromLinkedIn } from "./resume/importProfile.js";
import { generateResumePdf } from "./resume/pdf.js";
import { getState, setState } from "./state.js";
import { aggregateJobs, readCachedAggregation } from "./jobsStore.js";
import { fetchJobDescriptionText } from "./jobDescription.js";
import { tailorResumeWithAI } from "./aiTailor.js";
import { AI_PROVIDERS, activeProvider, isAiConfigured } from "./llm.js";
import { applyToAtsJob } from "./platforms/ats.js";
import { prefillLinkedInApplication } from "./platforms/linkedin.js";
import { prefillNaukriApplication } from "./platforms/naukri.js";
import { prefillIndeedApplication } from "./platforms/indeed.js";
import { findExisting, recordApplication, listApplications } from "./tracker.js";
import { policyExplanation, canAutoSubmit } from "./policy.js";
import { applySchedule } from "./scheduler.js";
import type { Profile, AggregatedJob } from "./types.js";

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

/** Tailors (if not already done for this job) and returns the PDF path, reusing a cached tailor if present. */
async function ensureTailoredResume(job: AggregatedJob, profile: Profile): Promise<string> {
  const pdfPath = tailoredPdfPath(job.id);
  if (existsSync(pdfPath)) return pdfPath;

  const { resumeText } = getState();
  if (!resumeText) throw new Error("No resume uploaded yet - upload one in Settings first.");

  const jdText = job.snippet && job.snippet.length > 200 ? job.snippet : await fetchJobDescriptionText(job.url, job.platform);
  const content = await tailorResumeWithAI(resumeText, job.title, job.company, jdText, profile);
  await generateResumePdf(content, pdfPath);
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
    const extracted = await extractProfileFromResume(text, loadProfile());
    setState({ resumePath: req.file.path, resumeText: text, resumeFileName: req.file.originalname, resumeExtraction: extracted });
    res.json({ fileName: req.file.originalname, length: text.length, preview: text.slice(0, 400), extracted });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/resume", (_req: Request, res: Response) => {
  const { resumeFileName, resumeText, resumeExtraction } = getState();
  if (!resumeText) return res.json({ uploaded: false });
  // Resumes uploaded before extraction existed get it computed (heuristics only) on first read.
  const extracted = resumeExtraction ?? extractHeuristically(resumeText);
  res.json({ uploaded: true, fileName: resumeFileName, length: resumeText.length, preview: resumeText.slice(0, 400), extracted });
});

app.delete("/api/resume", (_req: Request, res: Response) => {
  const { resumePath } = getState();
  if (resumePath) rmSync(resumePath, { force: true });
  setState({ resumePath: undefined, resumeText: undefined, resumeFileName: undefined, resumeExtraction: undefined });
  res.json({ uploaded: false });
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
  res.json({ ...cached, jobs: cached.jobs.map((j) => ({ ...j, tailored: existsSync(tailoredPdfPath(j.id)) })) });
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

/**
 * Serves a tailored PDF inline (for the in-app preview) or, with ?download=1,
 * as an attachment named by ?name= instead of the job-id hash.
 */
app.get("/api/tailored/:fileName", (req: Request, res: Response) => {
  const fileName = basename(req.params.fileName);
  if (extname(fileName) !== ".pdf") return res.status(404).end();
  const path = join(TAILORED_DIR, fileName);
  if (!existsSync(path)) return res.status(404).end();

  if (req.query.download) {
    const requested = typeof req.query.name === "string" ? req.query.name.replace(/[^\w .()-]+/g, "_").slice(0, 120) : "";
    return res.download(path, requested ? `${requested.replace(/\.pdf$/i, "")}.pdf` : fileName);
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
  const existing = await findExisting(job.url);
  if (existing && !req.body?.force) {
    return res.json({ status: "skipped_duplicate", existing });
  }

  try {
    const resumePdfPath = await ensureTailoredResume(job, profile);

    if (job.platform === "greenhouse" || job.platform === "lever" || job.platform === "workday") {
      const result = await applyToAtsJob(job.platform, job.url, profile, resumePdfPath, {}, true);
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
        ? await prefillLinkedInApplication(job.url, profile, resumePdfPath)
        : job.platform === "naukri"
        ? await prefillNaukriApplication(job.url, profile, resumePdfPath)
        : await prefillIndeedApplication(job.url, profile, resumePdfPath);

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
  console.error(`[job-search-agent] HTTP API listening on http://localhost:${PORT}`);
  applySchedule(loadProfile());
});
