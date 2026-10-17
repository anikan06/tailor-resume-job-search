#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { loadProfile } from "./config.js";
import { extractResumeText } from "./resume/parse.js";
import { generateResumeDocx, type TailoredResumeInput } from "./resume/generate.js";
import { findExisting, recordApplication, listApplications } from "./tracker.js";
import { policyExplanation } from "./policy.js";
import { searchGreenhouse, searchLever, applyToAtsJob } from "./platforms/ats.js";
import { searchLinkedInJobs, prefillLinkedInApplication } from "./platforms/linkedin.js";
import { searchNaukriJobs, prefillNaukriApplication } from "./platforms/naukri.js";
import { searchIndeedJobs, prefillIndeedApplication } from "./platforms/indeed.js";
import { searchGoogleJobs } from "./platforms/google.js";
import type { Platform } from "./types.js";

const profile = loadProfile();

// ---- tool schemas -----------------------------------------------------

const tools = [
  {
    name: "get_profile",
    description:
      "Returns the loaded profile.yaml (personal details, search preferences, custom question answers). " +
      "Empty fields mean the user hasn't configured that part - ask them or use per-call overrides instead of guessing.",
    inputSchema: z.object({}),
  },
  {
    name: "parse_resume",
    description: "Extracts plain text from a resume file (.pdf, .docx, .txt, .md) at a given path, for any candidate's resume.",
    inputSchema: z.object({ filePath: z.string().describe("Absolute or relative path to the resume file") }),
  },
  {
    name: "generate_tailored_resume_docx",
    description:
      "Writes a tailored resume (content YOU already rewrote for the target job description) to a .docx file. " +
      "This tool does not do the tailoring/rewriting itself - decide what to emphasize/cut for the JD first, then call this to render it.",
    inputSchema: z.object({
      headerTitle: z.string(),
      contactLine: z.string(),
      summary: z.string(),
      sections: z.array(z.object({ heading: z.string(), lines: z.array(z.string()) })),
      outPath: z.string().describe("Where to write the .docx file"),
    }),
  },
  {
    name: "search_greenhouse_jobs",
    description: "Searches a company's public Greenhouse job board (no login needed). boardToken is the company's Greenhouse slug, e.g. 'stripe'.",
    inputSchema: z.object({ boardToken: z.string(), keywords: z.array(z.string()).optional() }),
  },
  {
    name: "search_lever_jobs",
    description: "Searches a company's public Lever job board (no login needed). company is the Lever slug, e.g. 'netflix'.",
    inputSchema: z.object({ company: z.string(), keywords: z.array(z.string()).optional() }),
  },
  {
    name: "apply_ats_job",
    description:
      "Applies to a Greenhouse/Lever/Workday job posting URL: opens a visible browser, uploads the resume, fills fields from the profile/answers. " +
      "Will only actually SUBMIT if the platform allows auto-submit (Greenhouse/Lever/Workday do) AND confirmSubmit=true AND every field was answered - " +
      "otherwise it stops after prefilling and leaves the browser open for you to finish.",
    inputSchema: z.object({
      platform: z.enum(["greenhouse", "lever", "workday", "other_ats"]),
      jobUrl: z.string(),
      resumeFilePath: z.string().optional(),
      extraAnswers: z.record(z.string()).optional(),
      confirmSubmit: z.boolean().optional().default(false),
    }),
  },
  {
    name: "search_linkedin_jobs",
    description: "Searches LinkedIn job listings using your logged-in Chrome session. Requires Chrome running with remote debugging enabled (see README).",
    inputSchema: z.object({ keywords: z.array(z.string()), location: z.string().optional(), limit: z.number().optional() }),
  },
  {
    name: "prefill_linkedin_application",
    description: "Opens a LinkedIn job and prefills the Easy Apply form. NEVER submits - LinkedIn can ban accounts for automated applying. You must review and submit yourself.",
    inputSchema: z.object({
      jobUrl: z.string(),
      resumeFilePath: z.string().optional(),
      extraAnswers: z.record(z.string()).optional(),
    }),
  },
  {
    name: "search_naukri_jobs",
    description: "Searches Naukri job listings using your logged-in Chrome session.",
    inputSchema: z.object({ keywords: z.array(z.string()), location: z.string().optional(), limit: z.number().optional() }),
  },
  {
    name: "prefill_naukri_application",
    description: "Opens a Naukri job and prefills the apply form. NEVER submits - you must review and submit yourself.",
    inputSchema: z.object({
      jobUrl: z.string(),
      resumeFilePath: z.string().optional(),
      extraAnswers: z.record(z.string()).optional(),
    }),
  },
  {
    name: "search_indeed_jobs",
    description: "Searches Indeed job listings using your logged-in Chrome session.",
    inputSchema: z.object({ keywords: z.array(z.string()), location: z.string().optional(), limit: z.number().optional(), domain: z.string().optional() }),
  },
  {
    name: "prefill_indeed_application",
    description: "Opens an Indeed job and prefills the apply form. NEVER submits - you must review and submit yourself.",
    inputSchema: z.object({
      jobUrl: z.string(),
      resumeFilePath: z.string().optional(),
      extraAnswers: z.record(z.string()).optional(),
    }),
  },
  {
    name: "search_google_jobs",
    description:
      "Searches Google Jobs (which aggregates many boards and company career sites) using your Chrome session. " +
      "Each result's url is its resolved apply link and platform is where that link lands, so apply via that platform's tools.",
    inputSchema: z.object({ keywords: z.array(z.string()), location: z.string().optional(), limit: z.number().optional() }),
  },
  {
    name: "check_already_applied",
    description: "Checks the local application tracker for whether this job URL was already applied to/prefilled, to avoid duplicate applications.",
    inputSchema: z.object({ jobUrl: z.string() }),
  },
  {
    name: "record_application",
    description: "Records an application attempt (prefilled/submitted/skipped_duplicate/failed) in the local tracker. Call this after every apply attempt.",
    inputSchema: z.object({
      platform: z.enum(["linkedin", "naukri", "indeed", "greenhouse", "lever", "workday", "other_ats"]),
      title: z.string(),
      company: z.string(),
      url: z.string(),
      status: z.enum(["prefilled", "submitted", "skipped_duplicate", "failed"]),
      note: z.string().optional(),
    }),
  },
  {
    name: "list_applications",
    description: "Lists every application recorded so far (your running job-search log).",
    inputSchema: z.object({}),
  },
  {
    name: "explain_apply_policy",
    description: "Explains, for a given platform, whether this server will auto-submit or only prefill, and why.",
    inputSchema: z.object({ platform: z.enum(["linkedin", "naukri", "indeed", "greenhouse", "lever", "workday", "other_ats"]) }),
  },
] as const;

function zodToJsonSchema(schema: z.ZodTypeAny): any {
  // Minimal, dependency-free zod->JSON-Schema shim covering the shapes used above.
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as z.ZodTypeAny);
      if (!(value as z.ZodTypeAny).isOptional()) required.push(key);
    }
    return { type: "object", properties, required: required.length ? required : undefined };
  }
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodArray) return { type: "array", items: zodToJsonSchema(schema.element) };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodRecord) return { type: "object", additionalProperties: { type: "string" } };
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodDefault) return zodToJsonSchema(schema._def.innerType);
  return {};
}

// ---- server -------------------------------------------------------------

const server = new Server(
  { name: "job-search-agent", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    const result = await dispatch(name, args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
      isError: true,
    };
  }
});

async function dispatch(name: string, args: Record<string, any>): Promise<unknown> {
  switch (name) {
    case "get_profile":
      return profile;

    case "parse_resume":
      return { text: await extractResumeText(args.filePath) };

    case "generate_tailored_resume_docx": {
      const input: TailoredResumeInput = {
        headerTitle: args.headerTitle,
        contactLine: args.contactLine,
        summary: args.summary,
        sections: args.sections,
      };
      const path = await generateResumeDocx(input, args.outPath);
      return { path };
    }

    case "search_greenhouse_jobs":
      return searchGreenhouse(args.boardToken, args.keywords ?? []);

    case "search_lever_jobs":
      return searchLever(args.company, args.keywords ?? []);

    case "apply_ats_job":
      return applyToAtsJob(
        args.platform as Platform,
        args.jobUrl,
        profile,
        args.resumeFilePath,
        args.extraAnswers ?? {},
        Boolean(args.confirmSubmit)
      );

    case "search_linkedin_jobs":
      return searchLinkedInJobs(args.keywords, args.location ?? "", args.limit ?? 20);

    case "prefill_linkedin_application":
      return prefillLinkedInApplication(args.jobUrl, profile, args.resumeFilePath, args.extraAnswers ?? {});

    case "search_naukri_jobs":
      return searchNaukriJobs(args.keywords, args.location ?? "", args.limit ?? 20);

    case "prefill_naukri_application":
      return prefillNaukriApplication(args.jobUrl, profile, args.resumeFilePath, args.extraAnswers ?? {});

    case "search_indeed_jobs":
      return searchIndeedJobs(args.keywords, args.location ?? "", args.limit ?? 20, args.domain ?? "in.indeed.com");

    case "prefill_indeed_application":
      return prefillIndeedApplication(args.jobUrl, profile, args.resumeFilePath, args.extraAnswers ?? {});

    case "search_google_jobs":
      return searchGoogleJobs(args.keywords, args.location ?? "", args.limit ?? 20);

    case "check_already_applied":
      return (await findExisting(args.jobUrl)) ?? { found: false };

    case "record_application":
      return recordApplication({
        platform: args.platform,
        title: args.title,
        company: args.company,
        url: args.url,
        status: args.status,
        note: args.note,
      });

    case "list_applications":
      return listApplications();

    case "explain_apply_policy":
      return { explanation: policyExplanation(args.platform) };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[job-search-agent] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[job-search-agent] fatal error:", err);
  process.exit(1);
});
