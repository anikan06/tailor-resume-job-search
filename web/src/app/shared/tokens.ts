import { UsageTotals } from '../core/models';

/** 1234 -> "1.2k", 2_500_000 -> "2.5M". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}

/** Hover text with the exact numbers behind a rounded total. */
export function tokenTitle(t: UsageTotals): string {
  const failed = t.failedCalls ? `, ${t.failedCalls} failed` : '';
  return `${t.inputTokens.toLocaleString()} in / ${t.outputTokens.toLocaleString()} out, ${t.calls} call${t.calls === 1 ? '' : 's'}${failed}`;
}
