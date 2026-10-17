import { Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Profile } from '../../../core/models';
import { IconComponent } from '../../../shared/icon.component';

@Component({
  selector: 'app-answers-section',
  standalone: true,
  imports: [FormsModule, IconComponent],
  styleUrl: './section.scss',
  template: `
    @if (answers.length) {
      <div class="qa-head">
        <span>If the question contains&hellip;</span>
        <span>Answer with&hellip;</span>
      </div>
    }
    @for (qa of answers; track $index) {
      <div class="qa-row">
        <input [(ngModel)]="qa.question_contains" [name]="'q' + $index" placeholder="e.g. sponsorship" />
        <input [(ngModel)]="qa.answer" [name]="'a' + $index" placeholder="e.g. No" />
        <button class="btn btn--ghost btn--icon btn--danger" (click)="remove($index)" title="Remove">
          <app-icon name="trash" [size]="16" />
        </button>
      </div>
    }
    <button class="btn btn--sm" (click)="add()"><app-icon name="plus" [size]="15" /> Add answer</button>
  `
})
export class AnswersSectionComponent {
  profile = input.required<Profile>();

  get answers() {
    return this.profile().custom_question_answers ?? [];
  }

  add(): void {
    this.profile().custom_question_answers = [...this.answers, { question_contains: '', answer: '' }];
  }

  remove(index: number): void {
    this.profile().custom_question_answers = this.answers.filter((_, i) => i !== index);
  }
}
