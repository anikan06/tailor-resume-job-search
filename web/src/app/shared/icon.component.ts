import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'grid'
  | 'settings'
  | 'clock'
  | 'search'
  | 'refresh'
  | 'external'
  | 'sparkles'
  | 'send'
  | 'edit'
  | 'check'
  | 'alert'
  | 'upload'
  | 'file'
  | 'plus'
  | 'trash'
  | 'briefcase'
  | 'map-pin'
  | 'user'
  | 'target'
  | 'building'
  | 'key'
  | 'message'
  | 'calendar'
  | 'inbox'
  | 'x'
  | 'download'
  | 'activity'
  | 'chevron'
  | 'graduation'
  | 'award'
  | 'code'
  | 'link'
  | 'globe'
  | 'list'
  | 'mail'
  | 'phone';

/** Small inline-SVG icon set (Lucide-style strokes) so the app needs no icon dependency. */
@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'icon', 'aria-hidden': 'true' },
  styles: [':host{display:inline-flex;flex-shrink:0;line-height:0}'],
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      @switch (name()) {
        @case ('grid') {
          <svg:rect x="3" y="3" width="7" height="7" rx="1.5" /><svg:rect x="14" y="3" width="7" height="7" rx="1.5" />
          <svg:rect x="3" y="14" width="7" height="7" rx="1.5" /><svg:rect x="14" y="14" width="7" height="7" rx="1.5" />
        }
        @case ('settings') {
          <svg:path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
        }
        @case ('clock') {
          <svg:circle cx="12" cy="12" r="9" /><svg:path d="M12 7v5l3 2" />
        }
        @case ('search') {
          <svg:circle cx="11" cy="11" r="7" /><svg:path d="m20 20-3.5-3.5" />
        }
        @case ('refresh') {
          <svg:path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><svg:path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
          <svg:path d="M21 3v5h-5M3 21v-5h5" />
        }
        @case ('external') {
          <svg:path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        }
        @case ('sparkles') {
          <svg:path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
          <svg:path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z" />
        }
        @case ('send') {
          <svg:path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
        }
        @case ('edit') {
          <svg:path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        }
        @case ('check') {
          <svg:path d="M20 6 9 17l-5-5" />
        }
        @case ('alert') {
          <svg:path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <svg:path d="M12 9v4M12 17h.01" />
        }
        @case ('upload') {
          <svg:path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        }
        @case ('file') {
          <svg:path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <svg:path d="M14 2v6h6M8 13h8M8 17h5" />
        }
        @case ('plus') {
          <svg:path d="M12 5v14M5 12h14" />
        }
        @case ('x') {
          <svg:path d="M18 6 6 18M6 6l12 12" />
        }
        @case ('download') {
          <svg:path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        }
        @case ('trash') {
          <svg:path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        }
        @case ('briefcase') {
          <svg:rect x="2" y="7" width="20" height="14" rx="2" />
          <svg:path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20" />
        }
        @case ('map-pin') {
          <svg:path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" /><svg:circle cx="12" cy="10" r="3" />
        }
        @case ('user') {
          <svg:circle cx="12" cy="8" r="4" /><svg:path d="M4 21a8 8 0 0 1 16 0" />
        }
        @case ('target') {
          <svg:circle cx="12" cy="12" r="9" /><svg:circle cx="12" cy="12" r="5" /><svg:circle cx="12" cy="12" r="1" />
        }
        @case ('building') {
          <svg:rect x="4" y="2" width="16" height="20" rx="2" />
          <svg:path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
        }
        @case ('key') {
          <svg:circle cx="7.5" cy="15.5" r="5.5" /><svg:path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" />
        }
        @case ('message') {
          <svg:path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        }
        @case ('calendar') {
          <svg:rect x="3" y="4" width="18" height="18" rx="2" /><svg:path d="M16 2v4M8 2v4M3 10h18" />
        }
        @case ('chevron') {
          <svg:path d="m6 9 6 6 6-6" />
        }
        @case ('graduation') {
          <svg:path d="M22 10 12 5 2 10l10 5 10-5z" /><svg:path d="M6 12v5c3 2 9 2 12 0v-5M22 10v6" />
        }
        @case ('award') {
          <svg:circle cx="12" cy="8" r="6" /><svg:path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5" />
        }
        @case ('code') {
          <svg:path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
        }
        @case ('link') {
          <svg:path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
          <svg:path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
        }
        @case ('globe') {
          <svg:circle cx="12" cy="12" r="9" />
          <svg:path d="M3 12h18" />
          <svg:path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
        }
        @case ('list') {
          <svg:path d="M9 6h11M9 12h11M9 18h11" />
          <svg:path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
        }
        @case ('mail') {
          <svg:rect x="2" y="4" width="20" height="16" rx="2" /><svg:path d="m22 7-10 6L2 7" />
        }
        @case ('phone') {
          <svg:path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
        }
        @case ('activity') {
          <svg:path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        }
        @case ('inbox') {
          <svg:path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <svg:path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" />
        }
      }
    </svg>
  `
})
export class IconComponent {
  name = input.required<IconName>();
  size = input(18);
}
