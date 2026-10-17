import { Component, input } from '@angular/core';
import { Profile } from '../../../core/models';

@Component({
  selector: 'app-schedule-section',
  standalone: true,
  styleUrl: './section.scss',
  template: `
    <label class="switch">
      <input type="checkbox" [checked]="schedule.enabled" (change)="schedule.enabled = $any($event.target).checked" />
      <span>
        Run job search automatically on a schedule
        <small>Uses the cron expression below, in the server's timezone.</small>
      </span>
    </label>
    @if (schedule.enabled) {
      <div class="field cron">
        <label for="cron">Cron expression</label>
        <input
          id="cron"
          class="mono"
          [value]="schedule.cron ?? ''"
          (change)="schedule.cron = $any($event.target).value"
          placeholder="0 7 * * *"
          aria-describedby="cron-help"
        />
        <p class="field__help" id="cron-help"><code>0 7 * * *</code> runs every day at 7:00 AM.</p>
      </div>
    }
  `
})
export class ScheduleSectionComponent {
  profile = input.required<Profile>();

  get schedule() {
    return (this.profile().schedule ??= { enabled: false, cron: '0 7 * * *' });
  }
}
