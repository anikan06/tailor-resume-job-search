import { Component, input } from '@angular/core';
import { Profile } from '../../../core/models';
import { ChipInputComponent } from '../../../shared/chip-input.component';

@Component({
  selector: 'app-boards-section',
  standalone: true,
  imports: [ChipInputComponent],
  styleUrl: './section.scss',
  template: `
    <div class="grid">
      <div class="field">
        <label for="gh">Greenhouse boards</label>
        <app-chip-input
          inputId="gh"
          placeholder="stripe, figma"
          [values]="profile().boards!.greenhouse ?? []"
          (valuesChange)="profile().boards!.greenhouse = $event"
        />
      </div>
      <div class="field">
        <label for="lever">Lever boards</label>
        <app-chip-input
          inputId="lever"
          placeholder="netflix"
          [values]="profile().boards!.lever ?? []"
          (valuesChange)="profile().boards!.lever = $event"
        />
      </div>
    </div>
  `
})
export class BoardsSectionComponent {
  profile = input.required<Profile>();
}
