import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, effect, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AggregatedJob, AggregationResult, LinkTailorResult } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { ResumePreviewDialogComponent } from '../../shared/resume-preview-dialog.component';
import { companyHue, companyInitial } from '../../shared/avatar';
import { platformLabel } from '../../shared/platform';

interface JobUiState {
  busy: boolean;
  message?: string;
  tone?: 'success' | 'info' | 'error';
}

type JobFilter = 'all' | 'auto' | 'prefill' | 'open';
type JobSort = 'relevance' | 'company' | 'recent';
type DashboardView = 'link' | 'best' | 'jobs';

/** How many of the top-scoring open roles "Best matches" shows. Scores are relative to each search, so no fixed cutoff. */
const BEST_MATCH_LIMIT = 5;
const VIEW_KEY = 'dashboard.view';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent, ResumePreviewDialogComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit, OnDestroy {
  result = signal<AggregationResult>({ jobs: [], errors: [], aggregatedAt: null });
  loading = signal(false);
  initialLoad = signal(true);
  jobState = new Map<string, JobUiState>();
  /** Text for the page's polite live region, so screen readers hear progress and results. */
  announcement = signal('');
  /** Settings → "Tailor my resume only": apply buttons tailor and download instead of applying. */
  tailorOnly = signal(false);
  /** Job whose tailored resume is open in the preview dialog. */
  previewJob = signal<AggregatedJob | null>(null);

  /** The user's first name, from the profile their resume filled in. */
  firstName = signal('');
  /** Which dashboard card is open. */
  view = signal<DashboardView>(readSavedView());

  /** Highest-scoring roles not applied to yet. */
  bestMatches = computed(() =>
    this.result()
      .jobs.filter((j) => j.relevanceScore > 0 && !j.alreadyApplied)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, BEST_MATCH_LIMIT)
  );

  /** "Tailor from a job link" panel. */
  link = {
    url: signal(''),
    title: signal(''),
    company: signal(''),
    description: signal(''),
    responsibilities: signal(''),
    skills: signal('')
  };
  /** Pulling the two sections out of a pasted description. */
  sectionsBusy = signal(false);
  /** Reading the pasted link's posting, to show its description before tailoring. */
  posting = signal<{ status: 'idle' | 'loading' | 'ready' | 'error'; message?: string }>({ status: 'idle' });
  private postingRequest?: Subscription;
  private postingTimer?: ReturnType<typeof setTimeout>;
  linkState = signal<JobUiState>({ busy: false });
  linkResult = signal<LinkTailorResult | null>(null);
  linkPreviewOpen = signal(false);

  query = signal('');
  filter = signal<JobFilter>('all');
  sort = signal<JobSort>('relevance');

  readonly companyHue = companyHue;
  readonly companyInitial = companyInitial;

  stats = computed(() => {
    const jobs = this.result().jobs;
    const avg = jobs.length ? Math.round(jobs.reduce((s, j) => s + j.relevanceScore, 0) / jobs.length) : 0;
    return {
      total: jobs.length,
      auto: jobs.filter((j) => j.autoSubmitEligible).length,
      applied: jobs.filter((j) => j.alreadyApplied).length,
      avg
    };
  });

  filterCounts = computed(() => {
    const jobs = this.result().jobs;
    return {
      all: jobs.length,
      auto: jobs.filter((j) => j.autoSubmitEligible).length,
      prefill: jobs.filter((j) => !j.autoSubmitEligible).length,
      open: jobs.filter((j) => !j.alreadyApplied).length
    };
  });

  visibleJobs = computed(() => {
    const q = this.query().trim().toLowerCase();
    const f = this.filter();
    const jobs = this.result().jobs.filter((j) => {
      if (f === 'auto' && !j.autoSubmitEligible) return false;
      if (f === 'prefill' && j.autoSubmitEligible) return false;
      if (f === 'open' && j.alreadyApplied) return false;
      if (!q) return true;
      return [j.title, j.company, j.location ?? '', j.platform].some((v) => v.toLowerCase().includes(q));
    });
    const sort = this.sort();
    return [...jobs].sort((a, b) => {
      if (sort === 'company') return a.company.localeCompare(b.company);
      if (sort === 'recent') return (b.postedAt ?? '').localeCompare(a.postedAt ?? '');
      return b.relevanceScore - a.relevanceScore;
    });
  });

  filters: { key: JobFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'auto', label: 'Auto-apply' },
    { key: 'prefill', label: 'Prefill' },
    { key: 'open', label: 'Not applied' }
  ];

  constructor(private api: ApiService) {
    effect(
      () => {
        const message = this.linkState().message ?? this.posting().message;
        if (message) this.announcement.set(message);
      },
      { allowSignalWrites: true }
    );
  }

  ngOnInit(): void {
    this.api.getProfile().subscribe((p) => {
      this.tailorOnly.set(Boolean(p.apply?.tailor_only));
      this.firstName.set(p.personal?.full_name?.trim().split(/\s+/)[0] ?? '');
    });
    this.api.getJobs().subscribe({
      next: (r) => {
        this.result.set(r);
        this.initialLoad.set(false);
      },
      error: (err) => {
        this.initialLoad.set(false);
        this.result.set({
          jobs: [],
          errors: [{ source: 'api', message: err.error?.error ?? 'Could not reach the server on localhost:4000.' }],
          aggregatedAt: null
        });
      }
    });
  }

  refresh(): void {
    this.loading.set(true);
    this.api.aggregateJobs().subscribe({
      next: (r) => {
        this.result.set(r);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.result.set({
          jobs: [],
          errors: [{ source: 'aggregate', message: err.error?.error ?? err.message }],
          aggregatedAt: null
        });
      }
    });
  }

  showView(view: DashboardView): void {
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Storage unavailable (private window) - the choice just isn't remembered.
    }
  }

  stateFor(job: AggregatedJob): JobUiState {
    return this.jobState.get(job.id) ?? { busy: false };
  }

  private setJobState(job: AggregatedJob, state: JobUiState): void {
    this.jobState.set(job.id, state);
    if (state.message) this.announcement.set(`${job.title} at ${job.company}: ${state.message}`);
  }

  apply(job: AggregatedJob): void {
    this.setJobState(job, { busy: true, tone: 'info', message: 'Tailoring resume and applying…' });
    this.api.applyToJob(job.id).subscribe({
      next: (res) => {
        if (res.status === 'skipped_duplicate') {
          this.setJobState(job, { busy: false, tone: 'info', message: 'Already applied previously - skipped.' });
          return;
        }
        const message = res.submitted
          ? 'Applied and submitted.'
          : (res.note ?? 'Prefilled - finish it yourself in the browser window that opened.');
        this.setJobState(job, { busy: false, tone: 'success', message });
        job.alreadyApplied = true;
        job.tailored = true;
        // re-emit so computed stats pick up the mutation
        this.result.update((r) => ({ ...r, jobs: [...r.jobs] }));
      },
      error: (err) => {
        this.setJobState(job, { busy: false, tone: 'error', message: `Failed: ${err.error?.error ?? err.message}` });
      }
    });
  }

  tailor(job: AggregatedJob): void {
    this.setJobState(job, { busy: true, tone: 'info', message: 'Tailoring your resume for this job…' });
    this.api.tailorJob(job.id).subscribe({
      next: () => {
        job.tailored = true;
        this.setJobState(job, { busy: false, tone: 'success', message: 'Tailored resume ready.' });
        this.previewJob.set(job);
      },
      error: (err) => {
        this.setJobState(job, { busy: false, tone: 'error', message: `Tailoring failed: ${err.error?.error ?? err.message}` });
      }
    });
  }

  /** Tailor-only mode: tailors if needed, then downloads the PDF for the user to apply with themselves. */
  tailorAndDownload(job: AggregatedJob): void {
    if (job.tailored) {
      this.download(job);
      return;
    }
    this.setJobState(job, { busy: true, tone: 'info', message: 'Tailoring your resume for this job…' });
    this.api.tailorJob(job.id).subscribe({
      next: () => {
        job.tailored = true;
        this.download(job);
      },
      error: (err) => {
        this.setJobState(job, { busy: false, tone: 'error', message: `Tailoring failed: ${err.error?.error ?? err.message}` });
      }
    });
  }

  /** Tailors the resume for a pasted job link and downloads it - the user applies on that site themselves. */
  tailorFromLink(): void {
    const url = this.link.url().trim();
    if (!url) return;
    this.linkResult.set(null);
    this.linkState.set({ busy: true, tone: 'info', message: 'Reading the job posting and tailoring your resume… this can take a minute.' });
    this.api
      .tailorFromLink({
        url,
        title: this.link.title().trim() || undefined,
        company: this.link.company().trim() || undefined,
        description: this.link.description().trim() || undefined,
        responsibilities: this.link.responsibilities().trim() || undefined,
        skills: this.link.skills().trim() || undefined
      })
      .subscribe({
        next: (res) => {
          this.linkResult.set(res);
          this.downloadPdf(res.jobId, res.company, res.title);
          this.linkState.set({ busy: false, tone: 'success', message: 'Resume downloaded — open the job posting and apply with it.' });
          // A search result for the same posting now has this resume too.
          const match = this.result().jobs.find((j) => j.id === res.jobId);
          if (match) {
            match.tailored = true;
            this.result.update((r) => ({ ...r, jobs: [...r.jobs] }));
          }
        },
        error: (err) => {
          if (err.error?.needsDescription) this.posting.set({ status: 'error' });
          this.linkState.set({ busy: false, tone: 'error', message: err.error?.error ?? err.message });
        }
      });
  }

  downloadLinkResult(): void {
    const res = this.linkResult();
    if (res) this.downloadPdf(res.jobId, res.company, res.title);
  }

  /** Clears the link panel for the next posting. */
  resetLink(): void {
    this.cancelPostingRead();
    this.posting.set({ status: 'idle' });
    for (const field of Object.values(this.link)) field.set('');
    this.linkResult.set(null);
    this.linkState.set({ busy: false });
  }

  onLinkInput(field: keyof DashboardComponent['link'], event: Event): void {
    this.link[field].set((event.target as HTMLInputElement | HTMLTextAreaElement).value);
    if (field === 'url') this.schedulePostingRead();
  }

  /** Reads the posting shortly after the link stops changing, so typing doesn't fire a read per key. */
  private schedulePostingRead(): void {
    this.cancelPostingRead();
    this.linkResult.set(null);
    this.linkState.set({ busy: false });
    const url = this.link.url().trim();
    if (!/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(url)) {
      this.posting.set({ status: 'idle' });
      return;
    }
    this.posting.set({ status: 'loading' });
    this.postingTimer = setTimeout(() => {
      this.postingRequest = this.api.getJobPosting(url).subscribe({
        next: (p) => {
          this.link.title.set(p.title);
          this.link.company.set(p.company);
          this.link.description.set(p.description);
          this.link.responsibilities.set(p.responsibilities.join('\n'));
          this.link.skills.set(p.skills.join('\n'));
          this.posting.set(p.warning ? { status: 'error', message: p.warning } : { status: 'ready' });
        },
        error: (err) =>
          this.posting.set({
            status: 'error',
            message:
              err.error?.error ??
              (err.status === 0
                ? "Can't reach the server on localhost:4000 - is ./start.sh running?"
                : err.status === 404
                  ? 'The server is running older code - restart ./start.sh, then paste the link again.'
                  : 'Could not read that link. Paste the job description below instead.')
          })
      });
    }, 600);
  }

  /** Fills the two section boxes from whatever is in the description box (e.g. pasted by hand). */
  extractSections(): void {
    const description = this.link.description().trim();
    if (!description) return;
    this.sectionsBusy.set(true);
    this.api.extractJobSections(description).subscribe({
      next: (s) => {
        this.link.responsibilities.set(s.responsibilities.join('\n'));
        this.link.skills.set(s.skills.join('\n'));
        this.sectionsBusy.set(false);
      },
      error: (err) => {
        this.sectionsBusy.set(false);
        this.linkState.set({ busy: false, tone: 'error', message: err.error?.error ?? 'Could not read the sections.' });
      }
    });
  }

  private cancelPostingRead(): void {
    clearTimeout(this.postingTimer);
    this.postingRequest?.unsubscribe();
  }

  ngOnDestroy(): void {
    this.cancelPostingRead();
  }

  private downloadPdf(jobId: string, company: string, title: string): void {
    // The server sends it as an attachment, so this downloads rather than navigates.
    const link = document.createElement('a');
    link.href = this.api.tailoredPdfDownloadUrl(jobId, this.api.tailoredPdfFileName(company, title));
    link.click();
  }

  private download(job: AggregatedJob): void {
    this.downloadPdf(job.id, job.company, job.title);
    this.setJobState(job, {
      busy: false,
      tone: 'success',
      message: 'Resume downloaded — open the job posting and apply with it.'
    });
  }

  platformLabel(job: AggregatedJob): string {
    return platformLabel(job.platform);
  }

  relevanceTone(score: number): string {
    if (score >= 75) return 'high';
    if (score >= 50) return 'mid';
    return 'low';
  }

  applyLabel(job: AggregatedJob): string {
    if (job.alreadyApplied) return 'Already applied';
    return job.autoSubmitEligible ? 'Tailor & Apply' : 'Tailor & Prefill';
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  onSort(event: Event): void {
    this.sort.set((event.target as HTMLSelectElement).value as JobSort);
  }

  clearFilters(): void {
    this.query.set('');
    this.filter.set('all');
  }
}

function readSavedView(): DashboardView {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === 'link' || saved === 'best' || saved === 'jobs') return saved;
  } catch {
    // Storage unavailable - fall back to the default.
  }
  return 'link';
}
