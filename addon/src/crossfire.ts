import {
  Console,
  CSDamageFlags,
  CSHitGroup,
  Instance,
  type CSPlayerController,
  type CSPlayerPawn,
  type QAngle,
  type Vector,
} from "cs_script/point_script";
import packs from "defrag:packs";
import {
  DIFFICULTIES,
  expand,
  FORMAT_VERSION,
  frameOf,
  pickWeighted,
  samplesOf,
  TIERS,
  tuned,
  type Difficulty,
  type Scenario,
  type Tier,
} from "@defrag/scenario";
import { flushChat, parseCommand, recentMessages, tell } from "./lib/chat.ts";
import { add, distance, lookAt, randomBetween, speed2d, ZERO } from "./lib/math.ts";
import { Recorder, sampleAt, sampleOf, type Peek } from "./lib/peek.ts";
import { adapt, focusWeight, scaled, worst, type ScenarioRecord } from "./lib/adaptive.ts";
import { drawHud, hideHud, hudAvailable, isHud, setMenuOpen, setMenuText, spawnHud } from "./lib/hud.ts";
import { loadSection, saveSection } from "./lib/save.ts";
import { beats, describeSet, setResult, type SetResult } from "./lib/sets.ts";
import { emptyStats, record, summary, type Outcome, type Stats } from "./lib/stats.ts";

type ShootMode = "assist" | "fake" | "off";
type Phase = "idle" | "armed" | "waiting" | "peeking" | "fighting" | "gap";

const TICK = 1 / 64;
const CHEST = { x: 0, y: 0, z: 40 };
const HEAD = { x: 0, y: 0, z: -2 };
const MAX_TURN_PER_TICK = 15;
const ON_TARGET_DEGREES = 2;
const STOPPED_SPEED = 60;
const BURST_RESET_SECONDS = 0.35;
const FIGHT_SECONDS = 1.5;
const GAP_SECONDS = 1;
const SCRIPT_NAME = "defrag";
const RUNNING_NAME = "defrag_running";
const MISS_OFFSET_DEGREES = 4;
const CUSTOM_LIMIT = 40;

const settings = {
  difficulty: "auto" as Difficulty | "auto",
  focus: false,
  gun: "rifle",
  hud: "auto" as "auto" | "custom" | "debug",
  weapons: "all" as WeaponClass | "all",
  tier: "all" as Tier | "all",
  shoot: "assist" as ShootMode,
  delayMin: 0.6,
  delayMax: 2,
};

type Rep = {
  scenario: Scenario;
  peek: Peek;
  reactMs: number;
  accuracy: number;
  speed: number;
  visibleAt?: number;
  startedAt: number;
  aim?: QAngle;
  aimOffset: QAngle;
  aimAtHead: boolean;
  triggerOpen?: boolean;
  burstShots: number;
  burstLimit: number;
  burstResetUntil: number;
  nextShotAt: number;
  lastHitGroup?: CSHitGroup;
};

const state = {
  phase: "idle" as Phase,
  phaseEndsAt: 0,
  running: false,
  rep: undefined as Rep | undefined,
  last: undefined as Scenario | undefined,
  recorder: new Recorder(),
  holdSpot: undefined as { position: Vector; angles: QAngle } | undefined,
  stats: emptyStats(),
  set: undefined as { size: number; stats: Stats } | undefined,
  lastResult: undefined as { text: string; good: boolean; at: number } | undefined,
};

type Save = {
  version: number;
  settings?: Partial<typeof settings>;
  custom?: Record<string, Scenario[]>;
  bests?: Record<string, { reactMs?: number; streak?: number; sets?: Record<string, SetResult> }>;
  level?: number;
  records?: Record<string, ScenarioRecord>;
};

let save: Save = { version: FORMAT_VERSION };

function mapName() {
  return Instance.GetMapName().replace(/^.*[\\/]/, "").replace(/\.vpk$/, "");
}

function persist() {
  save.settings = { ...settings };
  saveSection("crossfire", save);
}

function restore() {
  const data = loadSection<Save>("crossfire");
  if (data?.version === FORMAT_VERSION) save = data;
  Object.assign(settings, save.settings ?? {});
}

function customScenarios() {
  return (save.custom ??= {})[mapName()] ?? [];
}

type WeaponClass = "rifles" | "pistols" | "smgs" | "snipers";
const WEAPON_CLASSES: WeaponClass[] = ["rifles", "pistols", "smgs", "snipers"];

function weaponClass(weapon: string): WeaponClass | undefined {
  const name = weapon.replace(/^weapon_/, "");
  if (/^(ak47|m4a1|m4a1_silencer|galilar|famas|aug|sg556)$/.test(name)) return "rifles";
  if (/^(awp|ssg08|scar20|g3sg1)$/.test(name)) return "snipers";
  if (/^(mp9|mac10|mp7|mp5sd|ump45|p90|bizon)$/.test(name)) return "smgs";
  if (/^(glock|hkp2000|usp_silencer|p250|tec9|fiveseven|cz75a|deagle|revolver|elite)$/.test(name)) return "pistols";
  return undefined;
}

const expanded = new Map<string, Scenario[]>();
let pool: { key: string; list: Scenario[] } | undefined;

function packScenarios(map: string) {
  let list = expanded.get(map);
  if (!list) {
    list = packs.filter((p) => p.map === map).flatMap((p) => p.scenarios.map(expand));
    expanded.set(map, list);
  }
  return list;
}

function scenarios(): Scenario[] {
  const map = mapName();
  const custom = customScenarios();
  const key = `${map}|${settings.tier}|${settings.weapons}|${custom.length}`;
  if (pool?.key === key) return pool.list;
  const all = [...packScenarios(map), ...custom];
  pool = {
    key,
    list: all.filter(
      (s) =>
        (settings.tier === "all" || s.tier === settings.tier) &&
        (settings.weapons === "all" || s.tier === "custom" || weaponClass(s.weapon) === settings.weapons),
    ),
  };
  return pool.list;
}

function bests() {
  return ((save.bests ??= {})[mapName()] ??= {});
}

function controllers() {
  return Instance.GetAllPlayerControllers().filter((c) => c.IsConnected());
}

function humanController(): CSPlayerController | undefined {
  return controllers().find((c) => !c.IsBot());
}

function botController(): CSPlayerController | undefined {
  return controllers().find((c) => c.IsBot());
}

function alivePawn(controller: CSPlayerController | undefined): CSPlayerPawn | undefined {
  const pawn = controller?.GetPlayerPawn();
  return pawn?.IsValid() && pawn.IsAlive() ? pawn : undefined;
}

const human = () => alivePawn(humanController());
const bot = () => alivePawn(botController());

function setBotFrozen(frozen: boolean) {
  Console.ServerCommand(`bot_stop ${frozen ? 1 : 0}`);
}

function setTrigger(rep: Rep | undefined, open: boolean) {
  if (rep && rep.triggerOpen === open) return;
  if (rep) rep.triggerOpen = open;
  Console.SetConvar("bot_dont_shoot", !open);
}

function setupServer() {
  Console.SetConvar("mp_ignore_round_win_conditions", true);
  Console.SetConvar("mp_roundtime", 60);
  Console.SetConvar("mp_freezetime", 0);
  Console.SetConvar("mp_respawn_on_death_t", true);
  Console.SetConvar("mp_respawn_on_death_ct", true);
  Console.SetConvar("mp_buy_anywhere", 1);
  Console.SetConvar("mp_buytime", 9999);
  Console.SetConvar("sv_infinite_ammo", 1);
  Console.SetConvar("bot_difficulty", 3);
  Console.SetConvar("bot_dont_shoot", true);
  setBotFrozen(true);
}

function ensureOneBot() {
  if (controllers().filter((c) => c.IsBot()).length === 1) return;
  const team = humanController()?.GetTeamNumber() === 2 ? "ct" : "t";
  Console.ServerCommand(`bot_kick; bot_quota 0; bot_difficulty 3; bot_add_${team} expert`);
}

function setPhase(phase: Phase, seconds = 0) {
  state.phase = phase;
  state.phaseEndsAt = Instance.GetGameTime() + seconds;
}

function canSee(viewer: CSPlayerPawn, target: CSPlayerPawn) {
  const ignoreEntity = [viewer, target];
  const from = viewer.GetEyePosition();
  return [target.GetEyePosition(), add(target.GetAbsOrigin(), CHEST)].some(
    (end) => !Instance.TraceLine({ start: from, end, ignoreEntity }).didHit,
  );
}

function angleDelta(from: number, to: number) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

function applyFrame(b: CSPlayerPawn, rep: Rep, index: number, still = false) {
  const s = sampleAt(rep.peek, index);
  const aiming = rep.aim !== undefined;
  const angles = aiming ? { pitch: 0, yaw: rep.aim!.yaw, roll: 0 } : { pitch: 0, yaw: s.yaw, roll: 0 };
  b.Move({ position: s.position, angles, velocity: still ? ZERO : s.velocity });
  if (!aiming) b.SetEyeAngles({ pitch: s.pitch, yaw: s.yaw, roll: 0 });
}

function aimStep(b: CSPlayerPawn, h: CSPlayerPawn, rep: Rep) {
  const current = rep.aim ?? b.GetEyeAngles();
  const point = rep.aimAtHead ? add(h.GetEyePosition(), HEAD) : add(h.GetAbsOrigin(), CHEST);
  const ideal = lookAt(b.GetEyePosition(), point);
  const target = { pitch: ideal.pitch + rep.aimOffset.pitch, yaw: ideal.yaw + rep.aimOffset.yaw };
  const dYaw = angleDelta(current.yaw, target.yaw);
  const dPitch = target.pitch - current.pitch;
  const error = Math.hypot(dYaw, dPitch);
  const t = error > MAX_TURN_PER_TICK ? MAX_TURN_PER_TICK / error : 1;
  rep.aim = { pitch: current.pitch + dPitch * t, yaw: current.yaw + dYaw * t, roll: 0 };
  b.SetEyeAngles(rep.aim);
  return error * (1 - t);
}

function rollBurstAim(rep: Rep) {
  rep.aimAtHead = Math.random() < rep.scenario.headshotShare;
  const miss = Math.random() > rep.accuracy;
  const angle = Math.random() * Math.PI * 2;
  const size = miss ? MISS_OFFSET_DEGREES * (0.75 + Math.random() * 0.75) : 0;
  rep.aimOffset = { pitch: Math.sin(angle) * size, yaw: Math.cos(angle) * size, roll: 0 };
}

function burstFor(range: number) {
  if (range > 1200) return 1;
  if (range > 500) return 3;
  return 5;
}

function giveWeapon(b: CSPlayerPawn, weapon: string) {
  if (b.GetActiveWeapon()?.GetData().GetName() === weapon) return;
  b.DestroyWeapons();
  b.GiveNamedItem("weapon_knife", false);
  b.GiveNamedItem(weapon, true);
}

const GUNS = ["rifle", "ak47", "m4a1_silencer", "m4a1", "awp", "deagle", "keep"];

function giveGun(h: CSPlayerPawn) {
  if (settings.gun === "keep") return;
  const team = humanController()?.GetTeamNumber();
  const name = `weapon_${settings.gun === "rifle" ? (team === 2 ? "ak47" : "m4a1_silencer") : settings.gun}`;
  if (h.GetActiveWeapon()?.GetData().GetName() === name) return;
  if (h.FindWeapon(name)) return;
  h.GiveNamedItem(name, true);
}

const HIDDEN_PRE_ROLL = 12;

function hiddenStart(s: Scenario) {
  const [x, y, z] = s.holder.position;
  const start = { x, y, z: z + EYE };
  const ignoreEntity = [human(), bot()].filter((p): p is CSPlayerPawn => p !== undefined);
  for (let i = Math.min(s.contactFrame, s.frames.length - 1); i >= 0; i--) {
    const f = s.frames[i]!;
    const blocked = [EYE, 40].every((h) => Instance.TraceLine({ start, end: { x: f[0], y: f[1], z: f[2] + h }, ignoreEntity }).didHit);
    if (blocked) return Math.max(0, i - HIDDEN_PRE_ROLL);
  }
  return 0;
}

function pickFrom(pool: Scenario[], records: Record<string, ScenarioRecord>) {
  const weighted = pool.map((s) => ({ s, weight: settings.focus ? focusWeight(s.weight, records[s.id]) : s.weight }));
  return pickWeighted(weighted, Math.random, weighted.find((w) => w.s === state.last))?.s;
}

function startRep() {
  const pool = scenarios();
  if (!pool.length) {
    stop();
    return tell(`no scenarios for ${mapName()}${settings.tier === "all" ? "" : ` (tier ${settings.tier})`}: add a pack or record one with !hold + !rec`);
  }
  const h = human();
  const b = bot();
  if (!h || !b) {
    ensureOneBot();
    return setPhase("gap", 1);
  }
  const records = (save.records ??= {});
  let scenario: Scenario | undefined;
  for (let tries = 0; tries < 25 && !scenario; tries++) {
    const pick = pickFrom(pool.filter((s) => sight.get(s.id) !== false), records);
    if (!pick) break;
    if (hasSight(pick)) scenario = pick;
  }
  if (!scenario) {
    stop();
    return tell("none of the scenarios here have line of sight on this map version, try !tier all or record your own");
  }
  state.last = scenario;
  const t = settings.difficulty === "auto" ? scaled(save.level ?? 1, tuned(scenario, "normal")) : tuned(scenario, settings.difficulty);
  const rep: Rep = {
    scenario,
    peek: { samples: samplesOf(scenario.frames.slice(hiddenStart(scenario))), tickInterval: TICK },
    reactMs: t.reactMs,
    accuracy: t.accuracy,
    speed: t.speed,
    startedAt: 0,
    aimOffset: { pitch: 0, yaw: 0, roll: 0 },
    aimAtHead: true,
    burstShots: 0,
    burstLimit: 1,
    burstResetUntil: 0,
    nextShotAt: 0,
  };
  state.rep = rep;
  rollBurstAim(rep);
  setBotFrozen(true);
  setTrigger(rep, false);
  const [x, y, z] = scenario.holder.position;
  h.Teleport({ position: { x, y, z }, angles: { pitch: scenario.holder.pitch, yaw: scenario.holder.yaw, roll: 0 }, velocity: ZERO });
  h.SetHealth(100);
  h.SetArmor(100);
  giveGun(h);
  b.SetHealth(100);
  b.SetArmor(100);
  giveWeapon(b, scenario.weapon);
  b.Teleport({ position: rep.peek.samples[0]!.position, velocity: ZERO });
  applyFrame(b, rep, 0, true);
  setPhase("waiting", randomBetween(settings.delayMin, settings.delayMax));
}

function finish(outcome: Outcome, text: string) {
  const rep = state.rep;
  setTrigger(rep, false);
  setBotFrozen(true);
  state.rep = undefined;
  const reactMs = outcome === "kill" && rep?.visibleAt !== undefined ? Math.round((Instance.GetGameTime() - rep.visibleAt) * 1000) : undefined;
  record(state.stats, outcome, reactMs);
  if (rep) {
    const r = ((save.records ??= {})[rep.scenario.id] ??= { reps: 0, kills: 0 });
    r.reps++;
    if (outcome === "kill") r.kills++;
    if (settings.difficulty === "auto") save.level = adapt({ level: save.level ?? 1 }, outcome, reactMs, rep.reactMs);
  }
  const b = bests();
  let best = "";
  if (reactMs !== undefined && (b.reactMs === undefined || reactMs < b.reactMs)) {
    b.reactMs = reactMs;
    best = " - new best!";
  }
  if (state.stats.streak > (b.streak ?? 0)) b.streak = state.stats.streak;
  if (state.set) {
    record(state.set.stats, outcome, reactMs);
    if (state.set.stats.reps >= state.set.size) finishSet();
  }
  persist();
  const full = `${text}${reactMs !== undefined ? ` in ${reactMs} ms` : ""}${best}`;
  state.lastResult = { text: full, good: outcome === "kill", at: Instance.GetGameTime() };
  Console.Log(`[defrag] ${full}`);
  setPhase(state.running ? "gap" : "idle", GAP_SECONDS);
}

function finishSet() {
  const set = state.set!;
  state.set = undefined;
  state.running = false;
  const result = setResult(set.stats);
  const sets = (bests().sets ??= {});
  const previous = sets[set.size];
  const isBest = beats(result, previous);
  if (isBest) sets[set.size] = result;
  tell(
    `set of ${set.size} done: ${describeSet(result)}` +
      (isBest ? (previous ? ` - new best (was ${describeSet(previous)})` : " - first set on this map") : `, best ${describeSet(previous!)}`),
  );
}

function stop() {
  state.running = false;
  setTrigger(state.rep, false);
  state.rep = undefined;
  setBotFrozen(true);
  setPhase("idle");
}

function engage(b: CSPlayerPawn, h: CSPlayerPawn, rep: Rep, now: number) {
  if (settings.shoot === "off" || rep.visibleAt === undefined) return;
  if (now < rep.visibleAt + rep.reactMs / 1000 || !canSee(b, h)) {
    if (settings.shoot === "assist") setTrigger(rep, false);
    return;
  }
  const error = aimStep(b, h, rep);
  if (settings.shoot === "assist") {
    const stopped = speed2d(b.GetAbsVelocity()) < STOPPED_SPEED;
    if (!rep.triggerOpen) rep.burstLimit = burstFor(distance(b.GetEyePosition(), h.GetEyePosition()));
    const onTarget = error <= (rep.triggerOpen ? ON_TARGET_DEGREES * 2 : ON_TARGET_DEGREES);
    return setTrigger(rep, onTarget && stopped && now >= rep.burstResetUntil);
  }
  if (error > ON_TARGET_DEGREES || now < rep.nextShotAt) return;
  rep.nextShotAt = now + 0.1;
  if (rep.aimOffset.yaw !== 0 || rep.aimOffset.pitch !== 0) return rollBurstAim(rep);
  h.TakeDamage({ damage: rep.aimAtHead ? 111 : 27, attacker: b, inflictor: b, weapon: b.GetActiveWeapon() });
  rollBurstAim(rep);
}

function onBotShot(now: number) {
  const rep = state.rep;
  if (!rep || settings.shoot !== "assist") return;
  rep.burstShots++;
  if (rep.burstShots < rep.burstLimit) return;
  rep.burstShots = 0;
  rep.burstResetUntil = now + BURST_RESET_SECONDS;
  setTrigger(rep, false);
  rollBurstAim(rep);
}

function tick() {
  const now = Instance.GetGameTime();
  const h = human();
  const b = bot();
  const rep = state.rep;

  if (state.phase === "armed" && h) {
    const samples = state.recorder.push(sampleOf(h));
    if (samples) saveCustom(samples);
  } else if (state.phase === "waiting" && rep) {
    if (b) applyFrame(b, rep, 0, true);
    if (now >= state.phaseEndsAt) {
      rep.startedAt = now;
      state.phase = "peeking";
      if (settings.shoot === "assist") setBotFrozen(false);
    }
  } else if ((state.phase === "peeking" || state.phase === "fighting") && rep) {
    if (!b) return finish("kill", "killed");
    if (!h) return finish("death", "you died");
    if (rep.visibleAt === undefined && canSee(h, b)) rep.visibleAt = now;
    const last = rep.peek.samples.length - 1;
    if (state.phase === "peeking") {
      const index = ((now - rep.startedAt) / TICK) * rep.speed;
      applyFrame(b, rep, index);
      if (index >= last) setPhase("fighting", FIGHT_SECONDS);
    } else {
      applyFrame(b, rep, last, true);
      if (now >= state.phaseEndsAt) return finish("miss", rep.visibleAt === undefined ? "bot never showed" : "bot survived");
    }
    engage(b, h, rep, now);
  } else if (state.phase === "gap" && now >= state.phaseEndsAt) {
    if (state.running) startRep();
    else setPhase("idle");
  }
}

function saveCustom(samples: ReturnType<Recorder["finish"]>) {
  setPhase("idle");
  if (!state.holdSpot) return tell("set your holding spot with !hold first");
  if (samples.length < 8) return tell("that peek was too short, try !rec again");
  const list = (save.custom ??= {})[mapName()] ??= [];
  const { position, angles } = state.holdSpot;
  const scenario: Scenario = {
    id: `custom-${Date.now().toString(36)}`,
    map: mapName(),
    tier: "custom",
    holder: { position: [position.x, position.y, position.z], yaw: angles.yaw, pitch: angles.pitch },
    frames: samples.map((s) => frameOf(s.position, s.yaw, s.pitch, s.ducked)),
    contactFrame: samples.length - 1,
    reactMs: 250,
    accuracy: 0.35,
    headshotShare: 0.3,
    weapon: "weapon_ak47",
    weight: 1,
  };
  list.push(scenario);
  if (list.length > CUSTOM_LIMIT) list.shift();
  persist();
  tell(`saved custom peek #${list.length} (${samples.length} ticks), walk back to your angle and !hold for the next one or !start`);
}

const EYE = 64;

const sight = new Map<string, boolean>();

function hasSight(s: Scenario) {
  const known = sight.get(s.id);
  if (known !== undefined) return known;
  const [x, y, z] = s.holder.position;
  const f = s.frames[Math.min(s.contactFrame + 8, s.frames.length - 1)]!;
  const ignoreEntity = [human(), bot()].filter((p): p is CSPlayerPawn => p !== undefined);
  const visible = !Instance.TraceLine({ start: { x, y, z: z + EYE }, end: { x: f[0], y: f[1], z: f[2] + EYE }, ignoreEntity }).didHit;
  sight.set(s.id, visible);
  return visible;
}

function checkScenarios() {
  sight.clear();
  const pool = scenarios();
  const blocked = pool.filter((s) => !hasSight(s)).map((s) => s.id);
  Console.Log(`[defrag] check: ${blocked.length} of ${pool.length} without line of sight: ${blocked.join(" ")}`);
  tell(
    blocked.length
      ? `${blocked.length} of ${pool.length} scenarios have no line of sight at contact (map changed?) and are skipped, ids in the console`
      : `all ${pool.length} scenarios have line of sight at contact`,
  );
}

const HELP = [
  "!start / !stop / !skip, !diff auto|easy|normal|hard|pro, !tier all|pro|high|mid|low|custom, !weapons all|rifles|pistols|smgs|snipers",
  "!set 20 (scored set, best saved), !menu (clickable settings), !gun rifle|ak47|m4a1_silencer|m4a1|awp|deagle|keep, !focus on|off, !worst, !hud auto|custom|debug",
  "!shoot assist|fake|off, !stats, !reset (session), !packs, !check (line of sight of every scenario)",
  "own peeks: stand on your angle + !hold, walk to the peek start + !rec, swing out and stop; !custom clear",
];

const X = 100;
const Y = 380;
const LINE = 14;
const WHITE = { r: 255, g: 255, b: 255 };
const YELLOW = { r: 255, g: 220, b: 90 };
const GREY = { r: 190, g: 190, b: 190 };
const GREEN = { r: 110, g: 230, b: 120 };
const RED = { r: 240, g: 90, b: 80 };
let helpUntil = 0;

function hint() {
  if (state.phase === "armed") return state.recorder.recording ? "recording... stop moving to finish" : "armed: swing out like a peek, then stop";
  if (state.set) return `set: rep ${state.set.stats.reps + 1} of ${state.set.size}, !stop to end`;
  if (state.running) return "running, !stop to end";
  if (!scenarios().length) return "no scenarios here: record one (!help) or add a pack";
  return "type !start, or !help";
}

function drawOverlay(now: number) {
  const b = bests();
  const title = `defrag crossfire | ${mapName()} | ${hint()}`;
  const difficulty = settings.difficulty === "auto" ? `auto ${(save.level ?? 1).toFixed(2)}` : settings.difficulty;
  const info =
    `${scenarios().length} scenarios (${settings.tier}) | ${difficulty}${settings.focus ? " focus" : ""} | shoot ${settings.shoot} | ` +
    `best ${b.reactMs !== undefined ? `${b.reactMs} ms` : "-"} | best streak ${b.streak ?? 0}`;
  const session = summary(state.stats);
  const result = state.lastResult && now - state.lastResult.at < 3 ? state.lastResult : undefined;
  const messages = [...(now < helpUntil ? HELP : []), ...recentMessages(now, 6)];

  if (settings.hud === "debug") hideHud();
  else drawHud({ title, info, session, result: result?.text ?? "", good: result?.good ?? false, messages: messages.join("\n") });
  if (settings.hud === "custom") return;
  const lines: [string, typeof WHITE][] = [
    [title, YELLOW],
    [info, GREY],
    [session, WHITE],
  ];
  if (result) lines.push([result.text, result.good ? GREEN : RED]);
  for (const message of messages) lines.push([message, GREY]);
  lines.forEach(([text, color], i) => Instance.DebugScreenText({ text, x: X, y: Y + i * LINE, color }));
}

function think() {
  const now = Instance.GetGameTime();
  try {
    tick();
    flushChat(now);
    drawOverlay(now);
    updateMenu();
  } catch (error) {
    Console.Log(`[defrag] tick failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
  Instance.SetNextThink(now + TICK);
}

function onCommand(name: string, args: string[]) {
  const arg = (args[0] ?? "").toLowerCase();
  switch (name) {
    case "help":
      helpUntil = Instance.GetGameTime() + 20;
      return HELP.forEach(tell);
    case "set": {
      const size = Math.round(Number(arg));
      if (!(size >= 5 && size <= 100)) return tell("set: a number of reps from 5 to 100, e.g. !set 20");
      state.set = { size, stats: emptyStats() };
      state.running = true;
      tell(`set of ${size} reps started`);
      return startRep();
    }
    case "start":
    case "go":
      state.set = undefined;
      state.running = true;
      return startRep();
    case "stop":
      if (state.set) tell(`set stopped after ${state.set.stats.reps} of ${state.set.size} reps`);
      state.set = undefined;
      stop();
      return tell("stopped");
    case "skip":
      if (!state.running) return;
      setTrigger(state.rep, false);
      state.rep = undefined;
      return startRep();
    case "diff":
      if (arg !== "auto" && !(arg in DIFFICULTIES)) return tell(`difficulty: auto, ${Object.keys(DIFFICULTIES).join(", ")}`);
      settings.difficulty = arg as Difficulty | "auto";
      persist();
      return tell(arg === "auto" ? `difficulty adapts to you, now ${(save.level ?? 1).toFixed(2)}` : `difficulty ${arg}`);
    case "focus":
      settings.focus = arg !== "off";
      persist();
      return tell(settings.focus ? "focus on: peeks you lose come up more" : "focus off");
    case "gun":
      if (!GUNS.includes(arg)) return tell(`gun: ${GUNS.join(", ")}`);
      settings.gun = arg;
      persist();
      return tell(`gun ${arg}`);
    case "weapons":
      if (arg !== "all" && !WEAPON_CLASSES.includes(arg as WeaponClass)) return tell(`weapons: all, ${WEAPON_CLASSES.join(", ")}`);
      settings.weapons = arg as WeaponClass | "all";
      persist();
      return tell(`bot weapons ${arg}: ${scenarios().length} scenarios`);
    case "menu":
      return toggleMenu();
    case "hud":
      if (!["auto", "custom", "debug"].includes(arg)) return tell(`hud: auto (both), custom or debug (custom layout entity ${hudAvailable() ? "exists" : "missing"})`);
      settings.hud = arg as typeof settings.hud;
      persist();
      return tell(
        arg === "auto"
          ? "hud auto: custom HUD and debug text both on (!hud custom once the custom one shows up)"
          : `hud ${arg}${arg === "custom" && !hudAvailable() ? ", but the custom layout entity doesn't exist" : ""}`,
      );
    case "worst": {
      const list = worst(save.records ?? {});
      if (!list.length) return tell("play a few reps first");
      return tell(`hardest: ${list.map((w) => `${w.id} ${w.kills}/${w.reps}`).join(", ")}`);
    }
    case "tier":
      if (arg !== "all" && !TIERS.includes(arg as Tier)) return tell(`tier: all, ${TIERS.join(", ")}`);
      settings.tier = arg as Tier | "all";
      persist();
      return tell(`tier ${arg}: ${scenarios().length} scenarios`);
    case "shoot":
      if (!["assist", "fake", "off"].includes(arg)) return tell("shoot: assist, fake or off");
      settings.shoot = arg as ShootMode;
      persist();
      return tell(`shoot ${arg}`);
    case "stats":
      return tell(summary(state.stats));
    case "reset":
      state.stats = emptyStats();
      return tell("session stats reset");
    case "packs": {
      const here = packs.filter((p) => p.map === mapName());
      return tell(
        `${packs.length} pack(s) bundled, ${here.length} for ${mapName()}: ` +
          (here.map((p) => `${p.name} (${p.scenarios.length})`).join(", ") || "none") +
          `, ${customScenarios().length} custom`,
      );
    }
    case "hold": {
      const h = human();
      if (!h) return tell("spawn first");
      state.holdSpot = { position: h.GetAbsOrigin(), angles: h.GetEyeAngles() };
      return tell("holding spot set, now walk to where the bot should start and type !rec");
    }
    case "rec":
      stop();
      state.recorder = new Recorder();
      setPhase("armed");
      return tell("recording starts when you move and stops when you stop");
    case "check":
      return checkScenarios();
    case "custom":
      if (arg === "clear") {
        (save.custom ??= {})[mapName()] = [];
        persist();
        return tell("custom peeks cleared");
      }
      return tell(`${customScenarios().length} custom peek(s) on ${mapName()}, !custom clear to remove them`);
  }
}

const DIFF_CYCLE = ["auto", "easy", "normal", "hard", "pro"];
const TIER_CYCLE = ["all", ...TIERS];
const SHOOT_CYCLE = ["assist", "fake", "off"];
let menuOpen = false;

function next(list: readonly string[], current: string) {
  return list[(list.indexOf(current) + 1) % list.length]!;
}

function toggleMenu(open = !menuOpen) {
  const slot = humanController()?.GetPlayerSlot();
  if (slot === undefined) return;
  if (!setMenuOpen(slot, open)) return tell("the custom HUD isn't loaded, use chat commands (!help)");
  menuOpen = open;
}

function updateMenu() {
  if (!menuOpen) return;
  setMenuText({
    menu_info: `${mapName()} | ${scenarios().length} scenarios | ${summary(state.stats)}`,
    menu_diff: settings.difficulty === "auto" ? `auto (${(save.level ?? 1).toFixed(2)})` : settings.difficulty,
    menu_tier: settings.tier,
    menu_focus: settings.focus ? "on" : "off",
    menu_shoot: settings.shoot,
    menu_gun: settings.gun,
    menu_weapons: settings.weapons,
  });
}

const MENU_ACTIONS: Record<string, () => void> = {
  btn_start: () => {
    toggleMenu(false);
    onCommand("start", []);
  },
  btn_set: () => {
    toggleMenu(false);
    onCommand("set", ["20"]);
  },
  btn_stop: () => onCommand("stop", []),
  btn_skip: () => onCommand("skip", []),
  btn_diff: () => onCommand("diff", [next(DIFF_CYCLE, settings.difficulty)]),
  btn_tier: () => onCommand("tier", [next(TIER_CYCLE, settings.tier)]),
  btn_focus: () => onCommand("focus", [settings.focus ? "off" : "on"]),
  btn_shoot: () => onCommand("shoot", [next(SHOOT_CYCLE, settings.shoot)]),
  btn_gun: () => onCommand("gun", [next(GUNS, settings.gun)]),
  btn_weapons: () => onCommand("weapons", [next(["all", ...WEAPON_CLASSES], settings.weapons)]),
  btn_reset: () => onCommand("reset", []),
  btn_close: () => toggleMenu(false),
};

Instance.OnCustomHudClicked(({ layout, buttonId }) => {
  if (!isHud(layout)) return;
  MENU_ACTIONS[buttonId]?.();
  updateMenu();
});

Instance.OnPlayerChat(({ player, text }) => {
  if (!player || player.IsBot()) return;
  const command = parseCommand(text);
  if (command) onCommand(command.name, command.args);
});

Instance.OnGunFire(({ weapon }) => {
  const owner = weapon.GetOwner();
  if (owner && owner === bot()) onBotShot(Instance.GetGameTime());
});

Instance.OnModifyPlayerDamage((event) => {
  if (event.player === human()) return { damageFlags: event.damageFlags | CSDamageFlags.PREVENT_DEATH };
  if (state.rep && event.player === bot() && event.attacker === human()) state.rep.lastHitGroup = event.hitGroup;
  return undefined;
});

Instance.OnPlayerDamage((event) => {
  const h = human();
  if (!state.rep || event.player !== h || event.attacker !== bot()) return;
  if (h.GetHealth() <= 1) finish("death", event.hitGroup === CSHitGroup.HEAD ? "you got headshot" : "you died");
});

Instance.OnPlayerKill((event) => {
  const rep = state.rep;
  if (!rep || event.player !== botController()?.GetPlayerPawn()) return;
  if (state.phase !== "peeking" && state.phase !== "fighting") return;
  finish("kill", rep.lastHitGroup === CSHitGroup.HEAD ? "headshot" : "killed");
});

Instance.OnPlayerActivate(({ player }) => {
  if (player.IsBot()) return;
  setupServer();
  Instance.Delay(1).then(() => {
    ensureOneBot();
    tell(`crossfire loaded: ${scenarios().length} scenarios on ${mapName()}, type !start or !help`);
  });
});

Instance.OnRoundStart(() => {
  setupServer();
  if (state.running) setPhase("gap", GAP_SECONDS);
});

function becomeOnlyInstance() {
  for (const old of Instance.FindEntitiesByName(RUNNING_NAME)) old.Kill();
  for (const self of Instance.FindEntitiesByName(SCRIPT_NAME)) self.SetEntityName(RUNNING_NAME);
}

becomeOnlyInstance();
restore();
setupServer();
spawnHud();
Instance.SetThink(think);
Instance.SetNextThink(Instance.GetGameTime() + TICK);
Instance.Delay(1).then(() => {
  if (!humanController()) return;
  ensureOneBot();
  tell(`crossfire loaded: ${scenarios().length} scenarios on ${mapName()}, type !start or !help`);
});
