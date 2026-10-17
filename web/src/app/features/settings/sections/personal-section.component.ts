import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Profile } from '../../../core/models';
import { IconComponent } from '../../../shared/icon.component';

export type ImportSource = 'linkedin' | 'github';

type PersonalKey = keyof Profile['personal'];

@Component({
  selector: 'app-personal-section',
  standalone: true,
  imports: [FormsModule, IconComponent],
  styleUrl: './section.scss',
  template: `
    <div class="grid">
      @for (f of fields; track f.key) {
        <div class="field" [class.field--prefilled]="prefilled().has(f.key)">
          <label [for]="f.key" class="label-row">
            {{ f.label }}
            @if (prefilled().has(f.key)) {
              <span class="badge badge--accent badge--tiny">From {{ prefillSource() }}</span>
            }
          </label>
          <div class="input-row">
            <input
              [id]="f.key"
              [name]="f.key"
              [type]="f.type ?? 'text'"
              [attr.min]="f.type === 'number' ? 0 : null"
              [placeholder]="f.placeholder ?? ''"
              [(ngModel)]="$any(profile().personal)[f.key]"
            />
            @if (f.importFrom; as source) {
              <button
                type="button"
                class="btn btn--sm"
                (click)="fetchProfile.emit(source)"
                [disabled]="importing() !== null || (source === 'github' && !profile().personal.github_url)"
                [title]="source === 'linkedin' ? 'Fill details from your LinkedIn profile (uses your logged-in Chrome; leave blank for your own profile)' : 'Fill details from your public GitHub profile'"
              >
                @if (importing() === source) {
                  <span class="spinner"></span>
                } @else {
                  <app-icon name="download" [size]="14" />
                }
                Fetch
              </button>
            }
          </div>
        </div>
      }
    </div>
  `
})
export class PersonalSectionComponent {
  profile = input.required<Profile>();
  /** Fields just filled in from the uploaded CV, highlighted until saved. */
  prefilled = input<ReadonlySet<string>>(new Set());
  /** Where the highlighted fields came from ("CV", "LinkedIn", "GitHub"). */
  prefillSource = input('CV');
  /** The import currently running, if any. */
  importing = input<ImportSource | null>(null);
  fetchProfile = output<ImportSource>();

  readonly fields: { key: PersonalKey; label: string; type?: string; placeholder?: string; importFrom?: ImportSource }[] = [
    { key: 'full_name', label: 'Full name', placeholder: 'Jane Doe' },
    { key: 'email', label: 'Email', type: 'email', placeholder: 'jane@example.com' },
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'location', label: 'Location', placeholder: 'Bangalore, India' },
    { key: 'linkedin_url', label: 'LinkedIn URL', placeholder: 'https://linkedin.com/in/…', importFrom: 'linkedin' },
    { key: 'github_url', label: 'GitHub URL', placeholder: 'https://github.com/…', importFrom: 'github' },
    { key: 'portfolio_url', label: 'Portfolio / website', placeholder: 'https://…' },
    { key: 'work_authorization', label: 'Work authorization' },
    { key: 'years_experience', label: 'Years of experience', type: 'number' },
    { key: 'notice_period_days', label: 'Notice period (days)', type: 'number' }
  ];
}
