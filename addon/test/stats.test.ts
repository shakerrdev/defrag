import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyStats, record, summary } from "../src/lib/stats.ts";

test("stats track kills, streaks and reaction times", () => {
  const s = emptyStats();
  assert.equal(summary(s), "no reps yet this session");
  record(s, "kill", 300);
  record(s, "kill", 200);
  record(s, "death");
  record(s, "kill", 400);
  record(s, "miss");
  assert.deepEqual([s.reps, s.kills, s.deaths, s.misses, s.streak], [5, 3, 1, 1, 0]);
  assert.equal(summary(s), "3/5 kills (60%) | 1 deaths, 1 misses | streak 0 | median 300 ms, best 200 ms");
});
