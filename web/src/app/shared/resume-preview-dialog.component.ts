import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, computed, input, output, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ApiService } from '../core/api.service';
import { IconComponent } from './icon.component';

/** Modal showing a job's tailored resume PDF inline, with a download button. */
@Component({
  selector: 'app-resume-preview-dialog',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="dialog" (close)="closed.emit()" (click)="onBackdropClick($event)">
      <header class="dialog__head">
        <span class="dialog__icon"><app-icon name="file" [size]="18" /></span>
        <div class="dialog__title">
          <strong>Tailored resume</strong>
          <span>{{ title() }} &middot; {{ company() }}</span>
        </div>
        <a class="btn btn--primary btn--sm" [href]="downloadUrl()" download>
          <app-icon name="download" [size]="15" /> Download PDF
        </a>
        <button class="btn btn--ghost btn--icon" (click)="dialog.close()" aria-label="Close">
          <app-icon name="x" [size]="18" />
        </button>
      </header>
      <iframe class="dialog__pdf" [src]="previewUrl()" [title]="'Tailored resume for ' + title()"></iframe>
    </dialog>
  `,
  styles: `
    .dialog {
      width: min(900px, calc(100vw - 2rem));
      height: min(92vh, 1100px);
      padding: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--surface);
      color: var(--text);
      box-shadow: var(--shadow-lg);
      overflow: hidden;

      &[open] {
        display: flex;
        flex-direction: column;
      }

      &::backdrop {
        background: rgba(10, 12, 21, 0.55);
        backdrop-filter: blur(2px);
      }
    }

    .dialog__head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 0.9rem 0.75rem 1.1rem;
      border-bottom: 1px solid var(--border);
    }

    .dialog__icon {
      width: 34px;
      height: 34px;
      flex-shrink: 0;
      border-radius: 10px;
      display: grid;
      place-items: center;
      background: var(--accent-soft);
      color: var(--accent-text);
    }

    .dialog__title {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      font-size: 0.9rem;

      span {
        font-size: 0.8rem;
        color: var(--text-3);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .dialog__pdf {
      flex: 1;
      width: 100%;
      border: none;
      background: var(--surface-2);
    }
  `
})
export class ResumePreviewDialogComponent implements AfterViewInit {
  jobId = input.required<string>();
  title = input.required<string>();
  company = input.required<string>();
  closed = output<void>();

  private dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  // Our own API origin, so it's safe to trust as a frame source.
  previewUrl = computed(() => this.sanitizer.bypassSecurityTrustResourceUrl(this.api.tailoredPdfUrl(this.jobId())));
  downloadUrl = computed(() =>
    this.api.tailoredPdfDownloadUrl(this.jobId(), `Resume - ${this.company()} - ${this.title()}`)
  );

  constructor(
    private api: ApiService,
    private sanitizer: DomSanitizer
  ) {}

  ngAfterViewInit(): void {
    this.dialog().nativeElement.showModal();
  }

  /** Clicks on the dialog element itself (not its contents) are backdrop clicks. */
  onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.dialog().nativeElement.close();
  }
}
