import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORMAT_VERSION,
  decodeFrames,
  encodeFrames,
  frameOf,
  normalizeYaw,
  packProblems,
  pickWeighted,
  samplesOf,
  tuned,
  type Frame,
  type Scenario,
} from "../src/index.ts";

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  const frames: Frame[] = [0, 1, 2, 3].map((i) => [i * 4, 0, 0, 90, 0, 0]);
  return {
    id: "a",
    map: "de_mirage",
    tier: "pro",
    holder: { position: [0, 500, 0], yaw: -90, pitch: 0 },
    frames,
    contactFrame: 2,
    reactMs: 250,
    accuracy: 0.4,
    headshotShare: 0.3,
    weapon: "weapon_ak47",
    weight: 1,
    ...overrides,
  };
}

test("frameOf rounds and normalizes yaw", () => {
  assert.deepEqual(frameOf({ x: 1.234, y: -5.678, z: 0.05 }, 270.123, 1.005, true), [1.2, -5.7, 0.1, -89.88, 1, 1]);
  assert.equal(normalizeYaw(-190), 170);
  assert.equal(normalizeYaw(180), -180);
});

test("samplesOf derives velocity at 64 ticks", () => {
  const samples = samplesOf(scenario().frames);
  assert.equal(samples.length, 4);
  assert.equal(samples[1]!.velocity.x, 256);
  assert.equal(samples[0]!.velocity.x, 256);
  assert.equal(samples[3]!.velocity.x, 256);
});

test("packProblems flags bad scenarios", () => {
  const good = { version: FORMAT_VERSION, map: "de_mirage", name: "t", scenarios: [scenario()] };
  assert.deepEqual(packProblems(good), []);
  const bad = {
    ...good,
    scenarios: [scenario(), scenario({ contactFrame: 9, accuracy: 2, map: "de_dust2" })],
  };
  const problems = packProblems(bad);
  assert.ok(problems.some((p) => p.includes("duplicate")));
  assert.ok(problems.some((p) => p.includes("contactFrame")));
  assert.ok(problems.some((p) => p.includes("accuracy")));
  assert.ok(problems.some((p) => p.includes("differs")));
});

test("pickWeighted respects weights and avoids repeats", () => {
  const a = { weight: 1 };
  const b = { weight: 3 };
  assert.equal(pickWeighted([a, b], () => 0.1), a);
  assert.equal(pickWeighted([a, b], () => 0.5), b);
  assert.equal(pickWeighted([a, b], () => 0.1, a), b);
  assert.equal(pickWeighted([a], () => 0.9, a), a);
  assert.equal(pickWeighted([], () => 0.5), undefined);
});

test("tuned scales by difficulty", () => {
  assert.deepEqual(tuned(scenario(), "normal"), { reactMs: 250, accuracy: 0.4, speed: 1 });
  assert.ok(tuned(scenario(), "easy").reactMs > 250);
  assert.ok(tuned(scenario({ accuracy: 0.9 }), "pro").accuracy <= 0.95);
});

test("frames survive the compact encoding within its precision", () => {
  const frames: Frame[] = [
    [-1234.5, 2048.1, -160, 179.9, -12.3, 0],
    [-1230, 2050.4, -159.5, -179.8, -12.1, 1],
    [-1100.2, 2100, -150, 90, 3.45, 0],
  ];
  const back = decodeFrames(encodeFrames(frames));
  assert.equal(back.length, 3);
  back.forEach((f, i) => f.forEach((v, j) => assert.ok(Math.abs(v - frames[i]![j]!) <= 0.26, `${i}.${j}: ${v} vs ${frames[i]![j]}`)));
  assert.ok(encodeFrames(frames).length < JSON.stringify(frames).length / 2);
});
