import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ApplicationRecord, UsageSummary, UsageTotals } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { ResumePreviewDialogComponent } from '../../shared/resume-preview-dialog.component';
import { companyHue, companyInitial } from '../../shared/avatar';
import { platformLabel } from '../../shared/platform';

type Status = ApplicationRecord['status'];
type StatusFilter = 'all' | Status;

const STATUS_LABELS: Record<Status, string> = {
  submitted: 'Submitted',
  prefilled: 'Prefilled',
  skipped_duplicate: 'Duplicate',
  failed: 'Failed'
};

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent, ResumePreviewDialogComponent],
  templateUrl: './history.component.html',
  styleUrl: './history.component.scss'
})
export class HistoryComponent implements OnInit {
  records = signal<ApplicationRecord[]>([]);
  loaded = signal(false);
  filter = signal<StatusFilter>('all');
  query = signal('');
  /** Application whose tailored resume is open in the preview dialog. */
  previewRecord = signal<ApplicationRecord | null>(null);
  usage = signal<UsageSummary | null>(null);

  readonly companyHue = companyHue;
  readonly companyInitial = companyInitial;
  readonly platformLabel = platformLabel;

  counts = computed(() => {
    const c: Record<StatusFilter, number> = { all: 0, submitted: 0, prefilled: 0, skipped_duplicate: 0, failed: 0 };
    for (const r of this.records()) {
      c.all++;
      c[r.status]++;
    }
    return c;
  });

  /** Tokens spent on everything but tailoring: reading uploaded resumes and imported profiles. */
  otherUsage = computed<UsageTotals | null>(() => {
    const u = this.usage();
    if (!u) return null;
    const tailor = u.byActivity.tailor_resume;
    return {
      calls: u.totals.calls - (tailor?.calls ?? 0),
      failedCalls: u.totals.failedCalls - (tailor?.failedCalls ?? 0),
      inputTokens: u.totals.inputTokens - (tailor?.inputTokens ?? 0),
      outputTokens: u.totals.outputTokens - (tailor?.outputTokens ?? 0),
      totalTokens: u.totals.totalTokens - (tailor?.totalTokens ?? 0)
    };
  });

  models = computed(() =>
    Object.entries(this.usage()?.byModel ?? {})
      .map(([name, totals]) => ({ name, totals }))
      .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens)
  );

  filters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'submitted', label: 'Submitted' },
    { key: 'prefilled', label: 'Prefilled' },
    { key: 'failed', label: 'Failed' }
  ];

  visible = computed(() => {
    const f = this.filter();
    const q = this.query().trim().toLowerCase();
    return this.records().filter(
      (r) =>
        (f === 'all' || r.status === f) &&
        (!q || r.title.toLowerCase().includes(q) || r.company.toLowerCase().includes(q))
    );
  });

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.getApplications().subscribe({
      next: (r) => {
        this.records.set([...r].sort((a, b) => b.appliedAt.localeCompare(a.appliedAt)));
        this.loaded.set(true);
      },
      error: () => this.loaded.set(true)
    });
    this.api.getUsage().subscribe({ next: (u) => this.usage.set(u), error: () => this.usage.set(null) });
  }

  jobUsage(jobId: string): UsageTotals | undefined {
    return this.usage()?.byJob[jobId];
  }

  /** 1234 -> "1.2k", 2_500_000 -> "2.5M". */
  formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
  }

  tokenTitle(t: UsageTotals): string {
    const failed = t.failedCalls ? `, ${t.failedCalls} failed` : '';
    return `${t.inputTokens.toLocaleString()} in / ${t.outputTokens.toLocaleString()} out, ${t.calls} call${t.calls === 1 ? '' : 's'}${failed}`;
  }

  statusLabel(status: Status): string {
    return STATUS_LABELS[status] ?? status;
  }

  statusBadgeClass(status: Status): string {
    switch (status) {
      case 'submitted':
        return 'badge badge--green';
      case 'prefilled':
        return 'badge badge--amber';
      case 'failed':
        return 'badge badge--red';
      default:
        return 'badge';
    }
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
}
