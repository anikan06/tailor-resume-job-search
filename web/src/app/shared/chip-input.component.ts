import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { IconComponent } from './icon.component';

/**
 * Tag-style list editor: type and press Enter/comma to add, Backspace to remove the last,
 * or click one of the optional suggestions.
 */
@Component({
  selector: 'app-chip-input',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chip-input" (click)="field.focus()">
      @for (v of values(); track v) {
        <span class="chip" [class.chip--muted]="tone() === 'muted'">
          {{ v }}
          <button type="button" class="chip__remove" (click)="remove(v); $event.stopPropagation()" [attr.aria-label]="'Remove ' + v">
            <app-icon name="x" [size]="12" />
          </button>
        </span>
      }
      <input
        #field
        [id]="inputId()"
        [placeholder]="values().length ? 'Add more…' : placeholder()"
        (keydown)="onKeydown($event, field)"
        (input)="onInput(field)"
        (blur)="commit(field)"
        autocomplete="off"
      />
    </div>
    @if (remainingSuggestions().length) {
      <div class="suggestions">
        <span class="suggestions__label">{{ suggestionsLabel() }}</span>
        @for (s of remainingSuggestions(); track s) {
          <button type="button" class="suggestion" (click)="add(s)">
            <app-icon name="plus" [size]="12" /> {{ s }}
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .chip-input {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
      min-height: 40px;
      padding: 0.3rem 0.45rem;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface);
      cursor: text;
      transition: border-color 0.15s, box-shadow 0.15s;

      &:focus-within {
        border-color: var(--accent);
        box-shadow: var(--ring);
      }

      input {
        flex: 1;
        min-width: 140px;
        border: none;
        background: transparent;
        box-shadow: none;
        padding: 0.25rem 0.3rem;

        &:focus {
          box-shadow: none;
        }
      }
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      padding-right: 0.25rem;
    }

    .chip--muted {
      background: var(--surface-2);
      color: var(--text-2);
    }

    .chip__remove {
      display: inline-grid;
      place-items: center;
      border: none;
      background: transparent;
      color: inherit;
      padding: 2px;
      border-radius: 50%;
      opacity: 0.65;
      cursor: pointer;

      &:hover {
        opacity: 1;
        background: color-mix(in srgb, currentColor 14%, transparent);
      }
    }

    .suggestions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
      margin-top: 0.6rem;
    }

    .suggestions__label {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-3);
      margin-right: 0.15rem;
    }

    .suggestion {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.78rem;
      font-weight: 500;
      padding: 0.18rem 0.6rem;
      border-radius: 999px;
      border: 1px dashed var(--border-strong);
      background: transparent;
      color: var(--text-2);
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s, background 0.15s;

      &:hover {
        border-color: var(--accent);
        border-style: solid;
        color: var(--accent-text);
        background: var(--accent-soft);
      }
    }
  `
})
export class ChipInputComponent {
  values = model<string[]>([]);
  suggestions = input<string[]>([]);
  suggestionsLabel = input('Suggestions:');
  placeholder = input('');
  inputId = input<string | undefined>(undefined);
  tone = input<'accent' | 'muted'>('accent');

  remainingSuggestions = computed(() => {
    const taken = new Set(this.values().map((v) => v.toLowerCase()));
    return this.suggestions().filter((s) => !taken.has(s.toLowerCase()));
  });

  add(raw: string): void {
    const value = raw.trim();
    if (!value || this.values().some((v) => v.toLowerCase() === value.toLowerCase())) return;
    this.values.set([...this.values(), value]);
  }

  remove(value: string): void {
    this.values.set(this.values().filter((v) => v !== value));
  }

  commit(field: HTMLInputElement): void {
    field.value.split(',').forEach((part) => this.add(part));
    field.value = '';
  }

  onKeydown(event: KeyboardEvent, field: HTMLInputElement): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commit(field);
    } else if (event.key === 'Backspace' && !field.value && this.values().length) {
      this.values.set(this.values().slice(0, -1));
    }
  }

  /** Typing or pasting a comma commits everything before it. */
  onInput(field: HTMLInputElement): void {
    if (!field.value.includes(',')) return;
    const parts = field.value.split(',');
    field.value = parts.pop() ?? '';
    parts.forEach((part) => this.add(part));
  }
}
