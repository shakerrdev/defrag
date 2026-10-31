# addon

Map scripts for the defrag Workshop addon. Every `src/*.ts` file is one script; `pnpm build:addon` bundles each into `dist/scripts/<name>.js` (and into `$CS2_ADDON_DIR/maps/scripts/` when that is set, the same layout as Valve's `cs_script_demo` addon). The Workshop Tools compile each into `<name>.vjs_c`, and a `point_script` entity points at it as `maps/scripts/<name>.vjs`.

## Crossfire (the trainer)

`src/crossfire.ts` is the actual trainer. Load it with `exec defrag` (the setup writes that config) on a map you have scenarios for, then `!start`.

Each rep: you're put on the holding spot looking where the original player looked, the bot gets the original weapon and waits at the start of the recorded peek, then after a random 0.6–2 s it swings out along the real path. Once it can see you it waits the original player's reaction time (scaled by difficulty), turns onto you and shoots: in `assist` mode the bot's own AI pulls the trigger once the script's aim is on you and the scripted movement has stopped (real shots); if the AI hasn't fired within 0.25 s of the trigger opening, the script shoots for it (silent damage) so the bot never just stands there, in short bursts by range; each burst aims at your head or chest by the original player's headshot share and is pulled off target by a few degrees by their miss rate. You can't die (the damage is stopped at 1 HP), but going down to 1 HP ends the rep as a death.

Results: **kill** (with time since the bot became visible, headshot or not), **death**, or **miss** (bot alive 1.5 s after the peek ended). The overlay shows session kills, deaths, misses, streak, median and best reaction, plus your best reaction and streak on this map (kept in the addon's save data).

Scenarios come from `scenario-packs/*.json` bundled at build time (see the main README) plus your own recorded peeks.

| Command | What it does |
| --- | --- |
| `!start` / `!stop` / `!skip` | Run reps back to back / stop / next scenario |
| `!set 5–100` | A scored set of that many reps; at the end you get kills and median reaction, and the best set per size and map is saved |
| `!diff auto\|easy\|normal\|hard\|pro` | Bot reaction time, accuracy and peek speed (normal = as in the demo). `auto` (default) starts at normal and adapts: fast kills make the bot quicker and more accurate, deaths and misses back it off (level 0.5–2, saved) |
| `!focus on\|off` | Weight scenarios by how often you lose them (unplayed ones also come up more) |
| `!worst` | The three scenarios you lose most (at least 2 reps each) |
| `!gun rifle\|ak47\|m4a1_silencer\|m4a1\|awp\|deagle\|keep` | Weapon you get each rep (`rifle` = AK on T, M4A1-S on CT) |
| `!tier all\|pro\|high\|mid\|low\|custom` | Which scenarios to use |
| `!weapons all\|rifles\|pistols\|smgs\|snipers` | Only scenarios where the original peeker had that kind of weapon (your own peeks always count) |
| `!shoot assist\|fake\|off` | `assist`: real shots from the AI trigger (default). `fake`: silent scripted damage. `off`: bot never shoots |
| `!stats`, `!reset` | Session stats / reset them |
| `!packs` | Bundled packs and how many are for this map |
| `!check` | Traces from every holding spot to its peek at contact; scenarios without line of sight point to a map build that differs from the demo |
| `!hold`, `!rec`, `!custom [clear]` | Record your own peek: `!hold` on your angle, walk to the start, `!rec`, swing out and stop. Saved per map (up to 40) |
| `!menu` | Opens a clickable menu on the custom HUD (only in a map that places the `custom_hud_layout`: the game refuses to precache or spawn one from a script on official maps) (Start/Stop/Skip, difficulty, scenario tier, focus, shooting mode, your gun, reset); the mouse is captured while it's open |
| `!hud auto\|custom\|debug` | Where the status shows: the custom Panorama HUD (`panorama/layout/custom_game/defrag.xml`, precached and spawned by the script as a `custom_hud_layout`), the debug-text overlay, or both (`auto`, the default, because the script can't tell whether the layout actually rendered) |
| `!debug on\|off` | Logs the bot's shooting state to the console every ¼ s (seen you, reacting, aim error, trigger, shots) |
| `!help` | Commands on screen |

Before each rep the script traces from the holding spot to the peek at contact and skips scenarios that can't see each other (old demos on updated maps); `!check` re-runs that for all of them.

Untested in game so far: whether demo coordinates line up with the current map builds, whether demo spots are always standable, and how the assist bursts feel. `test/crossfire.test.ts` runs the script against a mocked script API to catch logic errors.

## Spike: can a script make a bot peek like a player?

`src/spike.ts` lets you record your own peek and then replays it on a bot while you hold the angle, with switches for the open questions:

- **Movement:** `move` (`Entity.Move`, keeps the client's interpolation), `teleport` (`Entity.Teleport` every tick) or `velocity` (sets only velocity and corrects drift over 24 units).
- **Shooting back:**
  - `fake`: after the reaction time the script turns the bot's aim smoothly onto you (max 15° per tick) and applies damage with a set hit chance. Silent: no sound, muzzle flash or tracer, because the API has no way to fire a weapon or play effects.
  - `assist`: the script aims (reaction time and smooth flick as in `fake`) while the bot is unfrozen with its AI trigger off (`bot_dont_shoot 1`); once the aim is on target and the bot is nearly stopped (under 60 u/s) the trigger is switched on and the AI fires real shots itself, in bursts by range (1 shot beyond 1200 units, 3 beyond 500, else 5) with a 0.35 s reset, since a script can't see or compensate recoil. Bots ignore `+attack` sent from a script, frozen or not, so a script can't fire a weapon directly.
  - `hybrid`: the bot is unfrozen for the peek and the game's bot AI aims and shoots for real, while the script keeps moving it along the recorded path.
  - `off`.

The bot stays frozen with `bot_stop 1` while the script moves it.

### Setting it up

Run the setup from the main README (`setup.cmd` or the PowerShell one-liner). It creates the `defrag` addon, builds the scripts into it, compiles them with the Workshop Tools' resource compiler and writes `game/csgo/cfg/defrag_spike.cfg`. Install the Workshop Tools first (or run the setup again after installing them), otherwise there is nothing to compile with and the game reports "Failed to load cs_script". Then:

1. Start **Counter-Strike 2 Workshop Tools** with the `defrag` addon.
2. Load a real map: `map de_dust2` in the console.
3. Join CT and run `exec defrag_spike`. It spawns a `point_script` running `maps/scripts/spike.vjs` (needs `sv_cheats 1`, which the config sets).
4. Chat should say `[defrag] spike loaded`; the script sets up the server and adds a bot on the other team.

If no message appears, spawning the script from the console doesn't work (that step is unverified). Use a map instead: in Hammer, open or make a map in the addon with a corner to peek around, T and CT spawns and a nav mesh (bots may not spawn without one), add a `point_script` entity with **cs_script** set to `maps/scripts/spike.vjs`, then build and run it (F9).

Manual alternative to the setup script: `pnpm install`, then `pnpm watch:addon` with `CS2_ADDON_DIR` set to the addon's content folder (`…/Counter-Strike Global Offensive/content/csgo_addons/defrag`).

With `watch.cmd` (or `pnpm watch:addon`) running, saving a script rebuilds it and the tools reload it in the running map.

### Using it

| Command | What it does |
| --- | --- |
| `!hold` | Saves where you stand and look as the holding spot |
| `!rec` | Arms recording: it starts when you move and stops once you've stood still for ¼ s |
| `!play` / `!loop` / `!stop` | Runs the peek once / repeatedly with a random 0.4–1.6 s delay / stops |
| `!mode move\|teleport\|velocity` | Movement method |
| `!shoot fake\|assist\|hybrid\|off` | How the bot shoots back |
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
