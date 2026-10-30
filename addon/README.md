# addon

Map scripts for the defrag Workshop addon. Every `src/*.ts` file is one script; `pnpm build:addon` bundles each into `dist/scripts/<name>.js` (and into `$CS2_ADDON_DIR/scripts/` when that is set). In Hammer a `point_script` entity points at it as `scripts/<name>.vjs`.

## Spike: can a script make a bot peek like a player?

`src/spike.ts` lets you record your own peek and then replays it on a bot while you hold the angle, with switches for the open questions:

- **Movement:** `move` (`Entity.Move`, keeps the client's interpolation), `teleport` (`Entity.Teleport` every tick) or `velocity` (sets only velocity and corrects drift over 24 units).
- **Shooting back:** `fake` (the script aims and applies damage after a reaction time, with a set accuracy), `hybrid` (the game's bot AI takes over after the swing via `bot_stop 0`) or `off`.

The bot stays frozen with `bot_stop 1` while the script moves it.

### Setting it up

Run the setup from the main README (`setup.cmd` or the PowerShell one-liner). It creates the `defrag` addon, builds the scripts into it and writes `game/csgo/cfg/defrag_spike.cfg`. Then:

1. Start **Counter-Strike 2 Workshop Tools** with the `defrag` addon.
2. Load a real map: `map de_dust2` in the console.
3. Join CT and run `exec defrag_spike`. It spawns a `point_script` running `scripts/spike.vjs` (needs `sv_cheats 1`, which the config sets).
4. Chat should say `[defrag] spike loaded`; the script sets up the server and adds a bot on the other team.

If no message appears, spawning the script from the console doesn't work (that step is unverified). Use a map instead: in Hammer, open or make a map in the addon with a corner to peek around, T and CT spawns and a nav mesh (bots may not spawn without one), add a `point_script` entity with **cs_script** set to `scripts/spike.vjs`, then build and run it (F9).

Manual alternative to the setup script: `pnpm install`, then `pnpm watch:addon` with `CS2_ADDON_DIR` set to the addon's content folder (`…/Counter-Strike Global Offensive/content/csgo_addons/defrag`).

With `watch.cmd` (or `pnpm watch:addon`) running, saving a script rebuilds it and the tools reload it in the running map.

### Using it

| Command | What it does |
| --- | --- |
| `!hold` | Saves where you stand and look as the holding spot |
| `!rec` | Arms recording: it starts when you move and stops once you've stood still for ¼ s |
| `!play` / `!loop` / `!stop` | Runs the peek once / repeatedly with a random 0.4–1.6 s delay / stops |
| `!mode move\|teleport\|velocity` | Movement method |
| `!shoot off\|hybrid\|fake` | How the bot shoots back |
| `!speed 0.25–2` | Playback speed |
| `!react <ms>`, `!acc <0–1>` | Reaction time and hit chance per shot in `fake` mode |
| `!god on\|off` | God mode keeps you alive (on by default) |
| `!bot`, `!status`, `!dump`, `!help` | Re-add the bot, show settings, print the peek JSON to the console, list commands |

A typical round: stand on the angle you want to hold, `!hold`, walk behind cover, `!rec`, swing out and stop, then `!loop` and play against it. Each kill reports the time since the bot first became visible and whether it was a headshot. The recording and holding spot are saved with the addon's save data.

### What to look for

- Does the bot animate (run, strafe, stop) or slide? Which movement mode looks closest to a real peek from the holding spot?
- Is it smooth on your screen, or does it jitter or lag behind?
- `hybrid`: does the bot shoot right after the swing, and does it stay put or run off?
- `fake`: does the damage register cleanly, and how much do the missing shot sound and tracer hurt?
- Do the reaction times look plausible?
- Ducking can't be forced from a script, so recorded crouch-peeks play standing.
