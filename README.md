# defrag

A free CS2 Workshop map that gets close to Refrag's Crossfire mode: you hold an angle and bots peek you from real spots on real maps. The peeks are taken from demos, so the difficulty follows where they came from, from low-level FACEIT matches up to pro games.

The goal is 80–90% of the real thing, not a full clone.

## Status

Early. The first step is a spike that answers the one question the whole project depends on: can a map script move a bot along a recorded peek so it looks like a real player swinging out?

## How it will work

1. **Extract** duels from demos offline: the moment two players first see each other, who was holding, the peeker's path for the last 1–2 seconds and how fast and accurately they shot.
2. **Filter and group** them: drop fights with flashes, smokes, several enemies or trades; group by holding spot and peek route; keep a few of each.
3. **Pack** the scenarios per map and skill tier.
4. **Replay** them in the Workshop map: you stand on the holding spot, a bot runs the recorded peek and shoots back like the original player did.

## Layout

| Path | What |
| --- | --- |
| `addon/` | The Workshop addon's map scripts (TypeScript bundled to the JavaScript CS2 loads) |
| `packages/` | Shared code to come: the scenario format and the demo extractor |

Not in this repo, on purpose: decompiled official maps and other Valve assets, demos, and generated scenario packs. They stay local or go into releases.

## Setup

Needs Node 22.18+ and pnpm 10, plus CS2 with the Counter-Strike 2 Workshop Tools for running anything in game.

```sh
pnpm install
pnpm check
pnpm build:addon
```

Built scripts land in `addon/dist/scripts`. Set `CS2_ADDON_DIR` to your addon's content folder to have them copied there too, for example:

```sh
CS2_ADDON_DIR="C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/content/csgo_addons/defrag" pnpm watch:addon
```

Types for the `cs_script/point_script` module come from the community `v8_scripting` package, which tracks Valve's `point_script.d.ts`.
