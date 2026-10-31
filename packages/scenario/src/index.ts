export const FORMAT_VERSION = 1;
export const TICK_RATE = 64;

export type Vec3 = [x: number, y: number, z: number];

export type Frame = [x: number, y: number, z: number, yaw: number, pitch: number, ducked: 0 | 1];

export type Tier = "custom" | "low" | "mid" | "high" | "pro";

export const TIERS: readonly Tier[] = ["custom", "low", "mid", "high", "pro"];

export type Scenario = {
  id: string;
  map: string;
  tier: Tier;
  holder: { position: Vec3; yaw: number; pitch: number };
  frames: Frame[];
  contactFrame: number;
  reactMs: number;
  accuracy: number;
  headshotShare: number;
  weapon: string;
  weight: number;
  source?: { demo?: string; tick?: number; round?: number; holderWon?: boolean };
};

export type Pack = {
  version: number;
  map: string;
  build?: string;
  name: string;
  scenarios: Scenario[];
  demos?: string[];
};

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export function frameOf(position: { x: number; y: number; z: number }, yaw: number, pitch: number, ducked: boolean): Frame {
  return [r1(position.x), r1(position.y), r1(position.z), r2(normalizeYaw(yaw)), r2(pitch), ducked ? 1 : 0];
}

export function normalizeYaw(yaw: number) {
  return ((((yaw + 180) % 360) + 360) % 360) - 180;
}

export type Sample = {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  ducked: boolean;
};

export function samplesOf(frames: Frame[]): Sample[] {
  const last = frames.length - 1;
  return frames.map((f, i) => {
    const from = Math.max(0, i - 1);
    const to = Math.min(last, i + 1);
    const a = frames[from]!;
    const b = frames[to]!;
    const dt = Math.max(1, to - from) / TICK_RATE;
    return {
      position: { x: f[0], y: f[1], z: f[2] },
      velocity: { x: (b[0] - a[0]) / dt, y: (b[1] - a[1]) / dt, z: (b[2] - a[2]) / dt },
      yaw: f[3],
      pitch: f[4],
      ducked: f[5] === 1,
    };
  });
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every(isNum);
}

function isFrame(v: unknown): v is Frame {
  return Array.isArray(v) && v.length === 6 && v.every(isNum) && (v[5] === 0 || v[5] === 1);
}

export function scenarioProblems(s: Scenario): string[] {
  const problems: string[] = [];
  if (!s.id) problems.push("missing id");
  if (!s.map) problems.push("missing map");
  if (!TIERS.includes(s.tier)) problems.push(`unknown tier ${s.tier}`);
  if (!isVec3(s.holder?.position) || !isNum(s.holder?.yaw) || !isNum(s.holder?.pitch)) problems.push("bad holder");
  if (!Array.isArray(s.frames) || s.frames.length < 2) problems.push("needs at least 2 frames");
  else if (!s.frames.every(isFrame)) problems.push("bad frame");
  if (!Number.isInteger(s.contactFrame) || s.contactFrame < 0 || s.contactFrame >= (s.frames?.length ?? 0)) {
    problems.push("contactFrame out of range");
  }
  if (!isNum(s.reactMs) || s.reactMs < 0) problems.push("bad reactMs");
  for (const key of ["accuracy", "headshotShare"] as const) {
    if (!isNum(s[key]) || s[key] < 0 || s[key] > 1) problems.push(`${key} must be 0..1`);
  }
  if (!isNum(s.weight) || s.weight <= 0) problems.push("weight must be > 0");
  return problems;
}

export function packProblems(p: Pack): string[] {
  const problems: string[] = [];
  if (p.version !== FORMAT_VERSION) problems.push(`unsupported version ${p.version}`);
  if (!p.map) problems.push("missing map");
  const ids = new Set<string>();
  for (const s of p.scenarios ?? []) {
    for (const problem of scenarioProblems(s)) problems.push(`${s.id || "?"}: ${problem}`);
    if (s.map !== p.map) problems.push(`${s.id}: map ${s.map} differs from pack map ${p.map}`);
    if (ids.has(s.id)) problems.push(`${s.id}: duplicate id`);
    ids.add(s.id);
  }
  return problems;
}

export function pickWeighted<T extends { weight: number }>(items: T[], random: () => number, avoid?: T): T | undefined {
  const pool = items.length > 1 && avoid ? items.filter((i) => i !== avoid) : items;
  const total = pool.reduce((sum, i) => sum + i.weight, 0);
  let roll = random() * total;
  for (const item of pool) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  return pool[pool.length - 1];
}

export type Difficulty = "easy" | "normal" | "hard" | "pro";

export const DIFFICULTIES: Record<Difficulty, { react: number; accuracy: number; speed: number }> = {
  easy: { react: 1.6, accuracy: 0.5, speed: 0.85 },
  normal: { react: 1, accuracy: 1, speed: 1 },
  hard: { react: 0.8, accuracy: 1.25, speed: 1 },
  pro: { react: 0.65, accuracy: 1.5, speed: 1.1 },
};

export function tuned(s: Scenario, difficulty: Difficulty) {
  const d = DIFFICULTIES[difficulty];
  return {
    reactMs: Math.round(s.reactMs * d.react),
    accuracy: Math.min(0.95, s.accuracy * d.accuracy),
    speed: d.speed,
  };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const SCALES = [2, 2, 2, 10, 10, 1];

function pushVarint(out: string[], value: number) {
  let v = value < 0 ? -value * 2 - 1 : value * 2;
  do {
    let chunk = v & 31;
    v = Math.floor(v / 32);
    if (v > 0) chunk |= 32;
    out.push(ALPHABET[chunk]!);
  } while (v > 0);
}

export function encodeFrames(frames: Frame[]): string {
  const out: string[] = [];
  const prev = [0, 0, 0, 0, 0, 0];
  for (const frame of frames) {
    for (let i = 0; i < 6; i++) {
      const q = Math.round(frame[i]! * SCALES[i]!);
      let delta = q - prev[i]!;
      if (i === 3) delta = ((((delta + 1800) % 3600) + 3600) % 3600) - 1800;
      pushVarint(out, delta);
      prev[i] = prev[i]! + delta;
    }
  }
  return out.join("");
}

export function decodeFrames(text: string): Frame[] {
  const frames: Frame[] = [];
  const values: number[] = [0, 0, 0, 0, 0, 0];
  let pos = 0;
  while (pos < text.length) {
    const frame = [] as unknown as Frame;
    for (let i = 0; i < 6; i++) {
      let v = 0;
      let mult = 1;
      let chunk: number;
      do {
        chunk = ALPHABET.indexOf(text[pos++]!);
        v += (chunk & 31) * mult;
        mult *= 32;
      } while (chunk & 32);
      values[i] = values[i]! + (v % 2 ? -(v + 1) / 2 : v / 2);
      (frame as number[])[i] = i === 3 ? normalizeYaw(values[i]! / SCALES[i]!) : values[i]! / SCALES[i]!;
    }
    frames.push(frame);
  }
  return frames;
}

export type CompactScenario = Omit<Scenario, "frames"> & { frames?: Frame[]; path: string };

export function compact(s: Scenario): CompactScenario {
  const { frames, source, ...rest } = s;
  return { ...rest, path: encodeFrames(frames) };
}

export function expand(s: Scenario | CompactScenario): Scenario {
  if ("path" in s && !s.frames) return { ...s, frames: decodeFrames(s.path) } as Scenario;
  return s as Scenario;
}
