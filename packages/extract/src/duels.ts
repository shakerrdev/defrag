import { frameOf, TICK_RATE, type Frame, type Scenario, type Tier } from "@defrag/scenario";

export type PlayerState = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  alive: boolean;
  team: number;
  airborne: boolean;
  flash: number;
};

export type Track = Map<number, PlayerState>;

export type Hurt = {
  tick: number;
  round: number;
  attacker: string;
  victim: string;
  weapon: string;
  hitgroup: string;
  health: number;
};

export type Shot = { tick: number; player: string; weapon: string };

export type Smoke = { from: number; to: number; x: number; y: number; z: number };

export type DemoData = {
  name: string;
  map: string;
  tracks: Map<string, Track>;
  hurts: Hurt[];
  shots: Shot[];
  smokes: Smoke[];
};

export type Rejection =
  | "utility-damage"
  | "repeat-pair"
  | "missing-ticks"
  | "both-moving"
  | "holder-moving"
  | "peeker-still"
  | "flashed"
  | "smoke"
  | "airborne"
  | "third-party"
  | "short-path";

export type Options = { tier: Tier; leadTicks: number; tailTicks: number };

export const DEFAULT_OPTIONS: Options = { tier: "pro", leadTicks: 64, tailTicks: 32 };

const UTILITY = /grenade|molotov|incgrenade|inferno|knife|decoy|flashbang|smoke|world/i;
const HOLDER_MAX_SPEED = 80;
const HOLDER_MAX_TRAVEL = 64;
const PEEKER_MIN_SPEED = 100;
const MIN_PATH = 48;
const PRE_ROLL = 8;
const STOP_SPEED = 60;
const SMOKE_RADIUS = 160;
const THIRD_PARTY_RANGE = 1200;
const BASE_REACT_MS = 180;
const NO_SHOT_REACT_MS = 450;

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function speedAt(track: Track, tick: number) {
  const a = track.get(tick - 1);
  const b = track.get(tick);
  return a && b ? dist2(a, b) * TICK_RATE : undefined;
}

function avgSpeed(track: Track, from: number, to: number) {
  let sum = 0;
  let n = 0;
  for (let t = from; t <= to; t++) {
    const s = speedAt(track, t);
    if (s === undefined) continue;
    sum += s;
    n++;
  }
  return n ? sum / n : undefined;
}

function travel(track: Track, from: number, to: number) {
  const a = track.get(from);
  const b = track.get(to);
  return a && b ? dist2(a, b) : undefined;
}

function segmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len = abx * abx + aby * aby;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len)) : 0;
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

export type Duel = { scenario: Scenario; holder: string; peeker: string };

export type Result = { duels: Duel[]; rejected: Partial<Record<Rejection, number>> };

export function candidateTicks(hurts: Hurt[], options = DEFAULT_OPTIONS) {
  const ticks = new Set<number>();
  for (const h of firstHurts(hurts)) {
    for (let t = h.tick - options.leadTicks - 64; t <= h.tick + options.tailTicks + 64; t++) ticks.add(t);
  }
  return [...ticks].sort((a, b) => a - b);
}

export function firstHurts(hurts: Hurt[]) {
  const seen = new Set<string>();
  const out: Hurt[] = [];
  for (const h of [...hurts].sort((a, b) => a.tick - b.tick)) {
    if (!h.attacker || h.attacker === h.victim || UTILITY.test(h.weapon)) continue;
    const key = `${h.round}:${[h.attacker, h.victim].sort().join(":")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

export function findDuels(demo: DemoData, options = DEFAULT_OPTIONS): Result {
  const rejected: Result["rejected"] = {};
  const duels: Duel[] = [];
  const reject = (why: Rejection) => {
    rejected[why] = (rejected[why] ?? 0) + 1;
  };

  for (const hurt of firstHurts(demo.hurts)) {
    const duel = analyse(demo, hurt, options);
    if (typeof duel === "string") reject(duel);
    else duels.push(duel);
  }
  return { duels, rejected };
}

function analyse(demo: DemoData, hurt: Hurt, options: Options): Duel | Rejection {
  const a = demo.tracks.get(hurt.attacker);
  const v = demo.tracks.get(hurt.victim);
  if (!a || !v) return "missing-ticks";
  const pair = new Set([hurt.attacker, hurt.victim]);

  const firstShot = demo.shots.find((s) => pair.has(s.player) && s.tick >= hurt.tick - 64 && s.tick <= hurt.tick);
  const contact = firstShot?.tick ?? hurt.tick;
  if (!a.get(contact) || !v.get(contact) || !a.get(contact - 64) || !v.get(contact - 64)) return "missing-ticks";

  const aSpeed = avgSpeed(a, contact - 32, contact)!;
  const vSpeed = avgSpeed(v, contact - 32, contact)!;
  const attackerHolds = aSpeed <= vSpeed;
  const [holderId, peekerId] = attackerHolds ? [hurt.attacker, hurt.victim] : [hurt.victim, hurt.attacker];
  const holder = attackerHolds ? a : v;
  const peeker = attackerHolds ? v : a;
  const holderSpeed = Math.min(aSpeed, vSpeed);
  const peekerSpeed = Math.max(aSpeed, vSpeed);

  if (holderSpeed > HOLDER_MAX_SPEED && peekerSpeed > HOLDER_MAX_SPEED) return "both-moving";
  if (holderSpeed > HOLDER_MAX_SPEED || (travel(holder, contact - 64, contact) ?? 0) > HOLDER_MAX_TRAVEL) {
    return "holder-moving";
  }
  const peekTravel = travel(peeker, contact - 48, contact) ?? 0;
  if (peekerSpeed < PEEKER_MIN_SPEED && peekTravel < MIN_PATH) return "peeker-still";

  const h = holder.get(contact)!;
  const p = peeker.get(contact)!;
  if (h.flash > 0 || p.flash > 0) return "flashed";

  for (const smoke of demo.smokes) {
    if (contact < smoke.from || contact > smoke.to) continue;
    if (segmentDistance(smoke, h, p) < SMOKE_RADIUS) return "smoke";
  }

  for (const [id, track] of demo.tracks) {
    if (pair.has(id)) continue;
    const s = track.get(contact);
    if (!s?.alive || s.team !== p.team) continue;
    const shooting = demo.shots.some((shot) => shot.player === id && shot.tick >= contact - 64 && shot.tick <= contact + 32);
    if (shooting && dist2(s, h) < THIRD_PARTY_RANGE) return "third-party";
  }
  const otherHurt = demo.hurts.some(
    (x) => x.victim === holderId && x.attacker !== peekerId && x.tick >= contact - 64 && x.tick <= contact + 64,
  );
  if (otherHurt) return "third-party";

  let start = contact - options.leadTicks;
  while (start < contact - PRE_ROLL && (speedAt(peeker, start + PRE_ROLL) ?? 0) < STOP_SPEED) start++;
  start = Math.max(contact - options.leadTicks, start);
  let end = contact;
  let stillTicks = 0;
  for (let t = contact + 1; t <= contact + options.tailTicks; t++) {
    const s = peeker.get(t);
    if (!s?.alive) break;
    end = t;
    stillTicks = (speedAt(peeker, t) ?? 0) < STOP_SPEED ? stillTicks + 1 : 0;
    if (stillTicks >= 4) break;
  }

  const frames: Frame[] = [];
  for (let t = start; t <= end; t++) {
    const s = peeker.get(t);
    if (!s) return "missing-ticks";
    if (s.airborne && t <= contact) return "airborne";
    frames.push(frameOf(s, s.yaw, s.pitch, false));
  }
  if ((travel(peeker, start, end) ?? 0) < MIN_PATH) return "short-path";

  const peekerShots = demo.shots.filter((s) => s.player === peekerId && s.tick >= contact - 32 && s.tick <= contact + 64);
  const peekerHits = demo.hurts.filter(
    (x) => x.attacker === peekerId && x.victim === holderId && x.tick >= contact - 32 && x.tick <= contact + 64,
  );
  const firstPeekerShot = peekerShots[0]?.tick;
  const reactMs =
    firstPeekerShot === undefined
      ? NO_SHOT_REACT_MS
      : clamp(BASE_REACT_MS + ((Math.max(0, firstPeekerShot - contact)) / TICK_RATE) * 1000, BASE_REACT_MS, 700);
  const accuracy = peekerShots.length ? clamp(peekerHits.length / peekerShots.length, 0.1, 0.9) : 0.25;
  const headshotShare = peekerHits.length
    ? clamp(peekerHits.filter((x) => x.hitgroup === "head").length / peekerHits.length, 0.05, 0.9)
    : 0.2;
  const holderWon = demo.hurts.some(
    (x) => x.attacker === holderId && x.victim === peekerId && x.health <= 0 && x.tick <= end + 64,
  );

  const holderView = holder.get(contact - 32) ?? h;
  return {
    holder: holderId,
    peeker: peekerId,
    scenario: {
      id: `${demo.name.replace(/\.dem$/i, "")}-${contact}`,
      map: demo.map,
      tier: options.tier,
      holder: {
        position: [round1(h.x), round1(h.y), round1(h.z)],
        yaw: round1(holderView.yaw),
        pitch: round1(holderView.pitch),
      },
      frames,
      contactFrame: contact - start,
      reactMs: Math.round(reactMs),
      accuracy: round2(accuracy),
      headshotShare: round2(headshotShare),
      weapon: peekerShots[0]?.weapon ?? "weapon_ak47",
      weight: 1,
      source: { demo: demo.name, tick: contact, round: hurt.round, holderWon },
    },
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

const CELL = 192;

function cellKey(position: number[]) {
  return position.map((v) => Math.round(v / CELL)).join(",");
}

export function cluster(scenarios: Scenario[]): Scenario[] {
  const groups = new Map<string, Scenario[]>();
  for (const s of scenarios) {
    const key = `${cellKey(s.holder.position)}|${cellKey(s.frames[0]!.slice(0, 3))}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.values()].map((group) => {
    const pick = group[Math.floor(group.length / 2)]!;
    return { ...pick, weight: group.length };
  });
}
