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
  status: 'prefilled' | 'submitted' | 'skipped_duplicate' | 'failed';
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

export type LlmActivity = 'tailor_resume' | 'extract_resume' | 'import_profile';

export interface UsageTotals {
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LlmUsageRecord {
  at: string;
  activity: LlmActivity;
  jobId?: string;
  provider: AiProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
  durationMs: number;
  ok: boolean;
  error?: string;
}

/** Mirrors UsageSummary in server/src/telemetry.ts. */
export interface UsageSummary {
  totals: UsageTotals;
  byActivity: Partial<Record<LlmActivity, UsageTotals>>;
  byModel: Record<string, UsageTotals>;
  byJob: Record<string, UsageTotals>;
  recent: LlmUsageRecord[];
}
