import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CareerProfile, Profile, ResumeInfo } from '../../core/models';
import { ImportSource } from '../settings/sections/personal-section.component';
import { ChipInputComponent } from '../../shared/chip-input.component';
import { IconComponent } from '../../shared/icon.component';

type ListKey = 'experience' | 'education' | 'projects' | 'certifications' | 'languages' | 'additional_sections';
type EditKey = ListKey | 'about';

/** Fields edited as one-item-per-line textareas, stored as string arrays. */
const LINE_FIELDS: Partial<Record<ListKey, string[]>> = {
  experience: ['highlights'],
  education: ['details'],
  projects: ['highlights'],
  additional_sections: ['items']
};
/** Fields edited as comma-separated text, stored as string arrays. */
const COMMA_FIELDS: Partial<Record<ListKey, string[]>> = { projects: ['technologies'] };

/** Fields an entry needs at least one of before it can be saved. */
const REQUIRED_ANY: Record<ListKey, string[]> = {
  experience: ['title', 'company'],
  education: ['institution', 'degree'],
  projects: ['name'],
  certifications: ['name'],
  languages: ['name'],
  additional_sections: ['heading']
};

const LABELS: Record<ListKey, string> = {
  experience: 'Experience',
  education: 'Education',
  projects: 'Project',
  certifications: 'Certification',
  languages: 'Language',
  additional_sections: 'Section'
};

/** Offered in the proficiency field; any other wording can be typed in. */
const PROFICIENCIES = ['Native', 'Fluent', 'Professional', 'Conversational', 'Basic'];

/** Common extra resume sections, offered when naming a new one. */
const SECTION_HEADINGS = ['Achievements', 'Awards', 'Publications', 'Volunteering', 'Leadership', 'Interests', 'Hobbies'];

const SOURCE_LABELS: Record<ImportSource, string> = { linkedin: 'LinkedIn', github: 'GitHub' };

/** What makes two entries "the same" when merging an import into the profile. */
const IDENTITY: Record<ListKey, (item: any) => string> = {
  experience: (e) => `${e.title ?? ''}|${e.company ?? ''}`,
  education: (e) => `${e.institution ?? ''}|${e.degree ?? ''}`,
  projects: (p) => p.name ?? '',
  certifications: (c) => c.name ?? '',
  languages: (l) => l.name ?? '',
  additional_sections: (a) => a.heading ?? ''
};

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9|]/g, '');

/**
 * Adds what an import found to the profile without touching what's there:
 * new list entries go after the existing ones, headline/summary only fill blanks.
 */
function mergeImported(current: CareerProfile, imported: CareerProfile): { career: CareerProfile; added: number } {
  const next = structuredClone(current);
  let added = 0;
  for (const field of ['headline', 'summary'] as const) {
    if (!next[field] && imported[field]) {
      next[field] = imported[field];
      added++;
    }
  }
  const skills = new Set((next.skills ?? []).map(normalize));
  const newSkills = (imported.skills ?? []).filter((s) => !skills.has(normalize(s)) && skills.add(normalize(s)));
  if (newSkills.length) {
    next.skills = [...(next.skills ?? []), ...newSkills];
    added += newSkills.length;
  }
  for (const key of Object.keys(IDENTITY) as ListKey[]) {
    const list = [...((next[key] ?? []) as object[])];
    const seen = new Set(list.map((i) => normalize(IDENTITY[key](i))));
    for (const item of (imported[key] ?? []) as object[]) {
      const id = normalize(IDENTITY[key](item));
      if (!id.replace(/\|/g, '') || seen.has(id)) continue;
      seen.add(id);
      list.push(item);
      added++;
    }
    if (list.length) (next as Record<string, unknown>)[key] = list;
  }
  return { career: next, added };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Jan 2020", "01/2020", "2020-01" or "2020" -> months since year 0, or null if unreadable. */
function monthIndex(date: string | undefined): number | null {
  if (!date) return null;
  const year = date.match(/(?:19|20)\d{2}/)?.[0];
  if (!year) return null;
  const named = MONTHS.findIndex((m) => date.toLowerCase().includes(m));
  const numeric = date.match(/^(\d{1,2})[/.-](?:19|20)\d{2}$|^(?:19|20)\d{2}[/.-](\d{1,2})$/);
  const month = named >= 0 ? named : numeric ? Number(numeric[1] ?? numeric[2]) - 1 : 0;
  return Number(year) * 12 + month;
}

/** 27 -> "2 yrs 3 mos". */
function formatMonths(total: number): string {
  const years = Math.floor(total / 12);
  const months = total % 12;
  const parts = [years && `${years} yr${years === 1 ? '' : 's'}`, months && `${months} mo${months === 1 ? '' : 's'}`];
  return parts.filter(Boolean).join(' ') || 'Less than a month';
}

function currentMonth(): number {
  const now = new Date();
  return now.getFullYear() * 12 + now.getMonth();
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, RouterLink, IconComponent, ChipInputComponent],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss'
})
export class ProfileComponent implements OnInit {
  profile = signal<Profile | null>(null);
  resume = signal<ResumeInfo>({ uploaded: false });
  loading = signal(true);
  loadError = signal<string | null>(null);

  /** The entry being edited: index null = adding a new one. */
  editing = signal<{ key: EditKey; index: number | null } | null>(null);
  /** Working copy of the entry being edited, bound to the form. */
  draft: Record<string, any> = {};
  saving = signal(false);
  fetching = signal(false);
  confirmingReplace = signal(false);
  importing = signal<ImportSource | null>(null);
  /** Source whose profile link we're asking for, because none is saved in Settings. */
  askingLinkFor = signal<ImportSource | null>(null);
  importLink = '';
  toast = signal<{ text: string; tone: 'success' | 'error'; undoable?: boolean } | null>(null);
  /** Career before the last import/delete, so it can be undone. */
  private undoSnapshot: CareerProfile | null = null;
  private toastTimer?: ReturnType<typeof setTimeout>;

  readonly proficiencies = PROFICIENCIES;
  readonly importSources = [
    { id: 'linkedin', label: 'LinkedIn', icon: 'link', title: 'Opens a small LinkedIn window - sign in if asked - and adds your experience, education, skills and more' },
    { id: 'github', label: 'GitHub', icon: 'code', title: 'Adds your top repositories as projects and their languages as skills' }
  ] as const;
  readonly sectionHeadings = SECTION_HEADINGS;

  career = computed<CareerProfile>(() => this.profile()?.career ?? {});
  personal = computed(() => this.profile()?.personal ?? {});
  isEmpty = computed(() =>
    Object.values(this.career()).every((v) => (Array.isArray(v) ? v.length === 0 : !v))
  );
  initials = computed(() => {
    const name = this.personal().full_name?.trim();
    if (!name) return '?';
    const words = name.split(/\s+/);
    return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  });
  /** Sum of all roles' durations; falls back to the number entered in Settings. */
  totalExperience = computed(() => {
    const months = (this.career().experience ?? []).reduce((sum, e) => sum + (this.months(e.start_date, e.end_date, e.current) ?? 0), 0);
    if (months) return formatMonths(months);
    const years = this.personal().years_experience;
    return years ? `${years} yr${years === 1 ? '' : 's'}` : null;
  });

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    forkJoin({ profile: this.api.getProfile(), resume: this.api.getResume() }).subscribe({
      next: ({ profile, resume }) => {
        this.profile.set(profile);
        this.resume.set(resume);
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(err.error?.error ?? 'Could not reach the server - is it running on port 4000?');
        this.loading.set(false);
      }
    });
  }

  // ---- display helpers ------------------------------------------------------

  isEditing(key: EditKey, index: number | null): boolean {
    const e = this.editing();
    return !!e && e.key === key && e.index === index;
  }

  dateRange(start?: string, end?: string, current?: boolean): string {
    const to = current ? 'Present' : end;
    return [start, to].filter(Boolean).join(' – ');
  }

  duration(start?: string, end?: string, current?: boolean): string | null {
    const months = this.months(start, end, current);
    return months === null ? null : formatMonths(months);
  }

  private months(start?: string, end?: string, current?: boolean): number | null {
    const from = monthIndex(start);
    const to = current ? currentMonth() : monthIndex(end);
    // Inclusive of both months, as resumes and LinkedIn count them.
    return from === null || to === null || to < from ? null : to - from + 1;
  }

  canSaveDraft(): boolean {
    const e = this.editing();
    if (!e || e.key === 'about') return true;
    return REQUIRED_ANY[e.key].some((f) => String(this.draft[f] ?? '').trim());
  }

  // ---- editing ----------------------------------------------------------------

  startAdd(key: ListKey): void {
    this.draft = {};
    this.editing.set({ key, index: null });
  }

  startEdit(key: EditKey, index: number | null = null): void {
    if (key === 'about') {
      this.draft = { headline: this.career().headline ?? '', summary: this.career().summary ?? '' };
    } else {
      const item: Record<string, any> = { ...(this.career()[key]?.[index!] ?? {}) };
      for (const f of LINE_FIELDS[key] ?? []) item[f] = (item[f] ?? []).join('\n');
      for (const f of COMMA_FIELDS[key] ?? []) item[f] = (item[f] ?? []).join(', ');
      this.draft = item;
    }
    this.editing.set({ key, index });
  }

  cancelEdit(): void {
    this.editing.set(null);
    this.draft = {};
  }

  saveEdit(): void {
    const e = this.editing();
    if (!e || !this.canSaveDraft()) return;
    const next = structuredClone(this.career());

    if (e.key === 'about') {
      next.headline = this.draft['headline']?.trim() || undefined;
      next.summary = this.draft['summary']?.trim() || undefined;
    } else {
      const item = this.fromDraft(e.key);
      const list = [...((next[e.key] ?? []) as object[])];
      // New entries go first: resumes list the most recent of everything at the top.
      if (e.index === null) list.unshift(item);
      else list[e.index] = item;
      (next as Record<string, unknown>)[e.key] = list;
    }

    this.persist(next, e.index === null && e.key !== 'about' ? `${LABELS[e.key]} added` : 'Saved', () => this.cancelEdit());
  }

  remove(key: ListKey, index: number): void {
    const next = structuredClone(this.career());
    const list = [...((next[key] ?? []) as object[])];
    list.splice(index, 1);
    (next as Record<string, unknown>)[key] = list;
    this.undoSnapshot = structuredClone(this.career());
    this.persist(next, `${LABELS[key]} removed`, undefined, true);
  }

  move(key: ListKey, index: number, delta: -1 | 1): void {
    const list = [...((this.career()[key] ?? []) as object[])];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    this.persist({ ...this.career(), [key]: list }, 'Order updated');
  }

  saveSkills(skills: string[]): void {
    this.persist({ ...this.career(), skills }, 'Skills updated');
  }

  /** Converts the form's text fields back into the stored shape, dropping blanks. */
  private fromDraft(key: ListKey): Record<string, unknown> {
    const item: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(this.draft)) {
      if (LINE_FIELDS[key]?.includes(field)) {
        item[field] = String(value ?? '').split('\n').map((l) => l.replace(/^\s*[•*-]\s*/, '').trim()).filter(Boolean);
      } else if (COMMA_FIELDS[key]?.includes(field)) {
        item[field] = String(value ?? '').split(',').map((t) => t.trim()).filter(Boolean);
      } else if (typeof value === 'string') {
        item[field] = value.trim() || undefined;
      } else {
        item[field] = value;
      }
    }
    if (item['current']) delete item['end_date'];
    else delete item['current'];
    return Object.fromEntries(
      Object.entries(item).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))
    );
  }

  // ---- resume import ------------------------------------------------------------

  /** Replaces the profile with what the uploaded resume says; asks first if there's anything to lose. */
  fillFromResume(confirmed = false): void {
    if (!this.isEmpty() && !confirmed) {
      this.confirmingReplace.set(true);
      return;
    }
    this.confirmingReplace.set(false);
    this.cancelEdit();
    this.fetching.set(true);
    this.api.getCareerFromResume().subscribe({
      next: ({ career }) => {
        this.fetching.set(false);
        if (Object.values(career).every((v) => (Array.isArray(v) ? !v.length : !v))) {
          this.flash({ text: "Couldn't find any experience or education in your resume - add them below.", tone: 'error' });
          return;
        }
        this.undoSnapshot = structuredClone(this.career());
        this.persist(career, `Filled from ${this.resume().fileName ?? 'your resume'} - review and edit anything it got wrong`, undefined, true);
      },
      error: (err) => {
        this.fetching.set(false);
        this.flash({ text: `Couldn't read your resume: ${err.error?.error ?? err.message}`, tone: 'error' });
      }
    });
  }

  // ---- LinkedIn / GitHub import -----------------------------------------------

  /**
   * LinkedIn opens a small sign-in window and reads whoever signs in there, so it needs no link.
   * GitHub uses the link saved in Settings, asking for one first if there isn't any.
   */
  startImport(source: ImportSource): void {
    if (source === 'linkedin') {
      this.runImport(source, '');
      return;
    }
    const saved = this.personal().github_url;
    if (saved) {
      this.runImport(source, saved);
    } else {
      this.importLink = '';
      this.askingLinkFor.set(source);
    }
  }

  runImport(source: ImportSource, link: string): void {
    const label = SOURCE_LABELS[source];
    this.askingLinkFor.set(null);
    this.cancelEdit();
    this.importing.set(source);
    this.api.importProfile(source, link).subscribe({
      next: (extracted) => {
        this.importing.set(null);
        const { career, added } = mergeImported(this.career(), extracted.career ?? { skills: extracted.skills });
        // Remember the profile link for next time (and for application forms) if none was saved.
        const urlField = source === 'linkedin' ? 'linkedin_url' : 'github_url';
        const foundUrl = extracted.personal[urlField];
        const personal = !this.personal()[urlField] && foundUrl ? { ...this.personal(), [urlField]: foundUrl } : undefined;
        if (!added) {
          if (personal) this.persist(this.career(), `Nothing new found on ${label} - saved your ${label} link`, undefined, false, { personal });
          else this.flash({ text: `Nothing new found on ${label}`, tone: 'success' });
          return;
        }
        this.undoSnapshot = structuredClone(this.career());
        this.persist(career, `Added ${added} item${added === 1 ? '' : 's'} from ${label} - review them below`, undefined, true, personal && { personal });
      },
      error: (err) => {
        this.importing.set(null);
        this.flash({ text: `${label} import failed: ${err.error?.error ?? err.message}`, tone: 'error' });
      }
    });
  }

  undo(): void {
    if (!this.undoSnapshot) return;
    const snapshot = this.undoSnapshot;
    this.undoSnapshot = null;
    this.persist(snapshot, 'Undone');
  }

  // ---- persistence ------------------------------------------------------------

  private persist(career: CareerProfile, message: string, onSaved?: () => void, undoable = false, extra: Partial<Profile> = {}): void {
    this.saving.set(true);
    this.api.saveProfile({ ...extra, career }).subscribe({
      next: (p) => {
        this.profile.set(p);
        this.saving.set(false);
        onSaved?.();
        this.flash({ text: message, tone: 'success', undoable });
      },
      error: (err) => {
        this.saving.set(false);
        this.flash({ text: `Save failed: ${err.error?.error ?? err.message}`, tone: 'error' });
      }
    });
  }

  private flash(message: { text: string; tone: 'success' | 'error'; undoable?: boolean }): void {
    clearTimeout(this.toastTimer);
    this.toast.set(message);
    if (!message.undoable) this.undoSnapshot = null;
    if (message.tone === 'success') {
      this.toastTimer = setTimeout(() => {
        this.toast.set(null);
        this.undoSnapshot = null;
      }, message.undoable ? 8000 : 2500);
    }
  }
}
