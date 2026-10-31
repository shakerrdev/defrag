import { Console, CustomHudLayout, Instance, type CSPrecache } from "cs_script/point_script";

const NAME = "defrag_hud";
const LAYOUT = "panorama/layout/custom_game/defrag.vxml";
const STYLE = "panorama/styles/custom_game/defrag.vcss";
const ROOT = "defrag";

export type HudFields = { title: string; info: string; session: string; result: string; good: boolean; messages: string };

let layout: CustomHudLayout | undefined;
let spawnTried = false;
const last = new Map<string, string>();

function find(): CustomHudLayout | undefined {
  if (layout?.IsValid()) return layout;
  const found = Instance.FindEntitiesByName(NAME)[0];
  layout = found instanceof CustomHudLayout ? found : undefined;
  last.clear();
  return layout;
}

export function spawnHud() {
  if (find() || spawnTried) return;
  spawnTried = true;
  let precache: CSPrecache | undefined;
  try {
    precache = Instance.Precache({ resources: [LAYOUT, STYLE] });
  } catch (error) {
    Console.Log(`[defrag] precaching the HUD layout failed: ${error instanceof Error ? error.message : error}`);
  }
  const create = () => Console.ServerCommand(`ent_create custom_hud_layout { "targetname" "${NAME}" "layout" "${LAYOUT}" }`);
  if (!precache) return create();
  const waitUntil = Instance.GetGameTime() + 5;
  const poll = () => {
    if (precache!.IsServerLoaded() || Instance.GetGameTime() > waitUntil) return create();
    Instance.Delay(0.1).then(poll);
  };
  poll();
}

export function hudAvailable() {
  return find() !== undefined;
}

function set(hud: CustomHudLayout, key: string, value: string) {
  if (last.get(key) === value) return;
  last.set(key, value);
  hud.SetDialogVariableString(ROOT, key, value);
}

function setClass(hud: CustomHudLayout, panel: string, name: string, on: boolean) {
  const key = `${panel}.${name}`;
  const value = String(on);
  if (last.get(key) === value) return;
  last.set(key, value);
  hud.SetHasClass(panel, name, on);
}

export function drawHud(fields: HudFields) {
  const hud = find();
  if (!hud) return false;
  set(hud, "title", fields.title);
  set(hud, "info", fields.info);
  set(hud, "session", fields.session);
  set(hud, "messages", fields.messages);
  if (fields.result) set(hud, "result", fields.result);
  setClass(hud, "result", "Hidden", !fields.result);
  setClass(hud, "result", "Good", fields.good);
  setClass(hud, "card", "Hidden", false);
  return true;
}

export function hideHud() {
  const hud = find();
  if (hud) setClass(hud, "card", "Hidden", true);
}

export function setMenuOpen(playerSlot: number, open: boolean) {
  const hud = find();
  if (!hud) return false;
  hud.SetHasClassForPlayer(playerSlot, "menu", "Hidden", !open);
  hud.SetInputCaptureEnabled(playerSlot, open);
  return true;
}

export function setMenuText(values: Record<string, string>) {
  const hud = find();
  if (!hud) return;
  for (const [key, value] of Object.entries(values)) set(hud, key, value);
}

export function isHud(entity: unknown) {
  return entity !== undefined && entity === find();
}
