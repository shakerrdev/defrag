import type { QAngle, Vector } from "cs_script/point_script";

export const ZERO: Vector = { x: 0, y: 0, z: 0 };

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function lerpVector(a: Vector, b: Vector, t: number): Vector {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

export function lerpYaw(a: number, b: number, t: number) {
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return a + delta * t;
}

export function add(a: Vector, b: Vector): Vector {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function distance(a: Vector, b: Vector) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function speed2d(v: Vector) {
  return Math.hypot(v.x, v.y);
}

export function lookAt(from: Vector, to: Vector): QAngle {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return {
    pitch: (-Math.atan2(dz, Math.hypot(dx, dy)) * 180) / Math.PI,
    yaw: (Math.atan2(dy, dx) * 180) / Math.PI,
    roll: 0,
  };
}

export function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function round(value: number, digits = 1) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
