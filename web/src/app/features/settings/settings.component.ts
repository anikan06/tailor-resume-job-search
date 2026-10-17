import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { Profile, ResumeExtraction, ResumeInfo } from '../../core/models';
import { IconComponent, IconName } from '../../shared/icon.component';
import { AiSectionComponent } from './sections/ai-section.component';
import { AnswersSectionComponent } from './sections/answers-section.component';
import { BoardsSectionComponent } from './sections/boards-section.component';
import { ImportSource, PersonalSectionComponent } from './sections/personal-section.component';
import { ScheduleSectionComponent } from './sections/schedule-section.component';
import { SearchSectionComponent } from './sections/search-section.component';

/** Fills in every nested object/list the section components edit in place. */
function normalizeProfile(p: Partial<Profile> = {}): Profile {
  return {
    ...p,
    personal: { ...p.personal },
    search: {
      ...p.search,
      target_roles: p.search?.target_roles ?? [],
      keywords: p.search?.keywords ?? [],
      locations: p.search?.locations ?? [],
      exclude_companies: p.search?.exclude_companies ?? []
    },
    custom_question_answers: p.custom_question_answers ?? [],
    boards: { greenhouse: p.boards?.greenhouse ?? [], lever: p.boards?.lever ?? [] },
    ai: { ...p.ai },
    schedule: { enabled: false, cron: '0 7 * * *', ...p.schedule }
  };
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
    // Only referenced inside @defer blocks, so each is split into its own lazily-loaded chunk.
    PersonalSectionComponent,
    SearchSectionComponent,
    BoardsSectionComponent,
    AiSectionComponent,
    AnswersSectionComponent,
    ScheduleSectionComponent
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit, AfterViewInit, OnDestroy {
  profile = signal<Profile>(normalizeProfile());
  resume = signal<ResumeInfo>({ uploaded: false });
  saving = signal(false);
  saveMessage = signal<{ text: string; tone: 'success' | 'error' } | null>(null);
  uploading = signal(false);
  confirmingDelete = signal(false);
  deleting = signal(false);
  dragging = signal(false);
  activeSection = signal('resume');
  /** Personal fields just filled in from the uploaded CV (highlighted until saved). */
  prefilled = signal<ReadonlySet<string>>(new Set());
  /** Where the highlighted fields came from, for the badges and banner. */
  prefillSource = signal('CV');
  importing = signal<ImportSource | null>(null);
  /** Snapshot taken before the last CV prefill, so it can be undone. */
  private beforePrefill: Profile | null = null;
  apiKeyInput = '';

  sections: { id: string; label: string; icon: IconName }[] = [
    { id: 'resume', label: 'Resume', icon: 'file' },
    { id: 'personal', label: 'Personal details', icon: 'user' },
    { id: 'search', label: 'Job preferences', icon: 'target' },
    { id: 'boards', label: 'Career pages', icon: 'building' },
    { id: 'ai', label: 'AI tailoring', icon: 'sparkles' },
    { id: 'answers', label: 'Question answers', icon: 'message' },
    { id: 'schedule', label: 'Schedule', icon: 'calendar' }
  ];

  private observer?: IntersectionObserver;

  /** For skeleton placeholders: an array of n items to loop over. */
  readonly rowsOf = (n: number) => Array.from({ length: n });

  constructor(
    private api: ApiService,
    private host: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    this.api.getProfile().subscribe((p) => this.profile.set(normalizeProfile(p)));
    this.api.getResume().subscribe((r) => this.resume.set(r));
  }

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) this.activeSection.set(visible[0].target.id);
      },
      { rootMargin: '-15% 0px -70% 0px' }
    );
    this.host.nativeElement.querySelectorAll('section[id]').forEach((el) => this.observer!.observe(el));
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  scrollTo(id: string): void {
    this.activeSection.set(id);
    this.host.nativeElement.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  onResumeSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.uploadResume(file);
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file && !this.uploading()) this.uploadResume(file);
  }

  private uploadResume(file: File): void {
    this.uploading.set(true);
    this.api.uploadResume(file).subscribe({
      next: (res) => {
        this.resume.set({ uploaded: true, ...res });
        this.uploading.set(false);
        this.prefillFrom(res.extracted, 'CV');
      },
      error: (err) => {
        this.flash({ text: `Resume upload failed: ${err.error?.error ?? err.message}`, tone: 'error' });
        this.uploading.set(false);
      }
    });
  }

  deleteResume(): void {
    this.deleting.set(true);
    this.api.deleteResume().subscribe({
      next: (r) => {
        this.resume.set(r);
        this.deleting.set(false);
        this.confirmingDelete.set(false);
        this.flash({ text: 'Resume deleted', tone: 'success' });
      },
      error: (err) => {
        this.deleting.set(false);
        this.flash({ text: `Delete failed: ${err.error?.error ?? err.message}`, tone: 'error' });
      }
    });
  }

  /** Fetches details from LinkedIn/GitHub and prefills the form with them, like a CV upload does. */
  importProfile(source: ImportSource): void {
    const label = source === 'linkedin' ? 'LinkedIn' : 'GitHub';
    const personal = this.profile().personal;
    const url = (source === 'linkedin' ? personal.linkedin_url : personal.github_url) ?? '';
    this.importing.set(source);
    this.api.importProfile(source, url).subscribe({
      next: (extracted) => {
        this.importing.set(null);
        if (!this.prefillFrom(extracted, label)) {
          this.flash({ text: `Nothing new found on ${label}`, tone: 'success' });
        }
      },
      error: (err) => {
        this.importing.set(null);
        this.flash({ text: `${label} fetch failed: ${err.error?.error ?? err.message}`, tone: 'error' });
      }
    });
  }

  /**
   * Copies everything the CV (or LinkedIn/GitHub) gave us into the form (not saved until "Save settings").
   * Personal details from the CV win over what was there; keywords and locations are
   * only seeded when empty, and target roles are left for the user to pick from suggestions.
   */
  private prefillFrom(extracted: ResumeExtraction, source: string): boolean {
    const current = this.profile();
    const next = normalizeProfile(structuredClone(current));
    const filled = new Set<string>();

    for (const [key, value] of Object.entries(extracted.personal)) {
      if (value === undefined || value === null || value === '') continue;
      const personal = next.personal as Record<string, unknown>;
      if (personal[key] !== value) {
        personal[key] = value;
        filled.add(key);
      }
    }
    if (!next.search.keywords?.length && extracted.skills.length) {
      next.search.keywords = extracted.skills.slice(0, 8);
      filled.add('keywords');
    }
    if (!next.search.locations?.length && extracted.personal.location) {
      next.search.locations = [extracted.personal.location];
      filled.add('locations');
    }

    if (!filled.size) return false;
    this.beforePrefill = structuredClone(current);
    this.profile.set(next);
    this.prefilled.set(filled);
    this.prefillSource.set(source);
    return true;
  }

  undoPrefill(): void {
    if (!this.beforePrefill) return;
    this.profile.set(this.beforePrefill);
    this.beforePrefill = null;
    this.prefilled.set(new Set());
  }

  save(): void {
    const current = this.profile();
    const provider = current.ai?.provider ?? 'anthropic';

    const patch: Partial<Profile> = {
      personal: current.personal,
      search: current.search,
      custom_question_answers: current.custom_question_answers,
      boards: current.boards,
      ai: {
        provider: provider,
        model: current.ai?.model ?? '',
        ollama_base_url: current.ai?.ollama_base_url ?? '',
        ...(this.apiKeyInput && provider !== 'ollama' ? { [`${provider}_api_key`]: this.apiKeyInput } : {})
      },
      schedule: current.schedule
    };

    this.saving.set(true);
    this.api.saveProfile(patch).subscribe({
      next: (p) => {
        this.profile.set(normalizeProfile(p));
        this.apiKeyInput = '';
        this.beforePrefill = null;
        this.prefilled.set(new Set());
        this.saving.set(false);
        this.flash({ text: 'Settings saved', tone: 'success' });
      },
      error: (err) => {
        this.saving.set(false);
        this.flash({ text: `Save failed: ${err.error?.error ?? err.message}`, tone: 'error' });
      }
    });
  }

  private flash(message: { text: string; tone: 'success' | 'error' }): void {
    this.saveMessage.set(message);
    if (message.tone === 'success') setTimeout(() => this.saveMessage.set(null), 2500);
  }
}
