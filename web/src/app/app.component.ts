import { Component, DestroyRef, ElementRef, computed, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
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
  title = 'aahvya-job-aggregator';

  nav: { path: string; label: string; icon: IconName }[] = [
    { path: '/dashboard', label: 'Dashboard', icon: 'grid' },
    { path: '/profile', label: 'Profile', icon: 'user' },
    { path: '/history', label: 'History', icon: 'clock' },
    { path: '/usage', label: 'AI Usage', icon: 'activity' },
    { path: '/settings', label: 'Settings', icon: 'settings' }
  ];

  theme = signal<Theme>(this.readTheme());
  themeLabel = computed(() => ({ system: 'System theme', light: 'Light theme', dark: 'Dark theme' })[this.theme()]);

  /** Read out by a live region after each in-app navigation, since SPAs don't trigger a page load. */
  routeAnnouncement = signal('');

  constructor(
    router: Router,
    destroyRef: DestroyRef,
    private host: ElementRef<HTMLElement>
  ) {
    this.applyTheme(this.theme());

    let first = true;
    router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe(() => {
        if (first) {
          first = false;
          return;
        }
        // Move focus to the new page so keyboard and screen reader users start at its content.
        setTimeout(() => {
          this.mainEl()?.focus({ preventScroll: true });
          this.routeAnnouncement.set(document.title.split(' · ')[0]);
        });
      });
  }

  focusMain(event: Event): void {
    event.preventDefault();
    const main = this.mainEl();
    main?.focus();
    main?.scrollIntoView();
  }

  private mainEl(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('#main');
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
