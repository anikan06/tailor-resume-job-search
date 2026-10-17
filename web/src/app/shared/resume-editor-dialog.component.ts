import { AfterViewInit, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { ApiService } from '../core/api.service';
import { ProfileResumeResult, ResumeContent } from '../core/models';
import { IconComponent } from './icon.component';

/** Bullets and list lines are edited as one-per-line text. */
interface DraftEntry {
  title: string;
  organization: string;
  location: string;
  dates: string;
  bullets: string;
}

interface DraftSection {
  heading: string;
  lines: string;
  entries: DraftEntry[];
}

interface Draft {
  headerTitle: string;
  headline: string;
  contactLine: string;
  summary: string;
  sections: DraftSection[];
}

const toLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.replace(/^\s*[•*-]\s*/, '').trim())
    .filter(Boolean);

function toDraft(c: ResumeContent): Draft {
  return {
    headerTitle: c.headerTitle ?? '',
    headline: c.headline ?? '',
    contactLine: c.contactLine ?? '',
    summary: c.summary ?? '',
    sections: (c.sections ?? []).map((s) => ({
      heading: s.heading,
      lines: (s.lines ?? []).join('\n'),
      entries: (s.entries ?? []).map((e) => ({
        title: e.title ?? '',
        organization: e.organization ?? '',
        location: e.location ?? '',
        dates: e.dates ?? '',
        bullets: (e.bullets ?? []).join('\n')
      }))
    }))
  };
}

function fromDraft(d: Draft): ResumeContent {
  return {
    headerTitle: d.headerTitle.trim(),
    headline: d.headline.trim(),
    contactLine: d.contactLine.trim(),
    summary: d.summary.trim(),
    sections: d.sections.map((s) => ({
      heading: s.heading.trim(),
      lines: toLines(s.lines),
      entries: s.entries.map((e) => ({
        title: e.title.trim(),
        organization: e.organization.trim(),
        location: e.location.trim(),
        dates: e.dates.trim(),
        bullets: toLines(e.bullets)
      }))
    }))
  };
}

/** Sections whose content is roles/projects/degrees rather than a list of lines. */
const ENTRY_HEADINGS = /experience|employment|work|project|education|volunteer/i;

/**
 * The Profile page's ATS resume: a preview of the PDF plus an editor for every part of it
 * (experience, bullets, summary, skills...). Saving re-renders the PDF and Word copies.
 */
@Component({
  selector: 'app-resume-editor-dialog',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <dialog #dialog class="dialog" aria-labelledby="editor-dialog-title" (close)="closed.emit()" (cancel)="onCancel($event)">
      <header class="dialog__head">
        <span class="dialog__icon"><app-icon name="file" [size]="18" /></span>
        <div class="dialog__title">
          <strong id="editor-dialog-title">ATS-friendly resume</strong>
          <span>{{ current().name }}@if (current().headline) { &middot; {{ current().headline }}}</span>
        </div>
        <div class="segmented" role="tablist" aria-label="Resume view">
          <button type="button" role="tab" [class.active]="mode() === 'preview'" [attr.aria-selected]="mode() === 'preview'" (click)="showPreview()">
            <app-icon name="file" [size]="14" /> Preview
          </button>
          <button type="button" role="tab" [class.active]="mode() === 'edit'" [attr.aria-selected]="mode() === 'edit'" (click)="mode.set('edit')">
            <app-icon name="edit" [size]="14" /> Edit
          </button>
        </div>
        <button type="button" class="btn btn--ghost btn--icon" (click)="requestClose()" aria-label="Close">
          <app-icon name="x" [size]="18" />
        </button>
      </header>

      @if (mode() === 'preview') {
        <iframe class="dialog__pdf" [src]="previewUrl()" title="ATS-friendly resume preview"></iframe>
        <footer class="dialog__foot">
          <span class="dialog__note">{{ dirty() ? 'You have unsaved edits - open Edit to save them.' : 'Want to change something? Open Edit.' }}</span>
          <a class="btn btn--sm" [href]="docxUrl()" download><app-icon name="download" [size]="15" /> Word</a>
          <a class="btn btn--sm btn--primary" [href]="pdfUrl()" download><app-icon name="download" [size]="15" /> Download PDF</a>
        </footer>
      } @else {
        <form class="editor" (ngSubmit)="save()" id="resume-editor">
          <fieldset class="editor__group">
            <legend>Header</legend>
            <div class="editor__grid">
              <div class="field">
                <label for="ed-name">Full name</label>
                <input id="ed-name" name="headerTitle" required [(ngModel)]="draft.headerTitle" (ngModelChange)="touch()" />
              </div>
              <div class="field">
                <label for="ed-headline">Headline</label>
                <input id="ed-headline" name="headline" placeholder="e.g. Senior Frontend Engineer" [(ngModel)]="draft.headline" (ngModelChange)="touch()" />
              </div>
              <div class="field editor__full">
                <label for="ed-contact">Contact line</label>
                <input id="ed-contact" name="contactLine" placeholder="email | phone | city | linkedin.com/in/you" [(ngModel)]="draft.contactLine" (ngModelChange)="touch()" />
              </div>
              <div class="field editor__full">
                <label for="ed-summary">Professional summary</label>
                <textarea id="ed-summary" name="summary" rows="4" [(ngModel)]="draft.summary" (ngModelChange)="touch()"></textarea>
              </div>
            </div>
          </fieldset>

          @for (section of draft.sections; track $index; let si = $index) {
            <fieldset class="editor__group">
              <legend class="sr-only">{{ section.heading || 'Section' }}</legend>
              <div class="editor__section-head">
                <input
                  class="editor__heading"
                  [name]="'heading' + si"
                  [attr.aria-label]="'Section heading ' + (si + 1)"
                  [(ngModel)]="section.heading"
                  (ngModelChange)="touch()"
                />
                <button type="button" class="btn btn--ghost btn--icon btn--sm" (click)="moveSection(si, -1)" [disabled]="si === 0" [attr.aria-label]="'Move ' + section.heading + ' up'">
                  <app-icon name="chevron" [size]="15" class="flip" />
                </button>
                <button type="button" class="btn btn--ghost btn--icon btn--sm" (click)="moveSection(si, 1)" [disabled]="si === draft.sections.length - 1" [attr.aria-label]="'Move ' + section.heading + ' down'">
                  <app-icon name="chevron" [size]="15" />
                </button>
                <button type="button" class="btn btn--ghost btn--icon btn--sm btn--danger" (click)="removeSection(si)" [attr.aria-label]="'Remove section ' + section.heading">
                  <app-icon name="trash" [size]="15" />
                </button>
              </div>

              @if (section.lines || !section.entries.length) {
                <div class="field">
                  <label [for]="'lines' + si">Lines <span class="editor__hint">(one per line, e.g. "Frameworks: Angular, React")</span></label>
                  <textarea [id]="'lines' + si" [name]="'lines' + si" rows="4" [(ngModel)]="section.lines" (ngModelChange)="touch()"></textarea>
                </div>
              }

              @for (entry of section.entries; track $index; let ei = $index) {
                <div class="editor__entry">
                  <div class="editor__entry-head">
                    <strong>{{ entry.title || 'New entry' }}@if (entry.organization) { &middot; {{ entry.organization }}}</strong>
                    <button type="button" class="btn btn--ghost btn--icon btn--sm" (click)="moveEntry(si, ei, -1)" [disabled]="ei === 0" [attr.aria-label]="'Move ' + (entry.title || 'entry') + ' up'">
                      <app-icon name="chevron" [size]="15" class="flip" />
                    </button>
                    <button type="button" class="btn btn--ghost btn--icon btn--sm" (click)="moveEntry(si, ei, 1)" [disabled]="ei === section.entries.length - 1" [attr.aria-label]="'Move ' + (entry.title || 'entry') + ' down'">
                      <app-icon name="chevron" [size]="15" />
                    </button>
                    <button type="button" class="btn btn--ghost btn--icon btn--sm btn--danger" (click)="removeEntry(si, ei)" [attr.aria-label]="'Remove ' + (entry.title || 'entry')">
                      <app-icon name="trash" [size]="15" />
                    </button>
                  </div>
                  <div class="editor__grid">
                    <div class="field">
                      <label [for]="'t' + si + '-' + ei">{{ isEducation(section.heading) ? 'Degree' : 'Title' }}</label>
                      <input [id]="'t' + si + '-' + ei" [name]="'t' + si + '-' + ei" [(ngModel)]="entry.title" (ngModelChange)="touch()" />
                    </div>
                    <div class="field">
                      <label [for]="'o' + si + '-' + ei">{{ isEducation(section.heading) ? 'Institution' : 'Company / organization' }}</label>
                      <input [id]="'o' + si + '-' + ei" [name]="'o' + si + '-' + ei" [(ngModel)]="entry.organization" (ngModelChange)="touch()" />
                    </div>
                    <div class="field">
                      <label [for]="'l' + si + '-' + ei">Location</label>
                      <input [id]="'l' + si + '-' + ei" [name]="'l' + si + '-' + ei" [(ngModel)]="entry.location" (ngModelChange)="touch()" />
                    </div>
                    <div class="field">
                      <label [for]="'d' + si + '-' + ei">Dates</label>
                      <input [id]="'d' + si + '-' + ei" [name]="'d' + si + '-' + ei" placeholder="Jan 2020 - Present" [(ngModel)]="entry.dates" (ngModelChange)="touch()" />
                    </div>
                    <div class="field editor__full">
                      <label [for]="'b' + si + '-' + ei">Bullets <span class="editor__hint">(one per line - start with an action verb, add numbers where you have them)</span></label>
                      <textarea [id]="'b' + si + '-' + ei" [name]="'b' + si + '-' + ei" rows="5" [(ngModel)]="entry.bullets" (ngModelChange)="touch()"></textarea>
                    </div>
                  </div>
                </div>
              }

              @if (section.entries.length || isEntrySection(section.heading)) {
                <button type="button" class="btn btn--sm editor__add" (click)="addEntry(si)">
                  <app-icon name="plus" [size]="15" /> Add {{ isEducation(section.heading) ? 'education' : 'entry' }}
                </button>
              }
            </fieldset>
          }

          <div class="editor__add-section">
            <button type="button" class="btn btn--sm" (click)="addSection('entries')"><app-icon name="plus" [size]="15" /> Add experience-style section</button>
            <button type="button" class="btn btn--sm" (click)="addSection('lines')"><app-icon name="plus" [size]="15" /> Add list section</button>
          </div>
        </form>
        <footer class="dialog__foot">
          @if (error()) {
            <span class="dialog__note dialog__note--error" role="alert"><app-icon name="alert" [size]="15" /> {{ error() }}</span>
          } @else {
            <span class="dialog__note">Saving rebuilds the PDF and Word files from your edits. No AI is used.</span>
          }
          <button type="button" class="btn btn--sm btn--ghost" (click)="discard()" [disabled]="saving() || !dirty()">Discard changes</button>
          <button type="submit" form="resume-editor" class="btn btn--sm btn--primary" [disabled]="saving() || !draft.headerTitle.trim()">
            @if (saving()) {
              <span class="spinner"></span> Saving&hellip;
            } @else {
              <app-icon name="check" [size]="15" /> Save &amp; preview
            }
          </button>
        </footer>
      }
    </dialog>
  `,
  styles: `
    .dialog {
      width: min(960px, calc(100vw - 2rem));
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

    .dialog__head,
    .dialog__foot {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.7rem 0.9rem 0.7rem 1.1rem;
      flex-wrap: wrap;
    }

    .dialog__head {
      border-bottom: 1px solid var(--border);
    }

    .dialog__foot {
      border-top: 1px solid var(--border);
      justify-content: flex-end;
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
      min-width: 140px;
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

    .dialog__note {
      flex: 1;
      min-width: 180px;
      font-size: 0.82rem;
      color: var(--text-3);
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }

    .dialog__note--error {
      color: var(--danger);
    }

    .editor {
      flex: 1;
      overflow-y: auto;
      padding: 1rem 1.1rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      background: var(--surface-2);
    }

    .editor__group {
      margin: 0;
      padding: 0.9rem 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface);
      min-width: 0;

      legend:not(.sr-only) {
        font-weight: 600;
        padding: 0 0.3rem;
      }
    }

    .editor__grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0 0.75rem;

      .field {
        margin-bottom: 0.7rem;
      }
    }

    .editor__full {
      grid-column: 1 / -1;
    }

    .editor textarea {
      resize: vertical;
    }

    .editor__hint {
      font-weight: 400;
      color: var(--text-3);
      font-size: 0.8rem;
    }

    .editor__section-head,
    .editor__entry-head {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      margin-bottom: 0.7rem;
    }

    .editor__heading {
      flex: 1;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: 0.85rem;
    }

    .editor__entry {
      padding: 0.75rem 0.8rem 0.1rem;
      margin-bottom: 0.7rem;
      border: 1px dashed var(--border-strong);
      border-radius: var(--radius-sm);
    }

    .editor__entry-head strong {
      flex: 1;
      font-size: 0.9rem;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .editor__add-section {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .flip {
      display: inline-flex;
      transform: rotate(180deg);
    }
  `
})
export class ResumeEditorDialogComponent implements AfterViewInit {
  result = input.required<ProfileResumeResult>();
  /** Start on the Edit tab instead of the preview. */
  startInEdit = input(false);
  closed = output<void>();

  private dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** The latest saved version (the input's, until the first save). */
  private saved = signal<ProfileResumeResult | null>(null);
  current = computed(() => this.saved() ?? this.result());
  private version = signal(Date.now());

  mode = signal<'preview' | 'edit'>('preview');
  draft: Draft = { headerTitle: '', headline: '', contactLine: '', summary: '', sections: [] };
  dirty = signal(false);
  saving = signal(false);
  error = signal('');

  // Our own API origin, so it's safe to trust as a frame source.
  previewUrl = computed(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(`${this.api.tailoredPdfUrl(this.current().jobId)}?v=${this.version()}`)
  );
  private fileName = computed(() => `Resume - ${this.current().name}`);
  pdfUrl = computed(() => this.api.tailoredPdfDownloadUrl(this.current().jobId, this.fileName()));
  docxUrl = computed(() => this.api.tailoredDocxDownloadUrl(this.current().jobId, this.fileName()));

  constructor(
    private api: ApiService,
    private sanitizer: DomSanitizer
  ) {}

  ngAfterViewInit(): void {
    this.draft = toDraft(this.result().content);
    if (this.startInEdit()) this.mode.set('edit');
    this.dialog().nativeElement.showModal();
  }

  touch(): void {
    this.dirty.set(true);
    this.error.set('');
  }

  isEducation(heading: string): boolean {
    return /education|academic/i.test(heading);
  }

  isEntrySection(heading: string): boolean {
    return ENTRY_HEADINGS.test(heading);
  }

  showPreview(): void {
    this.mode.set('preview');
  }

  addEntry(si: number): void {
    this.draft.sections[si].entries.push({ title: '', organization: '', location: '', dates: '', bullets: '' });
    this.touch();
  }

  removeEntry(si: number, ei: number): void {
    this.draft.sections[si].entries.splice(ei, 1);
    this.touch();
  }

  moveEntry(si: number, ei: number, delta: -1 | 1): void {
    const list = this.draft.sections[si].entries;
    [list[ei], list[ei + delta]] = [list[ei + delta], list[ei]];
    this.touch();
  }

  addSection(kind: 'entries' | 'lines'): void {
    this.draft.sections.push(
      kind === 'entries'
        ? { heading: 'Projects', lines: '', entries: [{ title: '', organization: '', location: '', dates: '', bullets: '' }] }
        : { heading: 'Certifications', lines: '', entries: [] }
    );
    this.touch();
  }

  removeSection(si: number): void {
    this.draft.sections.splice(si, 1);
    this.touch();
  }

  moveSection(si: number, delta: -1 | 1): void {
    const list = this.draft.sections;
    [list[si], list[si + delta]] = [list[si + delta], list[si]];
    this.touch();
  }

  discard(): void {
    this.draft = toDraft(this.current().content);
    this.dirty.set(false);
    this.error.set('');
  }

  save(): void {
    if (!this.draft.headerTitle.trim()) return;
    this.saving.set(true);
    this.error.set('');
    this.api.saveAtsResume(fromDraft(this.draft)).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.saved.set(res);
        this.draft = toDraft(res.content);
        this.dirty.set(false);
        this.version.set(Date.now());
        this.mode.set('preview');
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err.error?.error ?? (err.status === 404 ? 'The server is running older code - restart ./start.sh.' : err.message));
      }
    });
  }

  /** Closing (button or Esc) with unsaved edits asks before throwing them away. */
  requestClose(): void {
    if (this.confirmDiscard()) this.dialog().nativeElement.close();
  }

  onCancel(event: Event): void {
    if (!this.confirmDiscard()) event.preventDefault();
  }

  private confirmDiscard(): boolean {
    return !this.dirty() || confirm('Discard your unsaved edits?');
  }
}
