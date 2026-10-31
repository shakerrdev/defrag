import type { CSPlayerPawn, QAngle, Vector } from "cs_script/point_script";
import { lerpVector, lerpYaw, lerp, speed2d } from "./math.ts";

export type Sample = {
  position: Vector;
  velocity: Vector;
  yaw: number;
  pitch: number;
  ducked: boolean;
};

export type Holder = { position: Vector; angles: QAngle };

export type Peek = { samples: Sample[]; tickInterval: number };

export function sampleOf(pawn: CSPlayerPawn): Sample {
  const eye = pawn.GetEyeAngles();
  return {
    position: pawn.GetAbsOrigin(),
    velocity: pawn.GetAbsVelocity(),
    yaw: eye.yaw,
    pitch: eye.pitch,
    ducked: pawn.IsDucked(),
  };
}

export function sampleAt(peek: Peek, index: number): Sample {
  const last = peek.samples.length - 1;
  const clamped = Math.max(0, Math.min(index, last));
  const i = Math.floor(clamped);
  const a = peek.samples[i]!;
  const b = peek.samples[Math.min(i + 1, last)]!;
  const t = clamped - i;
  return {
    position: lerpVector(a.position, b.position, t),
    velocity: lerpVector(a.velocity, b.velocity, t),
    yaw: lerpYaw(a.yaw, b.yaw, t),
    pitch: lerp(a.pitch, b.pitch, t),
    ducked: t < 0.5 ? a.ducked : b.ducked,
  };
}

const START_SPEED = 10;
const STOP_SPEED = 5;
const STOP_TICKS = 16;
const PRE_ROLL = 8;
const KEEP_AFTER_STOP = 4;
const MAX_SAMPLES = 256;

export class Recorder {
  private preRoll: Sample[] = [];
  private samples: Sample[] = [];
  private stillTicks = 0;
  recording = false;

  push(sample: Sample): Sample[] | undefined {
    const moving = speed2d(sample.velocity);
    if (!this.recording) {
      if (moving >= START_SPEED) {
        this.recording = true;
        this.samples = [...this.preRoll, sample];
        return undefined;
      }
      this.preRoll.push(sample);
      if (this.preRoll.length > PRE_ROLL) this.preRoll.shift();
      return undefined;
    }
    this.samples.push(sample);
    this.stillTicks = moving < STOP_SPEED ? this.stillTicks + 1 : 0;
    if (this.stillTicks >= STOP_TICKS || this.samples.length >= MAX_SAMPLES) return this.finish();
    return undefined;
  }

  finish(): Sample[] {
    const trim = Math.max(0, this.stillTicks - KEEP_AFTER_STOP);
    const samples = this.samples.slice(0, this.samples.length - trim);
    this.preRoll = [];
    this.samples = [];
    this.stillTicks = 0;
    this.recording = false;
    return samples;
  }
}
