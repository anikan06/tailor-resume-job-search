import { Component, computed, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IconComponent, IconName } from './shared/icon.component';

type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'jsa-theme';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'job-search-agent';

  nav: { path: string; label: string; icon: IconName }[] = [
    { path: '/dashboard', label: 'Dashboard', icon: 'grid' },
    { path: '/history', label: 'History', icon: 'clock' },
    { path: '/settings', label: 'Settings', icon: 'settings' }
  ];

  theme = signal<Theme>(this.readTheme());
  themeLabel = computed(() => ({ system: 'System theme', light: 'Light theme', dark: 'Dark theme' })[this.theme()]);

  constructor() {
    this.applyTheme(this.theme());
  }

  cycleTheme(): void {
    const order: Theme[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(this.theme()) + 1) % order.length];
    this.theme.set(next);
    this.applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // storage unavailable - theme just won't persist
    }
  }

  private readTheme(): Theme {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      // ignore
    }
    return 'system';
  }

  private applyTheme(theme: Theme): void {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }
}
