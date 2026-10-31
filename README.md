# defrag

A free CS2 Workshop map that gets close to Refrag's Crossfire mode: you hold an angle and bots peek you from real spots on real maps. The peeks are taken from demos, so the difficulty follows where they came from, from low-level FACEIT matches up to pro games.

The goal is 80–90% of the real thing, not a full clone.

## Status

MVP, not tested in game yet. The spike proved scripted bot movement looks right; shooting back is still being tuned. What's there now:

- `crossfire` map script: plays scenario packs for the current map in weighted random order, you on the holding spot, the bot on the recorded peek, shooting back after the original player's reaction time. Kill/death/miss, reaction time, streaks, personal bests saved per map, four difficulties. You can also record your own peeks in game.
- `pnpm extract`: turns CS2 demos into scenario packs.
- The older `spike` script for experiments.

See [addon/README.md](addon/README.md) for playing it.

## How it will work

1. **Extract** duels from demos offline: the moment two players first see each other, who was holding, the peeker's path for the last 1–2 seconds and how fast and accurately they shot.
2. **Filter and group** them: drop fights with flashes, smokes, several enemies or trades; group by holding spot and peek route; keep a few of each.
3. **Pack** the scenarios per map and skill tier.
4. **Replay** them in the Workshop map: you stand on the holding spot, a bot runs the recorded peek and shoots back like the original player did.

## Layout

| Path | What |
| --- | --- |
| `addon/` | The Workshop addon's map scripts (TypeScript bundled to the JavaScript CS2 loads) |
| `packages/scenario` | The scenario pack format shared by the extractor and the map scripts |
| `packages/extract` | Demo → scenario pack extractor (`pnpm extract`, uses demoparser2) |
| `scenario-packs/` | Generated packs (`<map>.json`), bundled into the map script at build time together with the ones in `$CS2_ADDON_DIR/scenario-packs` (where the setup script keeps them); not committed |
| `demos/` | Put demos here for the setup script to extract; not committed |

Not in this repo, on purpose: decompiled official maps and other Valve assets, demos, and generated scenario packs. They stay local or go into releases.

## Quick setup (Windows)

Paste this into PowerShell:

```powershell
irm https://raw.githubusercontent.com/shakerrdev/defrag/main/tools/setup.ps1 | iex
```

or double-click `setup.cmd` in a clone. It finds CS2 through Steam, checks for the Workshop Tools, downloads the code (when not run from a clone), gets a private copy of Node and pnpm if needed, creates the `defrag` addon, extracts peeks into the addon's `scenario-packs` folder from demos in `demos/` (tier from `-Tier`, default `pro`) and from your own match replays in `game/csgo/replays` (tier `mid`), builds the map scripts with those packs into the addon (demos already in a pack are skipped, so reruns are quick), writes the `defrag` and `defrag_spike` console configs and offers to start the Workshop Tools. Run it again any time to update. `watch.cmd` does the same and then rebuilds on every save. Options: `-Cs2Path <folder>` if CS2 isn't found, `-Launch` to start the tools without asking.

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

Scenario packs:

```sh
pnpm extract --tier pro demos/*.dem     # writes scenario-packs/<map>.json, merging with what's there
pnpm build:addon                        # bundles every pack in scenario-packs/ into crossfire.js
```

The extractor takes the first damage between two players in a round as the duel, keeps it when one of them was holding still and the other was moving, and drops fights where the holder was looking more than 45° away from the peek, flashed fights, fights through or near smokes, airborne peeks and fights with a third player shooting. The peeker's path (about 1 s before first contact until they stop), weapon, reaction time (time from contact to their first shot) and hit rate become the scenario; peeks from the same spots are merged into one weighted scenario.

Types for the `cs_script/point_script` module come from the community `v8_scripting` package, which tracks Valve's `point_script.d.ts`.
