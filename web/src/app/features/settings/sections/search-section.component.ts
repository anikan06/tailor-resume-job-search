import { Component, input } from '@angular/core';
import { Profile, ResumeExtraction } from '../../../core/models';
import { ChipInputComponent } from '../../../shared/chip-input.component';

@Component({
  selector: 'app-search-section',
  standalone: true,
  imports: [ChipInputComponent],
  styleUrl: './section.scss',
  template: `
    <div class="field">
      <label for="roles">Target roles</label>
      <app-chip-input
        inputId="roles"
        placeholder="Type a role and press Enter, e.g. Frontend Lead"
        [values]="profile().search.target_roles ?? []"
        (valuesChange)="profile().search.target_roles = $event"
        [suggestions]="extracted()?.suggestedRoles ?? []"
        suggestionsLabel="Suggested from your resume and profile:"
      />
      @if (!extracted()) {
        <p class="field__help">Upload your resume above to get role suggestions.</p>
      }
    </div>
    <div class="field">
      <label for="keywords">Search keywords</label>
      <app-chip-input
        inputId="keywords"
        placeholder="Angular, micro frontends"
        [values]="profile().search.keywords ?? []"
        (valuesChange)="profile().search.keywords = $event"
        [suggestions]="extracted()?.skills ?? []"
        suggestionsLabel="Skills from your resume and profile:"
      />
      <p class="field__help">Used for Greenhouse/Lever filtering and LinkedIn/Naukri/Indeed/Google Jobs search.</p>
    </div>
    <div class="field">
      <label for="locations">Locations</label>
      <app-chip-input
        inputId="locations"
        placeholder="Bangalore, Remote - India"
        [values]="profile().search.locations ?? []"
        (valuesChange)="profile().search.locations = $event"
        [suggestions]="locationSuggestions()"
      />
      <p class="field__help">The first one is used for LinkedIn/Naukri/Indeed/Google Jobs.</p>
    </div>
    <div class="field">
      <label for="exclude">Exclude companies</label>
      <app-chip-input
        inputId="exclude"
        tone="muted"
        placeholder="Acme Corp"
        [values]="profile().search.exclude_companies ?? []"
        (valuesChange)="profile().search.exclude_companies = $event"
      />
    </div>
  `
})
export class SearchSectionComponent {
  profile = input.required<Profile>();
  extracted = input<ResumeExtraction | undefined>();

  locationSuggestions(): string[] {
    const fromCv = this.extracted()?.personal.location;
    return [...(fromCv ? [fromCv] : []), 'Remote'];
  }
}
