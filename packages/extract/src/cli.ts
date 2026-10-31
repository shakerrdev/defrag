#!/usr/bin/env node
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { FORMAT_VERSION, packProblems, TIERS, type Pack, type Scenario, type Tier } from "@defrag/scenario";
import { candidateTicks, cluster, DEFAULT_OPTIONS, findDuels, type DemoData, type Hurt, type PlayerState, type Rejection, type Track } from "./duels.ts";

const parser = createRequire(import.meta.url)("@laihoe/demoparser2") as typeof import("@laihoe/demoparser2");

type Row = Record<string, unknown>;

const PROPS = ["X", "Y", "Z", "yaw", "pitch", "is_alive", "team_num", "is_airborne", "flash_duration"];

export function loadDemo(path: string): DemoData {
  const header = parser.parseHeader(path) as { map_name: string };
  const hurtRows = parser.parseEvent(path, "player_hurt", [], ["total_rounds_played"]) as Row[];
  const hurts: Hurt[] = hurtRows.map((r) => ({
    tick: r.tick as number,
    round: (r.total_rounds_played as number) ?? 0,
    attacker: (r.attacker_steamid as string) ?? "",
    victim: r.user_steamid as string,
    weapon: (r.weapon as string) ?? "",
    hitgroup: (r.hitgroup as string) ?? "",
    health: (r.health as number) ?? 100,
  }));
  const shots = (parser.parseEvent(path, "weapon_fire") as Row[]).map((r) => ({
    tick: r.tick as number,
    player: r.user_steamid as string,
    weapon: r.weapon as string,
  }));
  const smokeRows = parser.parseEvents(path, ["smokegrenade_detonate", "smokegrenade_expired"]) as Row[];
  const expiries = new Map<unknown, number>();
  for (const r of smokeRows) if (r.event_name === "smokegrenade_expired") expiries.set(r.entityid, r.tick as number);
  const smokes = smokeRows
    .filter((r) => r.event_name === "smokegrenade_detonate")
    .map((r) => ({
      from: r.tick as number,
      to: expiries.get(r.entityid) ?? (r.tick as number) + 18 * 64,
      x: r.x as number,
      y: r.y as number,
      z: r.z as number,
    }));

  const ticks = candidateTicks(hurts);
  const tracks = new Map<string, Track>();
  if (ticks.length) {
    for (const r of parser.parseTicks(path, PROPS, ticks) as Row[]) {
      const id = r.steamid as string;
      if (!tracks.has(id)) tracks.set(id, new Map());
      const state: PlayerState = {
        x: r.X as number,
        y: r.Y as number,
        z: r.Z as number,
        yaw: r.yaw as number,
        pitch: r.pitch as number,
        alive: r.is_alive as boolean,
        team: r.team_num as number,
        airborne: r.is_airborne as boolean,
        flash: (r.flash_duration as number) ?? 0,
      };
      if (state.alive) tracks.get(id)!.set(r.tick as number, state);
    }
  }
  return { name: basename(path), map: header.map_name, tracks, hurts, shots, smokes };
}

function usage(): never {
  console.log(`usage: defrag-extract [--tier ${TIERS.join("|")}] [--out dir (default: scenario-packs/ in the repo)] [--no-cluster] <demo.dem...>

Finds 1v1 peeks in CS2 demos and writes scenario packs (one <map>.json per map) for the defrag addon.
Existing packs in --out are merged (same scenario id = replaced).`);
  process.exit(1);
}

export function isCs2Demo(path: string) {
  try {
    const fd = openSync(path, "r");
    const head = Buffer.alloc(8);
    readSync(fd, head, 0, 8, 0);
    closeSync(fd);
    return head.toString("latin1") === "PBDEMS2\0";
  } catch {
    return false;
  }
}

function readPack(file: string, map: string): Pack {
  if (!existsSync(file)) return { version: FORMAT_VERSION, map, name: map, scenarios: [] };
  return JSON.parse(readFileSync(file, "utf8")) as Pack;
}

export function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      tier: { type: "string", default: "pro" },
      out: { type: "string", default: join(import.meta.dirname, "..", "..", "..", "scenario-packs") },
      "no-cluster": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help || !positionals.length) usage();
  const tier = values.tier as Tier;
  if (!TIERS.includes(tier)) usage();

  const out = resolve(values.out);
  const byMap = new Map<string, Scenario[]>();
  const readDemos = new Map<string, string[]>();
  const rejected: Partial<Record<Rejection, number>> = {};
  for (const path of positionals) {
    const started = Date.now();
    const name = basename(path);
    let map: string;
    if (!isCs2Demo(resolve(path))) {
      console.error(`${name}: not a CS2 demo, skipped`);
      process.exitCode = 1;
      continue;
    }
    try {
      map = (parser.parseHeader(resolve(path)) as { map_name: string }).map_name;
    } catch (error) {
      console.error(`${name}: can't read it (${error instanceof Error ? error.message : error}), skipped`);
      process.exitCode = 1;
      continue;
    }
    if (!values.force && readPack(join(out, `${map}.json`), map).demos?.includes(name)) {
      console.log(`${name} (${map}): already extracted, skipped (--force to redo)`);
      continue;
    }
    let demo: DemoData;
    try {
      demo = loadDemo(resolve(path));
    } catch (error) {
      console.error(`${name}: parsing failed (${error instanceof Error ? error.message : error}), skipped`);
      process.exitCode = 1;
      continue;
    }
    readDemos.set(map, [...(readDemos.get(map) ?? []), name]);
    const result = findDuels(demo, { ...DEFAULT_OPTIONS, tier });
    for (const [why, n] of Object.entries(result.rejected)) rejected[why as Rejection] = (rejected[why as Rejection] ?? 0) + n;
    byMap.set(demo.map, [...(byMap.get(demo.map) ?? []), ...result.duels.map((d) => d.scenario)]);
    console.log(`${basename(path)} (${demo.map}): ${result.duels.length} duels in ${Date.now() - started} ms`);
  }
  console.log(`rejected: ${JSON.stringify(rejected)}`);

  mkdirSync(out, { recursive: true });
  for (const [map, found] of byMap) {
    const file = join(out, `${map}.json`);
    const pack = readPack(file, map);
    const merged = new Map(pack.scenarios.map((s) => [s.id, s]));
    for (const s of values["no-cluster"] ? found : cluster(found)) merged.set(s.id, s);
    pack.scenarios = [...merged.values()];
    pack.demos = [...new Set([...(pack.demos ?? []), ...(readDemos.get(map) ?? [])])];
    const problems = packProblems(pack);
    if (problems.length) {
      console.error(`${map}: ${problems.length} problem(s), first: ${problems[0]}`);
      process.exitCode = 1;
    }
    writeFileSync(file, JSON.stringify(pack));
    console.log(`${file}: ${pack.scenarios.length} scenarios`);
  }
}

if (import.meta.main) main();
