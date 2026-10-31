import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { Frame, Pack } from "@defrag/scenario";
import { Controller, CustomHudLayout, mock } from "./mock/point_script.ts";

const mockPath = join(import.meta.dirname, "mock", "point_script.ts");

const frames: Frame[] = Array.from({ length: 60 }, (_, i) => [-400 + i * 4, 600, 0, -90, 0, 0]);
const pack: Pack = {
  version: 1,
  map: "de_mirage",
  name: "fixture",
  scenarios: [
    {
      id: "fixture-1",
      map: "de_mirage",
      tier: "pro",
      holder: { position: [0, 0, 0], yaw: 90, pitch: 0 },
      frames,
      contactFrame: 50,
      reactMs: 200,
      accuracy: 1,
      headshotShare: 1,
      weapon: "weapon_ak47",
      weight: 1,
    },
  ],
};

const human = new Controller(false, 3);
const bot = new Controller(true, 2);

before(async () => {
  const outfile = join(mkdtempSync(join(tmpdir(), "defrag-")), "crossfire.mjs");
  await build({
    entryPoints: [join(import.meta.dirname, "..", "src", "crossfire.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    logLevel: "silent",
    plugins: [
      {
        name: "mocks",
        setup(b) {
          b.onResolve({ filter: /^cs_script\/point_script$/ }, () => ({ path: pathToFileURL(mockPath).href, external: true }));
          b.onResolve({ filter: /^defrag:packs$/ }, () => ({ path: "packs", namespace: "packs" }));
          b.onLoad({ filter: /.*/, namespace: "packs" }, () => ({ contents: `export default ${JSON.stringify([pack])}`, loader: "js" }));
        },
      },
    ],
  });
  mock.controllers = [human, bot];
  mock.save = JSON.stringify({ holder: { spike: true } });
  await import(pathToFileURL(outfile).href);
  mock.step(1.5);
});

test("loads, keeps one bot frozen and greets", () => {
  assert.ok(mock.commands.includes("bot_stop 1"));
  assert.ok(mock.log.some((l) => l.includes("crossfire loaded: 1 scenarios on de_mirage")));
});

test("a rep puts you on the holding spot and the bot peeks along the recording", () => {
  mock.chat("!start");
  assert.deepEqual(human.pawn.origin, { x: 0, y: 0, z: 0 });
  assert.equal(human.pawn.eyes.yaw, 90);
  assert.equal(bot.pawn.origin.x, -400);
  assert.equal(bot.pawn.weapon, "weapon_ak47");
  mock.step(3);
  assert.ok(bot.pawn.origin.x > -400, "bot moved");
  assert.ok(mock.commands.includes("bot_stop 0"), "assist mode unfreezes the bot");
});

test("killing the bot records a kill with a reaction time and a best", () => {
  mock.hurt(bot.pawn, 200, human.pawn, 1);
  const result = mock.log.find((l) => l.startsWith("[defrag] headshot in"));
  assert.ok(result, mock.log.join("\n"));
  assert.match(result, /new best/);
  const save = JSON.parse(mock.save).crossfire;
  assert.equal(typeof save.bests.de_mirage.reactMs, "number");
  assert.equal(save.bests.de_mirage.streak, 1);
  assert.deepEqual(JSON.parse(mock.save).holder, { spike: true }, "the spike's save data is kept");
});

test("fake shooting can kill you, which ends the rep as a death", () => {
  bot.pawn.alive = true;
  bot.pawn.health = 100;
  mock.chat("!shoot fake");
  mock.step(1.2);
  mock.step(4);
  assert.ok(mock.log.some((l) => /\[defrag\] you (died|got headshot)/.test(l)), mock.log.slice(-10).join("\n"));
  assert.ok(human.pawn.alive, "god mode keeps you alive");
});

test("custom peeks can be recorded in game", () => {
  mock.chat("!stop");
  mock.chat("!hold");
  mock.chat("!rec");
  for (let i = 0; i < 40; i++) {
    human.pawn.origin = { x: i * 4, y: 0, z: 0 };
    human.pawn.velocity = { x: 256, y: 0, z: 0 };
    mock.step(1 / 64);
  }
  human.pawn.velocity = { x: 0, y: 0, z: 0 };
  mock.step(0.5);
  const save = JSON.parse(mock.save).crossfire;
  assert.equal(save.custom.de_mirage.length, 1);
  assert.equal(save.custom.de_mirage[0].tier, "custom");
});

test("the custom HUD gets the overlay text when its layout entity exists", () => {
  assert.ok(mock.commands.some((c) => c.startsWith("ent_create custom_hud_layout")));
  const hud = new CustomHudLayout();
  mock.entities.set("defrag_hud", hud);
  mock.step(0.1);
  assert.match(hud.vars.get("defrag.title") ?? "", /^defrag crossfire \| de_mirage/);
  assert.match(hud.vars.get("defrag.session") ?? "", /kills/);
  assert.match(hud.vars.get("defrag.info") ?? "", /scenarios/);
  assert.equal(hud.classes.get("card.Hidden"), false);
});
