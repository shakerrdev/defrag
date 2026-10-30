# defrag

A free CS2 Workshop map that gets close to Refrag's Crossfire mode: you hold an angle and bots peek you from real spots on real maps. The peeks are taken from demos, so the difficulty follows where they came from, from low-level FACEIT matches up to pro games.

The goal is 80–90% of the real thing, not a full clone.

## Status

Early. The first step is a spike that answers the one question the whole project depends on: can a map script move a bot along a recorded peek so it looks like a real player swinging out? It's ready to try in game: see [addon/README.md](addon/README.md).

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

## Quick setup (Windows)

Paste this into PowerShell:

```powershell
irm https://raw.githubusercontent.com/shakerrdev/defrag/main/tools/setup.ps1 | iex
```

or double-click `setup.cmd` in a clone. It finds CS2 through Steam, checks for the Workshop Tools, downloads the code (when not run from a clone), gets a private copy of Node and pnpm if needed, creates the `defrag` addon, builds the map scripts into it, writes a `defrag_spike` console config and offers to start the Workshop Tools. Run it again any time to update. `watch.cmd` does the same and then rebuilds on every save. Options: `-Cs2Path <folder>` if CS2 isn't found, `-Launch` to start the tools without asking.

## Development setup

Needs Node 22.18+ and pnpm 10, plus CS2 with the Counter-Strike 2 Workshop Tools for running anything in game.

```sh
pnpm install
pnpm check
pnpm test
pnpm build:addon
```

Built scripts land in `addon/dist/scripts`. Set `CS2_ADDON_DIR` to your addon's content folder to have them copied there too, for example:

```sh
CS2_ADDON_DIR="C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/content/csgo_addons/defrag" pnpm watch:addon
```

Types for the `cs_script/point_script` module come from the community `v8_scripting` package, which tracks Valve's `point_script.d.ts`.
