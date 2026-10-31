type Vector = { x: number; y: number; z: number };
type QAngle = { pitch: number; yaw: number; roll: number };

export const CSDamageFlags = { PREVENT_DEATH: 1 << 10 };
export const CSDamageTypes = { BULLET: 2 };
export const CSHitGroup = { GENERIC: 0, HEAD: 1, CHEST: 2 };

export class Entity {
  IsValid() { return true; }
}

export class CustomHudLayout extends Entity {
  vars = new Map<string, string>();
  classes = new Map<string, boolean>();
  SetDialogVariableString(panel: string, name: string, value: string) { this.vars.set(`${panel}.${name}`, value); }
  SetHasClass(panel: string, name: string, on?: boolean) { this.classes.set(`${panel}.${name}`, on ?? false); }
  SetHasClassForPlayer(_slot: number, panel: string, name: string, on?: boolean) { this.classes.set(`${panel}.${name}`, on ?? false); }
  capture = false;
  SetInputCaptureEnabled(_slot: number, on: boolean) { this.capture = on; }
}

export class Pawn {
  origin: Vector = { x: 0, y: 0, z: 0 };
  velocity: Vector = { x: 0, y: 0, z: 0 };
  eyes: QAngle = { pitch: 0, yaw: 0, roll: 0 };
  health = 100;
  alive = true;
  weapon = "weapon_glock";
  controller: Controller;
  constructor(controller: Controller) {
    this.controller = controller;
  }
  IsValid() { return true; }
  IsAlive() { return this.alive; }
  GetAbsOrigin() { return { ...this.origin }; }
  GetAbsVelocity() { return { ...this.velocity }; }
  GetEyePosition() { return { ...this.origin, z: this.origin.z + 64 }; }
  GetEyeAngles() { return { ...this.eyes }; }
  SetEyeAngles(a: QAngle) { this.eyes = { ...a }; }
  IsDucked() { return false; }
  Teleport(c: { position?: Vector; angles?: QAngle; velocity?: Vector }) { this.apply(c); }
  Move(c: { position?: Vector; angles?: QAngle; velocity?: Vector }) { this.apply(c); }
  private apply(c: { position?: Vector; angles?: QAngle; velocity?: Vector }) {
    if (c.position) this.origin = { ...c.position };
    if (c.velocity) this.velocity = { ...c.velocity };
    if (c.angles) this.eyes = { ...c.angles };
  }
  SetHealth(h: number) { this.health = h; }
  GetHealth() { return this.health; }
  SetArmor() {}
  DestroyWeapons() { this.weapon = ""; }
  GiveNamedItem(name: string, deploy?: boolean) { if (deploy) this.weapon = name; }
  GetActiveWeapon() { const name = this.weapon; return { GetData: () => ({ GetName: () => name }), GetOwner: () => this }; }
  FindWeapon() { return undefined; }
  TakeDamage(c: { damage: number; attacker?: Pawn }) { mock.hurt(this, c.damage, c.attacker, CSHitGroup.CHEST); }
}

export class Controller {
  pawn: Pawn;
  bot: boolean;
  team: number;
  constructor(bot: boolean, team: number) {
    this.bot = bot;
    this.team = team;
    this.pawn = new Pawn(this);
  }
  IsConnected() { return true; }
  IsBot() { return this.bot; }
  GetPlayerPawn() { return this.pawn; }
  GetTeamNumber() { return this.team; }
  GetPlayerSlot() { return this.bot ? 1 : 0; }
}

type Handlers = Record<string, ((e: any) => any)[]>;

export const mock = {
  time: 0,
  map: "de_mirage",
  save: "",
  log: [] as string[],
  commands: [] as string[],
  convars: new Map<string, unknown>(),
  controllers: [] as Controller[],
  handlers: {} as Handlers,
  think: undefined as (() => void) | undefined,
  nextThink: 0,
  wallBetween: false,
  entities: new Map<string, Entity>(),
  emit(name: string, event: unknown) {
    return (this.handlers[name] ?? []).map((h) => h(event));
  },
  hurt(victim: Pawn, damage: number, attacker: Pawn | undefined, hitGroup: number) {
    const [modified] = this.emit("ModifyPlayerDamage", { player: victim, damage, attacker, hitGroup, damageFlags: 0 });
    const prevent = (modified?.damageFlags ?? 0) & CSDamageFlags.PREVENT_DEATH;
    victim.health = Math.max(prevent ? 1 : 0, victim.health - damage);
    this.emit("PlayerDamage", { player: victim, damage, attacker, hitGroup });
    if (victim.health <= 0) {
      victim.alive = false;
      this.emit("PlayerKill", { player: victim, attacker });
    }
  },
  step(seconds: number) {
    const end = this.time + seconds;
    while (this.time < end) {
      this.time += 1 / 64;
      if (this.think && this.time >= this.nextThink) this.think();
      for (const t of [...timers]) if (this.time >= t.at) { timers.splice(timers.indexOf(t), 1); t.resolve(); }
    }
  },
  chat(text: string) {
    this.emit("PlayerChat", { player: this.controllers.find((c) => !c.bot), text });
  },
};

const timers: { at: number; resolve: () => void }[] = [];
const on = (name: string) => (cb: (e: any) => any) => { (mock.handlers[name] ??= []).push(cb); };

export const Instance = {
  GetGameTime: () => mock.time,
  GetMapName: () => mock.map,
  GetSaveData: () => mock.save,
  SetSaveData: (s: string) => { mock.save = s; },
  GetAllPlayerControllers: () => mock.controllers,
  TraceLine: () => ({ didHit: mock.wallBetween }),
  FindEntitiesByName: (name: string) => { const e = mock.entities.get(name); return e ? [e] : []; },
  DebugScreenText: () => {},
  SetThink: (f: () => void) => { mock.think = f; },
  SetNextThink: (t: number) => { mock.nextThink = t; },
  Delay: (s: number) => new Promise<void>((resolve) => timers.push({ at: mock.time + s, resolve })),
  OnPlayerChat: on("PlayerChat"),
  OnGunFire: on("GunFire"),
  OnModifyPlayerDamage: on("ModifyPlayerDamage"),
  OnPlayerDamage: on("PlayerDamage"),
  OnPlayerKill: on("PlayerKill"),
  OnPlayerActivate: on("PlayerActivate"),
  OnRoundStart: on("RoundStart"),
  OnCustomHudClicked: on("CustomHudClicked"),
};

export const Console = {
  Log: (s: string) => { mock.log.push(s); },
  ServerCommand: (s: string) => { mock.commands.push(s); },
  SetConvar: (n: string, v: unknown) => { mock.convars.set(n, v); },
  GetConvarString: (n: string) => String(mock.convars.get(n) ?? ""),
};
