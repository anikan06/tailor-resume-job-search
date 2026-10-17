import { Component, input } from '@angular/core';
import { Profile } from '../../../core/models';

@Component({
  selector: 'app-apply-section',
  standalone: true,
  styleUrl: './section.scss',
  template: `
    <label class="switch">
      <input type="checkbox" [checked]="apply.tailor_only" (change)="apply.tailor_only = $any($event.target).checked" />
      <span>
        Tailor my resume only &mdash; I'll apply manually
        <small>
          The dashboard's apply button tailors your resume for the job and downloads the PDF. No browser window is
          opened and no form is filled or submitted, so you can apply on any website yourself.
        </small>
      </span>
    </label>
  `
})
export class ApplySectionComponent {
  profile = input.required<Profile>();

  get apply() {
    return (this.profile().apply ??= { tailor_only: false });
  }
}
