import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AggregatedJob, AggregationResult } from '../../core/models';
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

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent, ResumePreviewDialogComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  result = signal<AggregationResult>({ jobs: [], errors: [], aggregatedAt: null });
  loading = signal(false);
  initialLoad = signal(true);
  jobState = new Map<string, JobUiState>();
  /** Job whose tailored resume is open in the preview dialog. */
  previewJob = signal<AggregatedJob | null>(null);

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

  constructor(private api: ApiService) {}

  ngOnInit(): void {
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

  stateFor(job: AggregatedJob): JobUiState {
    return this.jobState.get(job.id) ?? { busy: false };
  }

  apply(job: AggregatedJob): void {
    this.jobState.set(job.id, { busy: true, tone: 'info', message: 'Tailoring resume and applying…' });
    this.api.applyToJob(job.id).subscribe({
      next: (res) => {
        if (res.status === 'skipped_duplicate') {
          this.jobState.set(job.id, { busy: false, tone: 'info', message: 'Already applied previously - skipped.' });
          return;
        }
        const message = res.submitted
          ? 'Applied and submitted.'
          : (res.note ?? 'Prefilled - finish it yourself in the browser window that opened.');
        this.jobState.set(job.id, { busy: false, tone: 'success', message });
        job.alreadyApplied = true;
        job.tailored = true;
        // re-emit so computed stats pick up the mutation
        this.result.update((r) => ({ ...r, jobs: [...r.jobs] }));
      },
      error: (err) => {
        this.jobState.set(job.id, { busy: false, tone: 'error', message: `Failed: ${err.error?.error ?? err.message}` });
      }
    });
  }

  tailor(job: AggregatedJob): void {
    this.jobState.set(job.id, { busy: true, tone: 'info', message: 'Tailoring your resume for this job…' });
    this.api.tailorJob(job.id).subscribe({
      next: () => {
        job.tailored = true;
        this.jobState.set(job.id, { busy: false, tone: 'success', message: 'Tailored resume ready.' });
        this.previewJob.set(job);
      },
      error: (err) => {
        this.jobState.set(job.id, { busy: false, tone: 'error', message: `Tailoring failed: ${err.error?.error ?? err.message}` });
      }
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
