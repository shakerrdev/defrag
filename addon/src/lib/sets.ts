import type { Stats } from "./stats.ts";

export type SetResult = { kills: number; reps: number; medianMs?: number };

export function median(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return Math.round(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function setResult(stats: Stats): SetResult {
  return { kills: stats.kills, reps: stats.reps, medianMs: median(stats.reactions) };
}

export function beats(a: SetResult, b: SetResult | undefined) {
  if (!b) return true;
  if (a.kills !== b.kills) return a.kills > b.kills;
  return (a.medianMs ?? Infinity) < (b.medianMs ?? Infinity);
}

export function describeSet(r: SetResult) {
  return `${r.kills}/${r.reps}${r.medianMs !== undefined ? `, median ${r.medianMs} ms` : ""}`;
}
