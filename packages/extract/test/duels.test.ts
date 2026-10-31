import { test } from "node:test";
import assert from "node:assert/strict";
import { cluster, findDuels, firstHurts, type DemoData, type PlayerState, type Track } from "../src/duels.ts";

const HURT_TICK = 1000;

function track(at: (tick: number) => Partial<PlayerState>, team: number): Track {
  const t: Track = new Map();
  for (let tick = HURT_TICK - 200; tick <= HURT_TICK + 100; tick++) {
    t.set(tick, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, alive: true, team, airborne: false, flash: 0, ...at(tick) });
  }
  return t;
}

function demo(overrides: Partial<DemoData> = {}, holderMoves = false): DemoData {
  const holder = track((t) => ({ x: holderMoves ? t * 4 : 0, y: 0, yaw: 90 }), 3);
  const peeker = track((t) => ({ x: Math.min(t, HURT_TICK) * 4 - 4000, y: 800, yaw: -90 }), 2);
  return {
    name: "m.dem",
    map: "de_mirage",
    tracks: new Map([
      ["holder", holder],
      ["peeker", peeker],
    ]),
    hurts: [{ tick: HURT_TICK, round: 3, attacker: "holder", victim: "peeker", weapon: "ak47", hitgroup: "head", health: 0 }],
    shots: [
      { tick: HURT_TICK - 2, player: "holder", weapon: "weapon_ak47" },
      { tick: HURT_TICK + 8, player: "peeker", weapon: "weapon_m4a1" },
    ],
    smokes: [],
    ...overrides,
  };
}

test("a clean peek becomes a scenario with the mover as peeker", () => {
  const { duels, rejected } = findDuels(demo());
  assert.deepEqual(rejected, {});
  assert.equal(duels.length, 1);
  const { scenario, peeker } = duels[0]!;
  assert.equal(peeker, "peeker");
  assert.deepEqual(scenario.holder.position, [0, 0, 0]);
  assert.equal(scenario.frames[scenario.contactFrame]![0], (HURT_TICK - 2) * 4 - 4000);
  assert.equal(scenario.weapon, "weapon_m4a1");
  assert.equal(scenario.reactMs, Math.round(180 + (10 * 1000) / 64));
  assert.equal(scenario.source?.holderWon, true);
});

test("rejects moving holders, smokes and flashes", () => {
  assert.equal(findDuels(demo({}, true)).duels.length, 0);
  const smoked = findDuels(demo({ smokes: [{ from: 0, to: 5000, x: -100, y: 400, z: 0 }] }));
  assert.deepEqual(smoked.rejected, { smoke: 1 });
  const flashed = demo();
  flashed.tracks.get("holder")!.get(HURT_TICK - 2)!.flash = 2;
  assert.deepEqual(findDuels(flashed).rejected, { flashed: 1 });
});

test("only the first damage between a pair per round counts, utility skipped", () => {
  const hurts = [
    { tick: 5, round: 1, attacker: "a", victim: "b", weapon: "ak47", hitgroup: "", health: 50 },
    { tick: 6, round: 1, attacker: "b", victim: "a", weapon: "ak47", hitgroup: "", health: 50 },
    { tick: 7, round: 2, attacker: "b", victim: "a", weapon: "hegrenade", hitgroup: "", health: 50 },
  ];
  assert.deepEqual(firstHurts(hurts).map((h) => h.tick), [5]);
});

test("cluster merges peeks from the same spots and weights them", () => {
  const s = findDuels(demo()).duels[0]!.scenario;
  const merged = cluster([s, { ...s, id: "b" }, { ...s, id: "c", holder: { ...s.holder, position: [5000, 0, 0] } }]);
  assert.deepEqual(merged.map((m) => m.weight).sort(), [1, 2]);
});
