import { test } from "node:test";
import assert from "node:assert/strict";
import { beats, describeSet, median, setResult } from "../src/lib/sets.ts";
import { emptyStats, record } from "../src/lib/stats.ts";

test("set results compare by kills, then median reaction", () => {
  assert.equal(median([]), undefined);
  assert.equal(median([300, 100, 200]), 200);
  const s = emptyStats();
  record(s, "kill", 300);
  record(s, "kill", 250);
  record(s, "death");
  const r = setResult(s);
  assert.deepEqual(r, { kills: 2, reps: 3, medianMs: 275 });
  assert.equal(describeSet(r), "2/3, median 275 ms");
  assert.ok(beats(r, undefined));
  assert.ok(beats(r, { kills: 1, reps: 3 }));
  assert.ok(beats(r, { kills: 2, reps: 3, medianMs: 300 }));
  assert.ok(!beats(r, { kills: 2, reps: 3, medianMs: 250 }));
});
