const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  naukri: 'Naukri',
  indeed: 'Indeed',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  workday: 'Workday',
  other_ats: 'Other ATS'
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}
