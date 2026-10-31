import { test } from "node:test";
import assert from "node:assert/strict";
import { adapt, focusWeight, MAX_LEVEL, MIN_LEVEL, scaled, worst } from "../src/lib/adaptive.ts";

test("adaptive level rises on fast kills and falls on deaths, within bounds", () => {
  const a = { level: 1 };
  adapt(a, "kill", 200, 300);
  assert.ok(a.level > 1.05);
  adapt(a, "death");
  assert.ok(a.level < 1);
  for (let i = 0; i < 100; i++) adapt(a, "death");
  assert.equal(a.level, MIN_LEVEL);
  for (let i = 0; i < 100; i++) adapt(a, "kill", 100, 300);
  assert.equal(a.level, MAX_LEVEL);
});

test("scaled makes the bot faster and more accurate above level 1", () => {
  const base = { reactMs: 300, accuracy: 0.4, speed: 1 };
  assert.deepEqual(scaled(1, base), base);
  const hard = scaled(1.5, base);
  assert.equal(hard.reactMs, 200);
  assert.ok(hard.accuracy > 0.4 && hard.speed > 1);
});

test("focus favours unplayed and lost scenarios, worst lists the lowest kill rates", () => {
  assert.equal(focusWeight(2, undefined), 3);
  assert.ok(focusWeight(1, { reps: 4, kills: 0 }) > focusWeight(1, { reps: 4, kills: 4 }));
  const list = worst({ a: { reps: 4, kills: 4 }, b: { reps: 4, kills: 1 }, c: { reps: 1, kills: 0 }, d: { reps: 3, kills: 1 } });
  assert.deepEqual(list.map((w) => w.id), ["b", "d", "a"]);
});
