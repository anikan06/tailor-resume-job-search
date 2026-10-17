export type Platform = 'linkedin' | 'naukri' | 'indeed' | 'greenhouse' | 'lever' | 'workday' | 'other_ats';

export interface CustomQuestionAnswer {
  question_contains: string;
  answer: string;
}

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'ollama';

export interface Profile {
  personal: {
    full_name?: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin_url?: string;
    portfolio_url?: string;
    github_url?: string;
    years_experience?: number;
    notice_period_days?: number;
    current_ctc?: string;
    expected_ctc?: string;
    work_authorization?: string;
    willing_to_relocate?: boolean;
  };
  search: {
    target_roles?: string[];
    keywords?: string[];
    locations?: string[];
    remote_ok?: boolean;
    exclude_companies?: string[];
  };
  custom_question_answers?: CustomQuestionAnswer[];
  boards?: { greenhouse?: string[]; lever?: string[] };
  ai?: {
    provider?: AiProvider;
    model?: string;
    ollama_base_url?: string;
    /** Read-only, from the server: whether the active provider is ready to use. */
    apiKeyConfigured?: boolean;
    /** Read-only, from the server: which providers have a saved key (keys themselves are never sent back). */
    keysConfigured?: Partial<Record<AiProvider, boolean>>;
    anthropic_api_key?: string;
    openai_api_key?: string;
    gemini_api_key?: string;
  };
  schedule?: { enabled?: boolean; cron?: string };
  /** tailor_only: "Apply" just tailors and downloads the resume, for applying manually anywhere. */
  apply?: { tailor_only?: boolean };
  /** Background read from the resume; edited on the Profile page. */
  career?: CareerProfile;
}

/** Mirrors the career types in server/src/types.ts. Dates are free text, as written in the resume. */
export interface WorkExperience {
  title?: string;
  company?: string;
  location?: string;
  start_date?: string;
  end_date?: string;
  current?: boolean;
  highlights?: string[];
}

export interface Education {
  institution?: string;
  degree?: string;
  field?: string;
  start_date?: string;
  end_date?: string;
  grade?: string;
  details?: string[];
}

export interface Project {
  name?: string;
  url?: string;
  technologies?: string[];
  highlights?: string[];
}

export interface Certification {
  name?: string;
  issuer?: string;
  date?: string;
  url?: string;
}

export interface Language {
  name?: string;
  /** e.g. "Native", "Fluent", "Professional", "Basic". */
  proficiency?: string;
}

/** A section the resume has beyond the standard ones, e.g. "Achievements" or "Volunteering". */
export interface AdditionalSection {
  heading?: string;
  items?: string[];
}

export interface CareerProfile {
  headline?: string;
  summary?: string;
  skills?: string[];
  experience?: WorkExperience[];
  education?: Education[];
  projects?: Project[];
  certifications?: Certification[];
  languages?: Language[];
  additional_sections?: AdditionalSection[];
}

export interface JobListing {
  platform: Platform;
  title: string;
  company: string;
  location?: string;
  url: string;
  postedAt?: string;
  snippet?: string;
}

export interface AggregatedJob extends JobListing {
  id: string;
  relevanceScore: number;
  alreadyApplied: boolean;
  autoSubmitEligible: boolean;
  /** A tailored PDF resume already exists for this job. */
  tailored?: boolean;
}

export interface AggregationSourceError {
  source: string;
  message: string;
}

export interface AggregationResult {
  jobs: AggregatedJob[];
  errors: AggregationSourceError[];
  aggregatedAt: string | null;
}

export interface ApplicationRecord {
  id: string;
  platform: Platform;
  title: string;
  company: string;
  url: string;
  /** 'tailored': only a resume was made, from a job link, for the user to apply with themselves. */
  status: 'prefilled' | 'submitted' | 'skipped_duplicate' | 'failed' | 'tailored';
  appliedAt: string;
  note?: string;
  tailored?: boolean;
}

export interface ResumeExtraction {
  personal: Partial<
    Pick<
      Profile['personal'],
      'full_name' | 'email' | 'phone' | 'location' | 'linkedin_url' | 'github_url' | 'portfolio_url' | 'years_experience'
    >
  >;
  suggestedRoles: string[];
  skills: string[];
  career?: CareerProfile;
  source: 'ai' | 'heuristic';
}

export interface ResumeInfo {
  uploaded: boolean;
  fileName?: string;
  length?: number;
  preview?: string;
  extracted?: ResumeExtraction;
}

export interface ApplyResult {
  status?: 'skipped_duplicate';
  submitted?: boolean;
  note?: string;
  record?: ApplicationRecord;
  existing?: ApplicationRecord;
  error?: string;
}

export type LlmActivity = 'tailor_resume' | 'extract_resume' | 'import_profile' | 'read_job';

export interface UsageTotals {
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** Absent in summaries from servers older than this field. */
  reasoningTokens?: number;
  cachedInputTokens?: number;
  totalTokens: number;
  durationMs?: number;
}

/** Mirrors RateLimitSnapshot in server/src/telemetry.ts. */
export interface RateLimitSnapshot {
  requestsLimit?: number;
  requestsRemaining?: number;
  requestsReset?: string;
  tokensLimit?: number;
  tokensRemaining?: number;
  tokensReset?: string;
  inputTokensRemaining?: number;
  outputTokensRemaining?: number;
}

export interface RateLimitStatus extends RateLimitSnapshot {
  at: string;
  model: string;
}

/**
 * Mirrors LlmUsageRecord in server/src/telemetry.ts. Everything after `ok` was
 * added later, so calls logged before then don't have it.
 */
export interface LlmUsageRecord {
  at: string;
  activity: LlmActivity;
  jobId?: string;
  provider: AiProvider;
  model: string;
  /** Includes any cached part. */
  inputTokens: number;
  /** Visible reply only. */
  outputTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
  durationMs: number;
  ok: boolean;
  error?: string;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  requestId?: string;
  responseModel?: string;
  stopReason?: string;
  serviceTier?: string;
  httpStatus?: number;
  rateLimit?: RateLimitSnapshot;
  maxTokens?: number;
  promptChars?: number;
  responseChars?: number;
}

/** Mirrors ActivityStats in server/src/telemetry.ts. */
export interface ActivityStats {
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  outputTokensPerSecond?: number;
  promptCharsPerToken?: number;
}

/** Mirrors ErrorGroup in server/src/telemetry.ts. */
export interface ErrorGroup {
  message: string;
  count: number;
  lastAt: string;
  activities: LlmActivity[];
  providers: AiProvider[];
}

/** Mirrors UsageSummary in server/src/telemetry.ts. */
export interface UsageSummary {
  totals: UsageTotals;
  byActivity: Partial<Record<LlmActivity, UsageTotals>>;
  byModel: Record<string, UsageTotals>;
  byProvider?: Partial<Record<AiProvider, UsageTotals>>;
  stopReasons?: Record<string, number>;
  rateLimits?: Partial<Record<AiProvider, RateLimitStatus>>;
  byJob: Record<string, UsageTotals>;
  /** Absent in summaries from servers older than these fields. */
  activityStats?: Partial<Record<LlmActivity, ActivityStats>>;
  errors?: ErrorGroup[];
  /** Keyed by local calendar day (YYYY-MM-DD), oldest first. */
  byDay: Record<string, UsageTotals>;
  recent: LlmUsageRecord[];
}

export interface LinkTailorRequest {
  url: string;
  title?: string;
  company?: string;
  /** Pasted job description, for postings the server can't read (e.g. behind a login). */
  description?: string;
  /** Key responsibilities and must-have skills as the user checked them, one per line. */
  responsibilities?: string;
  skills?: string;
}

export interface LinkTailorResult {
  jobId: string;
  title: string;
  company: string;
  platform: Platform;
  pdfUrl: string;
}

/** "Just tailor & download": a pasted job description, no link. */
export interface QuickTailorRequest {
  description: string;
  title?: string;
  company?: string;
}

/** How many of the job description's keywords the resume contains, as an ATS keyword filter would check. */
export interface AtsReport {
  keywords: string[];
  matched: string[];
  /** Not in the candidate's resume or profile, so left out rather than invented. */
  missing: string[];
  scoreBefore: number;
  scoreAfter: number;
}

export interface QuickTailorResult {
  jobId: string;
  title: string;
  company: string;
  pdfUrl: string;
  docxUrl: string;
  ats: AtsReport;
}

/** A rendered resume's text: one role/project/degree. */
export interface ResumeEntry {
  title: string;
  organization?: string;
  location?: string;
  dates?: string;
  bullets?: string[];
}

export interface ResumeSection {
  heading: string;
  /** List lines (skills, certifications...). */
  lines?: string[];
  entries?: ResumeEntry[];
}

/** Everything a rendered resume says, editable before re-rendering. */
export interface ResumeContent {
  headerTitle: string;
  headline?: string;
  contactLine: string;
  summary: string;
  sections: ResumeSection[];
}

/** The Profile page's general (not job-specific) ATS resume. */
export interface ProfileResumeResult {
  jobId: string;
  name: string;
  headline: string;
  pdfUrl: string;
  docxUrl: string;
  content: ResumeContent;
}

/** What the server read from a pasted job link, shown for the user to check before tailoring. */
export interface JobPostingPreview {
  platform: Platform;
  title: string;
  company: string;
  /** Empty when the page couldn't be read - `warning` then says so. */
  description: string;
  responsibilities: string[];
  /** Must-have / required skills only. */
  skills: string[];
  warning?: string;
}

export interface JobSections {
  responsibilities: string[];
  skills: string[];
}
