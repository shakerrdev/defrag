import { test } from "node:test";
import assert from "node:assert/strict";
import { Recorder, sampleAt, type Sample } from "../src/lib/peek.ts";
import { lerpYaw, lookAt } from "../src/lib/math.ts";

function sample(x: number, vx: number, yaw = 0): Sample {
  return { position: { x, y: 0, z: 0 }, velocity: { x: vx, y: 0, z: 0 }, yaw, pitch: 0, ducked: false };
}

test("recording starts on movement with pre-roll and trims the still tail", () => {
  const recorder = new Recorder();
  for (let i = 0; i < 20; i++) assert.equal(recorder.push(sample(0, 0)), undefined);
  for (let i = 0; i < 30; i++) assert.equal(recorder.push(sample(i * 4, 250)), undefined);
  let result: Sample[] | undefined;
  for (let i = 0; i < 16 && !result; i++) result = recorder.push(sample(120, 0));
  assert.ok(result);
  assert.equal(result.length, 8 + 30 + 4);
  assert.equal(result[0]!.velocity.x, 0);
  assert.equal(result[8]!.velocity.x, 250);
  assert.equal(recorder.recording, false);
});

test("recording stops at the length cap", () => {
  const recorder = new Recorder();
  let result: Sample[] | undefined;
  for (let i = 0; i < 1000 && !result; i++) result = recorder.push(sample(i, 250));
  assert.equal(result?.length, 256);
});

test("sampling interpolates between ticks and clamps at the ends", () => {
  const peek = { samples: [sample(0, 0, 350), sample(10, 100, 10)], tickInterval: 1 / 64 };
  const mid = sampleAt(peek, 0.5);
  assert.equal(mid.position.x, 5);
  assert.equal(mid.velocity.x, 50);
  assert.equal(mid.yaw, 360);
  assert.equal(sampleAt(peek, 7).position.x, 10);
  assert.equal(sampleAt(peek, -1).position.x, 0);
});

test("yaw takes the short way round", () => {
  assert.equal(lerpYaw(170, -170, 0.5), 180);
  assert.equal(lerpYaw(-170, 170, 0.5), -180);
});

test("lookAt matches Source angle conventions", () => {
  const down = lookAt({ x: 0, y: 0, z: 100 }, { x: 100, y: 0, z: 0 });
  assert.equal(Math.round(down.pitch), 45);
  assert.equal(Math.round(lookAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 50, z: 0 }).yaw), 90);
});
