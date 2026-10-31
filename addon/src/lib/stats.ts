export type Outcome = "kill" | "death" | "miss";

export type Stats = { reps: number; kills: number; deaths: number; misses: number; streak: number; reactions: number[] };

export function emptyStats(): Stats {
  return { reps: 0, kills: 0, deaths: 0, misses: 0, streak: 0, reactions: [] };
}

export function record(stats: Stats, outcome: Outcome, reactMs?: number) {
  stats.reps++;
  if (outcome === "kill") {
    stats.kills++;
    stats.streak++;
    if (reactMs !== undefined) stats.reactions.push(reactMs);
  } else {
    stats.streak = 0;
    if (outcome === "death") stats.deaths++;
    else stats.misses++;
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function summary(stats: Stats) {
  if (!stats.reps) return "no reps yet this session";
  const rate = Math.round((stats.kills / stats.reps) * 100);
  const reaction = stats.reactions.length
    ? ` | median ${Math.round(median(stats.reactions))} ms, best ${Math.min(...stats.reactions)} ms`
    : "";
  return `${stats.kills}/${stats.reps} kills (${rate}%) | ${stats.deaths} deaths, ${stats.misses} misses | streak ${stats.streak}${reaction}`;
}
