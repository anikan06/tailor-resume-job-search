import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ApplicationRecord } from '../../core/models';
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
