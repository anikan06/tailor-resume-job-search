export interface CustomQuestionAnswer {
  question_contains: string;
  answer: string;
}

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
    min_years_experience?: number | null;
    exclude_companies?: string[];
  };
  custom_question_answers?: CustomQuestionAnswer[];
  resume?: {
    default_path?: string;
  };
  /** Used by the Angular app only - the MCP-server path never needed these. */
  boards?: {
    greenhouse?: string[];   // company board tokens, e.g. ["stripe", "figma"]
    lever?: string[];        // company slugs, e.g. ["netflix"]
  };
  ai?: {
    /** Which LLM to use. Unset = whichever provider has a key (older profiles only had Anthropic). */
    provider?: AiProvider;
    /** Overrides the provider's default model. */
    model?: string;
    /** The user's own keys, used only for resume reading/tailoring. Never logged, only sent to that provider. */
    anthropic_api_key?: string;
    openai_api_key?: string;
    gemini_api_key?: string;
    /** Local Ollama server (free, no key). Defaults to http://localhost:11434. */
    ollama_base_url?: string;
  };
  schedule?: {
    enabled?: boolean;
    cron?: string; // e.g. "0 7 * * *" = 7am daily
  };
  apply?: {
    /** Only tailor and hand back the PDF - never open a browser or fill/submit a form. */
    tailor_only?: boolean;
  };
  /** The candidate's background, read from the resume and editable on the Profile page. */
  career?: CareerProfile;
}

/** Dates are kept as the resume wrote them ("Jan 2020", "2020-01", "2020"). */
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

export type AiProvider = "anthropic" | "openai" | "gemini" | "ollama";

export type Platform = "linkedin" | "naukri" | "indeed" | "greenhouse" | "lever" | "workday" | "other_ats";

/** Platforms the server will submit an application on without a human click. */
export const AUTO_SUBMIT_ALLOWED: ReadonlySet<Platform> = new Set<Platform>([
  "greenhouse",
  "lever",
  "workday",
]);

export interface JobListing {
  platform: Platform;
  title: string;
  company: string;
  location?: string;
  url: string;
  postedAt?: string;
  /** Short snippet, not the full JD - call get_job_description for that. */
  snippet?: string;
}

export interface ApplicationRecord {
  id: string;            // sha256 of the job URL
  platform: Platform;
  title: string;
  company: string;
  url: string;
  status: "prefilled" | "submitted" | "skipped_duplicate" | "failed";
  appliedAt: string;     // ISO timestamp
  note?: string;
}

export interface FieldAnswer {
  fieldLabel: string;
  value: string;
  source: "profile" | "custom_question_answers" | "caller" | "unanswered";
}

/** A job listing enriched for the dashboard: scored, deduped, apply-policy-aware. */
export interface AggregatedJob extends JobListing {
  id: string;                 // same hashing as tracker.jobIdFor
  relevanceScore: number;     // 0-100, resume/keyword overlap
  alreadyApplied: boolean;
  autoSubmitEligible: boolean; // canAutoSubmit(platform)
}

export interface TailoredResumeResult {
  jobId: string;
  headerTitle: string;
  contactLine: string;
  summary: string;
  sections: { heading: string; lines: string[] }[];
  docxPath: string;
}
