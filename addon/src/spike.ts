import {
  Console,
  CSDamageFlags,
  CSDamageTypes,
  CSHitGroup,
  Instance,
  type CSPlayerController,
  type CSPlayerPawn,
} from "cs_script/point_script";
import { flushChat, parseCommand, recentMessages, tell } from "./spike/chat.ts";
import { add, distance, lookAt, randomBetween, round, ZERO } from "./spike/math.ts";
import { Recorder, sampleAt, sampleOf, type Holder, type Peek } from "./spike/peek.ts";

type MoveMode = "move" | "teleport" | "velocity";
type ShootMode = "off" | "hybrid" | "fake";
type Phase = "idle" | "armed" | "waiting" | "peeking" | "fighting" | "gap";

const TICK = 1 / 64;
const CHEST = { x: 0, y: 0, z: 40 };
const DRIFT_LIMIT = 24;

const settings = {
  move: "move" as MoveMode,
  shoot: "fake" as ShootMode,
  speed: 1,
  reactMs: 250,
  accuracy: 0.35,
  headshotShare: 0.25,
  fireInterval: 0.1,
  fightSeconds: 1.5,
  god: true,
  loop: false,
  delayMin: 0.4,
  delayMax: 1.6,
};

const state = {
  phase: "idle" as Phase,
  holder: undefined as Holder | undefined,
  peek: undefined as Peek | undefined,
  recorder: new Recorder(),
  phaseEndsAt: 0,
  peekStartedAt: 0,
  visibleAt: undefined as number | undefined,
  nextShotAt: 0,
  lastHitGroup: undefined as CSHitGroup | undefined,
};

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

function human() {
  return alivePawn(humanController());
}

function bot() {
  return alivePawn(botController());
}

function setBotFrozen(frozen: boolean) {
  Console.ServerCommand(`bot_stop ${frozen ? 1 : 0}`);
}

function setupServer() {
  Console.SetConvar("mp_ignore_round_win_conditions", true);
  Console.SetConvar("mp_roundtime", 60);
  Console.SetConvar("mp_freezetime", 0);
  Console.SetConvar("mp_respawn_on_death_t", true);
  Console.SetConvar("mp_respawn_on_death_ct", true);
  Console.SetConvar("sv_infinite_ammo", 2);
  Console.SetConvar("bot_dont_shoot", false);
  Console.SetConvar("bot_difficulty", 3);
  setBotFrozen(true);
}

function addBot() {
  const team = humanController()?.GetTeamNumber() === 2 ? "ct" : "t";
  Console.ServerCommand(`bot_kick; bot_quota 0; bot_add_${team}`);
  tell(`adding a ${team.toUpperCase()} bot`);
}

function ensureOneBot() {
  if (controllers().filter((c) => c.IsBot()).length !== 1) addBot();
}

function setPhase(phase: Phase, seconds = 0) {
  state.phase = phase;
  state.phaseEndsAt = Instance.GetGameTime() + seconds;
}

function eye(pawn: CSPlayerPawn) {
  return pawn.GetEyePosition();
}

function canSee(viewer: CSPlayerPawn, target: CSPlayerPawn) {
  const ignoreEntity = [viewer, target];
  const from = eye(viewer);
  return [eye(target), add(target.GetAbsOrigin(), CHEST)].some(
    (end) => !Instance.TraceLine({ start: from, end, ignoreEntity }).didHit,
  );
}

function applySample(pawn: CSPlayerPawn, index: number) {
  const s = sampleAt(state.peek!, index);
  const angles = { pitch: 0, yaw: s.yaw, roll: 0 };
  if (settings.move === "move") {
    pawn.Move({ position: s.position, angles, velocity: s.velocity });
  } else if (settings.move === "teleport") {
    pawn.Teleport({ position: s.position, angles, velocity: s.velocity });
  } else if (distance(pawn.GetAbsOrigin(), s.position) > DRIFT_LIMIT) {
    pawn.Move({ position: s.position, angles, velocity: s.velocity });
  } else {
    pawn.Teleport({ angles, velocity: s.velocity });
  }
  pawn.SetEyeAngles({ pitch: s.pitch, yaw: s.yaw, roll: 0 });
}

function startRep() {
  const h = human();
  const b = bot();
  if (!state.peek || !state.holder) return tell("record a peek (!rec) and a holding spot (!hold) first");
  if (!h) return setPhase("gap", 0.5);
  if (!b) {
    tell("waiting for the bot to spawn");
    return setPhase("gap", 1);
  }
  setBotFrozen(true);
  h.Teleport({ position: state.holder.position, angles: state.holder.angles, velocity: ZERO });
  h.SetHealth(100);
  b.SetHealth(100);
  if (!b.FindWeapon("weapon_ak47")) b.GiveNamedItem("weapon_ak47", true);
  b.Teleport({ position: state.peek.samples[0]!.position, velocity: ZERO });
  applySample(b, 0);
  state.visibleAt = undefined;
  state.lastHitGroup = undefined;
  setPhase("waiting", randomBetween(settings.delayMin, settings.delayMax));
}

function endRep(result: string) {
  setBotFrozen(true);
  tell(result);
  if (settings.loop) setPhase("gap", 1);
  else setPhase("idle");
}

function fakeShot(b: CSPlayerPawn, h: CSPlayerPawn, now: number) {
  if (!canSee(b, h)) return;
  b.SetEyeAngles(lookAt(eye(b), eye(h)));
  state.nextShotAt = now + settings.fireInterval;
  if (Math.random() > settings.accuracy) return;
  const head = Math.random() < settings.headshotShare;
  h.TakeDamage({
    damage: head ? 111 : 27,
    damageTypes: CSDamageTypes.BULLET,
    attacker: b,
    inflictor: b,
    weapon: b.GetActiveWeapon(),
  });
}

function trackVisibility(b: CSPlayerPawn, h: CSPlayerPawn, now: number) {
  if (state.visibleAt !== undefined || !canSee(h, b)) return;
  state.visibleAt = now;
  state.nextShotAt = now + settings.reactMs / 1000;
}

function tick() {
  const now = Instance.GetGameTime();
  const h = human();
  const b = bot();

  if (state.phase === "armed" && h) {
    const samples = state.recorder.push(sampleOf(h));
    if (samples) {
      state.peek = { samples, tickInterval: TICK };
      setPhase("idle");
      tell(`recorded a peek: ${samples.length} ticks, ${round(samples.length * TICK, 2)} s`);
    }
  } else if (state.phase === "waiting" && now >= state.phaseEndsAt) {
    state.peekStartedAt = now;
    state.phase = "peeking";
  } else if (state.phase === "peeking" || state.phase === "fighting") {
    if (!b || !h) return endRep(b ? "you died" : "bot died");
    trackVisibility(b, h, now);
    if (state.phase === "peeking") {
      const index = ((now - state.peekStartedAt) / TICK) * settings.speed;
      applySample(b, index);
      if (index >= state.peek!.samples.length - 1) {
        setPhase("fighting", settings.fightSeconds);
        if (settings.shoot === "hybrid") setBotFrozen(false);
      }
    }
    if (settings.shoot === "fake" && state.visibleAt !== undefined && now >= state.nextShotAt) {
      fakeShot(b, h, now);
    }
    if (state.phase === "fighting" && now >= state.phaseEndsAt) endRep("bot survived");
  } else if (state.phase === "gap" && now >= state.phaseEndsAt) {
    if (settings.loop) startRep();
    else setPhase("idle");
  }
}

const help = [
  "!hold = holding spot, !rec = record a peek (swing out, then stop), !play / !loop / !stop",
  "!mode move|teleport|velocity, !shoot off|hybrid|fake, !speed 0.25-2",
  "!react <ms>, !acc <0-1>, !god on|off, !bot, !status, !dump",
];

const OVERLAY_X = 100;
const OVERLAY_Y = 420;
const LINE = 14;
const WHITE = { r: 255, g: 255, b: 255 };
const YELLOW = { r: 255, g: 220, b: 90 };
const GREY = { r: 190, g: 190, b: 190 };
let helpUntil = 0;

function phaseHint() {
  switch (state.phase) {
    case "armed":
      return state.recorder.recording ? "recording... stop moving to finish" : "armed: swing out like a peek, then stop";
    case "waiting":
    case "peeking":
    case "fighting":
    case "gap":
      return settings.loop ? "looping, !stop to end" : "playing";
    default:
      if (!state.holder) return "stand on your angle and type !hold";
      if (!state.peek) return "walk behind cover, type !rec and swing out";
      return "!play or !loop to start, !help for all commands";
  }
}

function drawOverlay(now: number) {
  const peek = state.peek ? `${state.peek.samples.length} ticks` : "none";
  const lines: [string, typeof WHITE][] = [
    [`defrag spike: ${phaseHint()}`, YELLOW],
    [
      `mode ${settings.move} | shoot ${settings.shoot} | speed ${settings.speed} | react ${settings.reactMs} ms | ` +
        `acc ${settings.accuracy} | god ${settings.god ? "on" : "off"} | hold ${state.holder ? "set" : "none"} | peek ${peek}`,
      GREY,
    ],
  ];
  if (now < helpUntil) for (const line of help) lines.push([line, WHITE]);
  for (const message of recentMessages(now, 8)) lines.push([message, WHITE]);
  lines.forEach(([text, color], i) => Instance.DebugScreenText({ text, x: OVERLAY_X, y: OVERLAY_Y + i * LINE, color }));
}

function schedule() {
  const now = Instance.GetGameTime();
  try {
    tick();
    flushChat(now);
    drawOverlay(now);
  } catch (error) {
    Console.Log(`[defrag] tick failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
  Instance.SetNextThink(now + TICK);
}

function status() {
  const peek = state.peek ? `${state.peek.samples.length} ticks` : "none";
  tell(
    `mode ${settings.move}, shoot ${settings.shoot}, speed ${settings.speed}, react ${settings.reactMs} ms, ` +
      `acc ${settings.accuracy}, god ${settings.god ? "on" : "off"}, peek ${peek}, hold ${state.holder ? "set" : "none"}`,
  );
}

function save() {
  Instance.SetSaveData(JSON.stringify({ holder: state.holder, peek: state.peek }));
}

function load() {
  try {
    const data = JSON.parse(Instance.GetSaveData() || "{}") as { holder?: Holder; peek?: Peek };
    state.holder = data.holder;
    state.peek = data.peek;
  } catch {
    Console.Log("[defrag] ignoring unreadable save data");
  }
}

function onCommand(name: string, args: string[]) {
  const h = human();
  const arg = args[0] ?? "";
  switch (name) {
    case "help":
      helpUntil = Instance.GetGameTime() + 15;
      return help.forEach(tell);
    case "hold":
      if (!h) return tell("spawn first");
      state.holder = { position: h.GetAbsOrigin(), angles: h.GetEyeAngles() };
      save();
      return tell("holding spot saved");
    case "rec":
      state.recorder = new Recorder();
      setPhase("armed");
      return tell("recording starts when you move and stops when you stop");
    case "play":
    case "loop":
      settings.loop = name === "loop";
      save();
      return startRep();
    case "stop":
      settings.loop = false;
      setBotFrozen(true);
      setPhase("idle");
      return tell("stopped");
    case "mode":
      if (!["move", "teleport", "velocity"].includes(arg)) return tell("mode: move, teleport or velocity");
      settings.move = arg as MoveMode;
      return status();
    case "shoot":
      if (!["off", "hybrid", "fake"].includes(arg)) return tell("shoot: off, hybrid or fake");
      settings.shoot = arg as ShootMode;
      return status();
    case "speed":
      settings.speed = Math.min(2, Math.max(0.25, Number(arg) || 1));
      return status();
    case "react":
      settings.reactMs = Math.max(0, Number(arg) || 250);
      return status();
    case "acc":
      settings.accuracy = Math.min(1, Math.max(0, Number(arg) || 0.35));
      return status();
    case "god":
      settings.god = arg !== "off";
      return status();
    case "bot":
      return addBot();
    case "dump":
      Console.Log(JSON.stringify({ holder: state.holder, peek: state.peek }));
      return tell("peek written to the console");
    case "status":
      return status();
  }
}

Instance.OnPlayerChat(({ player, text }) => {
  if (!player || player.IsBot()) return;
  const command = parseCommand(text);
  if (command) onCommand(command.name, command.args);
});

Instance.OnPlayerActivate(({ player }) => {
  if (player.IsBot()) return;
  setupServer();
  Instance.Delay(1).then(() => {
    ensureOneBot();
    tell("type !help for commands");
  });
});

Instance.OnModifyPlayerDamage((event) => {
  if (settings.god && event.player === human()) {
    return { damageFlags: event.damageFlags | CSDamageFlags.PREVENT_DEATH };
  }
  if (event.player === bot() && event.attacker === human()) state.lastHitGroup = event.hitGroup;
  return undefined;
});

Instance.OnPlayerDamage((event) => {
  if (event.player === human() && event.attacker === bot()) {
    tell(`bot hit you for ${event.damage}${event.hitGroup === CSHitGroup.HEAD ? " (head)" : ""}`);
  }
});

Instance.OnPlayerKill((event) => {
  const b = botController()?.GetPlayerPawn();
  if (event.player !== b || (state.phase !== "peeking" && state.phase !== "fighting")) return;
  const now = Instance.GetGameTime();
  const reaction = state.visibleAt === undefined ? "before it was visible" : `${Math.round((now - state.visibleAt) * 1000)} ms after it was visible`;
  const head = state.lastHitGroup === CSHitGroup.HEAD ? ", headshot" : "";
  endRep(`killed ${reaction}${head}`);
});

Instance.OnRoundStart(() => {
  setupServer();
  setPhase("idle");
});

load();
setupServer();
Instance.SetThink(schedule);
Instance.SetNextThink(Instance.GetGameTime() + TICK);
Instance.Delay(1).then(() => {
  if (!humanController()) return;
  ensureOneBot();
  tell("spike loaded, type !help for commands");
});
