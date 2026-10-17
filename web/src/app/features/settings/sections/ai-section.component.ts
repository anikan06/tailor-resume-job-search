import { Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AiProvider, Profile } from '../../../core/models';
import { IconComponent } from '../../../shared/icon.component';

interface ProviderOption {
  id: AiProvider;
  label: string;
  tag: string;
  defaultModel: string;
  keyPlaceholder?: string;
  help: string;
}

/** Keep defaultModel in sync with DEFAULT_MODELS in server/src/llm.ts. */
const PROVIDERS: ProviderOption[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    tag: 'Free tier',
    defaultModel: 'gemini-2.5-flash',
    keyPlaceholder: 'AIza…',
    help: 'Get a free key at aistudio.google.com/apikey. The free tier has daily limits but is plenty for job applications.'
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    tag: 'Paid API',
    defaultModel: 'gpt-4.1-mini',
    keyPlaceholder: 'sk-…',
    help: 'Create a key at platform.openai.com/api-keys. Billed per use; separate from a ChatGPT Plus subscription.'
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    tag: 'Paid API',
    defaultModel: 'claude-sonnet-4-5',
    keyPlaceholder: 'sk-ant-…',
    help: 'Create a key at console.anthropic.com. Billed per use; separate from a Claude Pro subscription.'
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    tag: 'Free, offline',
    defaultModel: 'llama3.1',
    help: 'Runs a model on this machine: install from ollama.com, then run "ollama pull llama3.1". No key, nothing leaves your computer.'
  }
];

@Component({
  selector: 'app-ai-section',
  standalone: true,
  imports: [FormsModule, IconComponent],
  styleUrl: './section.scss',
  styles: `
    .providers {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .provider {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      margin: 0;
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface);
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;

      input {
        position: absolute;
        opacity: 0;
        width: 1px;
        height: 1px;
      }
      &:has(input:focus-visible) {
        box-shadow: var(--ring);
      }
      &--active {
        border-color: var(--accent);
        background: color-mix(in srgb, var(--accent-soft) 45%, var(--surface));
      }
    }
    .provider__name {
      font-weight: 600;
      color: var(--text);
    }
    @media (max-width: 640px) {
      .providers {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `,
  template: `
    <div class="providers" role="radiogroup" aria-label="AI provider">
      @for (p of providers; track p.id) {
        <label class="provider" [class.provider--active]="provider === p.id">
          <input type="radio" name="aiProvider" [value]="p.id" [checked]="provider === p.id" (change)="selectProvider(p.id)" />
          <span class="provider__name">{{ p.label }}</span>
          <span class="badge badge--tiny" [class.badge--green]="p.tag !== 'Paid API'">{{ p.tag }}</span>
        </label>
      }
    </div>

    @if (current.keyPlaceholder) {
      <div class="field">
        <label for="apikey" class="label-row">
          {{ current.label }} API key
          @if (keyConfigured) {
            <span class="badge badge--green">Configured</span>
          } @else {
            <span class="badge">Not set</span>
          }
        </label>
        <div class="input-icon">
          <app-icon name="key" [size]="16" />
          <input
            id="apikey"
            type="password"
            autocomplete="off"
            [(ngModel)]="apiKey"
            name="apiKeyInput"
            [placeholder]="keyConfigured ? 'Leave blank to keep the current key' : current.keyPlaceholder"
            aria-describedby="apikey-help"
          />
        </div>
        <p class="field__help" id="apikey-help">{{ current.help }}</p>
      </div>
    } @else {
      <div class="field">
        <label for="ollamaUrl">Ollama server URL</label>
        <input id="ollamaUrl" [(ngModel)]="ai.ollama_base_url" name="ollamaUrl" placeholder="http://localhost:11434" />
        <p class="field__help">{{ current.help }}</p>
      </div>
    }

    <div class="field">
      <label for="aimodel">Model</label>
      <input id="aimodel" class="mono" [(ngModel)]="ai.model" name="aiModel" [placeholder]="current.defaultModel" aria-describedby="aimodel-help" />
      <p class="field__help" id="aimodel-help">
        Leave blank for {{ current.defaultModel }}. With a provider set up, resume uploads are also read by AI for more accurate
        prefill and role suggestions.
      </p>
    </div>
  `
})
export class AiSectionComponent {
  profile = input.required<Profile>();
  apiKey = model('');

  readonly providers = PROVIDERS;

  get ai() {
    return (this.profile().ai ??= {});
  }

  get provider(): AiProvider {
    return this.ai.provider ?? 'anthropic';
  }

  get current(): ProviderOption {
    return PROVIDERS.find((p) => p.id === this.provider)!;
  }

  get keyConfigured(): boolean {
    return Boolean(this.ai.keysConfigured?.[this.provider]);
  }

  selectProvider(id: AiProvider): void {
    if (id === this.provider) return;
    this.ai.provider = id;
    // A model name and an unsaved key only make sense for the provider they were typed for.
    this.ai.model = '';
    this.apiKey.set('');
  }
}
