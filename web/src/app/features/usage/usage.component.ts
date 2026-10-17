import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import {
  AiProvider,
  ApplicationRecord,
  LlmActivity,
  LlmUsageRecord,
  RateLimitStatus,
  UsageSummary,
  UsageTotals
} from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { formatTokens, tokenTitle } from '../../shared/tokens';

type CallFilter = 'all' | LlmActivity | 'failed';

const ACTIVITY_LABELS: Record<LlmActivity, string> = {
  tailor_resume: 'Resume tailoring',
  extract_resume: 'Resume reading',
  import_profile: 'Profile import',
  read_job: 'Job reading'
};

const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  gemini: 'Google Gemini',
  ollama: 'Ollama (local)'
};

/** Stop reasons meaning the reply was cut off at the output cap, per provider's naming. */
const TRUNCATED = new Set(['max_tokens', 'length', 'MAX_TOKENS']);
/** Stop reasons meaning the provider's safety or policy filters stepped in. */
const BLOCKED = /^(SAFETY|RECITATION|PROHIBITED_CONTENT|BLOCKLIST|SPII|BLOCKED_.*|content_filter|refusal)$/;

type StopKind = 'ok' | 'truncated' | 'blocked';

interface ProviderPanel {
  provider: AiProvider;
  label: string;
  totals: UsageTotals;
  avgMs: number;
  /** Share of input tokens served from the provider's cache, 0-100. */
  cachedShare: number;
  rateLimit?: RateLimitStatus;
}

interface DetailRow {
  label: string;
  value: string;
  mono?: boolean;
  hint?: string;
}

/** How many of the most recent calls to fetch for the call log. */
const RECENT_LIMIT = 200;
/** Days shown in the daily chart. */
const CHART_DAYS = 14;

interface Breakdown {
  key: string;
  label: string;
  totals: UsageTotals;
  /** Share of all tokens, 0-100. */
  share: number;
}

@Component({
  selector: 'app-usage',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent],
  templateUrl: './usage.component.html',
  styleUrl: './usage.component.scss'
})
export class UsageComponent implements OnInit {
  usage = signal<UsageSummary | null>(null);
  /** Applications by job id, so tailoring calls can show which role they were for. */
  jobs = signal<Record<string, ApplicationRecord>>({});
  loaded = signal(false);
  loading = signal(false);
  error = signal<string | null>(null);
  filter = signal<CallFilter>('all');
  /** The call whose details are expanded in the log. */
  expanded = signal<LlmUsageRecord | null>(null);

  readonly formatTokens = formatTokens;
  readonly tokenTitle = tokenTitle;
  readonly recentLimit = RECENT_LIMIT;

  filters: { key: CallFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'tailor_resume', label: 'Tailoring' },
    { key: 'extract_resume', label: 'Resume reading' },
    { key: 'import_profile', label: 'Imports' },
    { key: 'read_job', label: 'Job reading' },
    { key: 'failed', label: 'Failed' }
  ];

  activities = computed(() => this.breakdown(this.usage()?.byActivity ?? {}, (k) => this.activityLabel(k as LlmActivity)));
  models = computed(() => this.breakdown(this.usage()?.byModel ?? {}, (k) => k));

  tailorAverage = computed(() => {
    const t = this.usage()?.byActivity.tailor_resume;
    return t?.calls ? t.totalTokens / t.calls : 0;
  });

  averageDurationMs = computed(() => {
    const u = this.usage();
    if (!u) return 0;
    if (u.totals.durationMs !== undefined) return u.totals.calls ? u.totals.durationMs / u.totals.calls : 0;
    const recent = u.recent;
    return recent.length ? recent.reduce((sum, r) => sum + r.durationMs, 0) / recent.length : 0;
  });

  providers = computed<ProviderPanel[]>(() => {
    const u = this.usage();
    if (!u?.byProvider) return [];
    return (Object.entries(u.byProvider) as [AiProvider, UsageTotals][])
      .map(([provider, totals]) => ({
        provider,
        label: this.providerLabel(provider),
        totals,
        avgMs: totals.calls ? (totals.durationMs ?? 0) / totals.calls : 0,
        cachedShare: totals.inputTokens ? ((totals.cachedInputTokens ?? 0) / totals.inputTokens) * 100 : 0,
        rateLimit: u.rateLimits?.[provider]
      }))
      .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);
  });

  stopReasons = computed(() =>
    Object.entries(this.usage()?.stopReasons ?? {})
      .map(([reason, count]) => ({ reason, count, kind: this.stopKind(reason) }))
      .sort((a, b) => b.count - a.count)
  );

  /** The last CHART_DAYS days, including empty ones, with bar heights relative to the busiest day. */
  days = computed(() => {
    const byDay = this.usage()?.byDay ?? {};
    const out: { day: string; date: Date; totals: UsageTotals | undefined }[] = [];
    const today = new Date();
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const day = date.toLocaleDateString('en-CA');
      out.push({ day, date, totals: byDay[day] });
    }
    const max = Math.max(1, ...out.map((d) => d.totals?.totalTokens ?? 0));
    return out.map((d) => ({ ...d, height: ((d.totals?.totalTokens ?? 0) / max) * 100 }));
  });

  counts = computed(() => {
    const c: Record<CallFilter, number> = { all: 0, tailor_resume: 0, extract_resume: 0, import_profile: 0, read_job: 0, failed: 0 };
    for (const r of this.usage()?.recent ?? []) {
      c.all++;
      c[r.activity]++;
      if (!r.ok) c.failed++;
    }
    return c;
  });

  calls = computed(() => {
    const f = this.filter();
    return (this.usage()?.recent ?? []).filter((r) => f === 'all' || (f === 'failed' ? !r.ok : r.activity === f));
  });

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    forkJoin({ usage: this.api.getUsage(RECENT_LIMIT), applications: this.api.getApplications() }).subscribe({
      next: ({ usage, applications }) => {
        this.usage.set(usage);
        this.jobs.set(Object.fromEntries(applications.map((a) => [a.id, a])));
        this.loaded.set(true);
        this.loading.set(false);
      },
      error: () => {
        this.usage.set(null);
        this.error.set("Couldn't load usage. Is the server running on port 4000?");
        this.loaded.set(true);
        this.loading.set(false);
      }
    });
  }

  providerLabel(provider: AiProvider): string {
    return PROVIDER_LABELS[provider] ?? provider;
  }

  stopKind(reason: string | undefined): StopKind {
    if (!reason) return 'ok';
    if (TRUNCATED.has(reason)) return 'truncated';
    return BLOCKED.test(reason) ? 'blocked' : 'ok';
  }

  stopTitle(kind: StopKind): string {
    if (kind === 'truncated') return 'The reply hit the output token cap and was cut off.';
    if (kind === 'blocked') return "The provider's safety or policy filters stopped the reply.";
    return 'Finished normally.';
  }

  toggle(call: LlmUsageRecord): void {
    this.expanded.set(this.expanded() === call ? null : call);
  }

  /** Output (visible + thinking) tokens per second of wall-clock time. */
  tokensPerSecond(call: LlmUsageRecord): number | null {
    const out = call.outputTokens + (call.reasoningTokens ?? 0);
    return call.durationMs > 0 && out > 0 ? out / (call.durationMs / 1000) : null;
  }

  /** Everything the provider reported about one call, for the expanded row. */
  detailRows(c: LlmUsageRecord): DetailRow[] {
    const rows: (DetailRow | null)[] = [
      { label: 'Provider', value: this.providerLabel(c.provider) },
      { label: 'Model requested', value: c.model, mono: true },
      c.responseModel && c.responseModel !== c.model
        ? { label: 'Model that answered', value: c.responseModel, mono: true, hint: 'The exact version the provider resolved the name to.' }
        : null,
      c.requestId ? { label: 'Request ID', value: c.requestId, mono: true, hint: "Quote this to the provider's support." } : null,
      c.httpStatus ? { label: 'HTTP status', value: String(c.httpStatus) } : null,
      c.stopReason ? { label: 'Stop reason', value: c.stopReason, mono: true, hint: this.stopTitle(this.stopKind(c.stopReason)) } : null,
      c.serviceTier ? { label: 'Service tier', value: c.serviceTier, mono: true } : null,
      { label: 'Input tokens', value: c.inputTokens.toLocaleString() },
      c.cachedInputTokens ? { label: '…served from cache', value: c.cachedInputTokens.toLocaleString(), hint: 'Billed at a discount.' } : null,
      c.cacheWriteTokens ? { label: '…written to cache', value: c.cacheWriteTokens.toLocaleString() } : null,
      { label: 'Output tokens', value: c.outputTokens.toLocaleString() },
      c.reasoningTokens ? { label: 'Thinking tokens', value: c.reasoningTokens.toLocaleString(), hint: 'Billed as output.' } : null,
      { label: 'Total tokens', value: c.totalTokens.toLocaleString() },
      c.maxTokens ? { label: 'Output cap (max tokens)', value: c.maxTokens.toLocaleString() } : null,
      { label: 'Duration', value: this.formatDuration(c.durationMs) },
      this.tokensPerSecond(c) !== null ? { label: 'Speed', value: `${Math.round(this.tokensPerSecond(c)!)} tokens/s` } : null,
      c.promptChars !== undefined ? { label: 'Prompt size', value: `${c.promptChars.toLocaleString()} chars` } : null,
      c.responseChars !== undefined ? { label: 'Reply size', value: `${c.responseChars.toLocaleString()} chars` } : null
    ];
    const r = c.rateLimit;
    if (r) {
      rows.push(
        r.requestsRemaining !== undefined
          ? { label: 'Requests left', value: this.limitText(r.requestsRemaining, r.requestsLimit), hint: r.requestsReset && `Resets ${r.requestsReset}` }
          : null,
        r.tokensRemaining !== undefined
          ? { label: 'Tokens left', value: this.limitText(r.tokensRemaining, r.tokensLimit), hint: r.tokensReset && `Resets ${r.tokensReset}` }
          : null,
        r.inputTokensRemaining !== undefined ? { label: 'Input tokens left', value: r.inputTokensRemaining.toLocaleString() } : null,
        r.outputTokensRemaining !== undefined ? { label: 'Output tokens left', value: r.outputTokensRemaining.toLocaleString() } : null
      );
    }
    return rows.filter((row): row is DetailRow => row !== null);
  }

  /** "4,950 of 5,000". */
  limitText(remaining: number, limit: number | undefined): string {
    return limit !== undefined ? `${remaining.toLocaleString()} of ${limit.toLocaleString()}` : remaining.toLocaleString();
  }

  /** Percentage of a rate limit still available, for the meter. */
  remainingShare(remaining: number | undefined, limit: number | undefined): number | null {
    return remaining !== undefined && limit ? (remaining / limit) * 100 : null;
  }

  activityLabel(activity: LlmActivity): string {
    return ACTIVITY_LABELS[activity] ?? activity;
  }

  jobFor(call: LlmUsageRecord): ApplicationRecord | undefined {
    return call.jobId ? this.jobs()[call.jobId] : undefined;
  }

  formatDuration(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  }

  dayTitle(d: { date: Date; totals: UsageTotals | undefined }): string {
    const label = d.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return d.totals ? `${label}: ${d.totals.totalTokens.toLocaleString()} tokens (${tokenTitle(d.totals)})` : `${label}: no AI calls`;
  }

  private breakdown(source: Record<string, UsageTotals | undefined>, label: (key: string) => string): Breakdown[] {
    const total = this.usage()?.totals.totalTokens || 1;
    return Object.entries(source)
      .filter((e): e is [string, UsageTotals] => Boolean(e[1]))
      .map(([key, totals]) => ({ key, label: label(key), totals, share: (totals.totalTokens / total) * 100 }))
      .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);
  }
}
