/** Deterministic hue for a company name so its avatar color stays stable across renders. */
export function companyHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export function companyInitial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}
