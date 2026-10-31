export const MIN_LEVEL = 0.5;
export const MAX_LEVEL = 2;

export type Adaptive = { level: number };

export function adapt(a: Adaptive, outcome: "kill" | "death" | "miss", reactMs?: number, botReactMs?: number) {
  let factor = 1;
  if (outcome === "death") factor = 0.92;
  else if (outcome === "miss") factor = 0.97;
  else if (reactMs !== undefined && botReactMs !== undefined && reactMs < botReactMs) factor = 1.06;
  else factor = 1.02;
  a.level = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, a.level * factor));
  return a.level;
}

export function scaled(level: number, base: { reactMs: number; accuracy: number; speed: number }) {
  return {
    reactMs: Math.round(base.reactMs / level),
    accuracy: Math.min(0.95, base.accuracy * level),
    speed: Math.min(1.25, base.speed * (1 + (level - 1) * 0.15)),
  };
}

export type ScenarioRecord = { reps: number; kills: number };

export function focusWeight(weight: number, record: ScenarioRecord | undefined) {
  if (!record?.reps) return weight * 1.5;
  const lossRate = 1 - record.kills / record.reps;
  return weight * (0.5 + lossRate * 2);
}

export function worst(records: Record<string, ScenarioRecord>, minReps = 2, count = 3) {
  return Object.entries(records)
    .filter(([, r]) => r.reps >= minReps)
    .sort(([, a], [, b]) => a.kills / a.reps - b.kills / b.reps || b.reps - a.reps)
    .slice(0, count)
    .map(([id, r]) => ({ id, ...r }));
}
