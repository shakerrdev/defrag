import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

type Value =
  | { type: "string" | "bool" | "int" | "float" | "vector3" | "qangle" | "uint64"; value: string }
  | { type: "string_array" | "int_array"; value: string[] }
  | { type: "element_array"; value: Element[] }
  | { type: "element"; value: Element };

export type Element = { className: string; attributes: [string, Value][] };

const str = (value: string): Value => ({ type: "string", value });
const bool = (value: boolean): Value => ({ type: "bool", value: value ? "1" : "0" });
const int = (value: number): Value => ({ type: "int", value: String(value) });
const vec = (x = 0, y = 0, z = 0): Value => ({ type: "vector3", value: `${x} ${y} ${z}` });
const angle = (): Value => ({ type: "qangle", value: "0 0 0" });
const element = (value: Element): Value => ({ type: "element", value });
const elements = (value: Element[] = []): Value => ({ type: "element_array", value });
const strings = (value: string[] = []): Value => ({ type: "string_array", value });
const ints = (value: string[] = []): Value => ({ type: "int_array", value });

let nextNodeId = 1;

function node(className: string, extra: [string, Value][], children: Element[] = []): Element {
  return {
    className,
    attributes: [
      ["origin", vec()],
      ["angles", angle()],
      ["scales", vec(1, 1, 1)],
      ["nodeID", int(nextNodeId++)],
      ["children", elements(children)],
      ["editorOnly", bool(false)],
      ["force_hidden", bool(false)],
      ["transformLocked", bool(false)],
      ["variableTargetKeys", strings()],
      ["variableNames", strings()],
      ...extra,
    ],
  };
}

function entityExtras(properties: Record<string, string>): [string, Value][] {
  return [
    [
      "relayPlugData",
      element({
        className: "DmePlugList",
        attributes: [
          ["names", strings()],
          ["dataTypes", ints()],
          ["plugTypes", ints()],
          ["descriptions", strings()],
        ],
      }),
    ],
    ["connectionsData", elements()],
    ["entity_properties", element({ className: "EditGameClassProps", attributes: Object.entries(properties).map(([k, v]) => [k, str(v)]) })],
  ];
}

function entity(properties: Record<string, string>, origin = vec()): Element {
  const e = node("CMapEntity", [...entityExtras(properties), ["hitNormal", vec(0, 0, 1)], ["isProceduralEntity", bool(false)]]);
  e.attributes[0] = ["origin", origin];
  return e;
}

export type MapOptions = { prefab: string; script?: string; layout?: string };

export function wrapperMap(options: MapOptions): Element {
  nextNodeId = 1;
  const prefab = node("CMapPrefab", [
    ["fixupEntityNames", bool(false)],
    ["loadAtRuntime", bool(false)],
    ["loadIfNested", bool(true)],
    ["targetMapPath", str(options.prefab)],
    ["targetName", str("")],
  ]);
  const script = entity({ classname: "point_script", targetname: "defrag", cs_script: options.script ?? "maps/scripts/crossfire.vjs" }, vec(0, 0, 64));
  const hud = entity(
    { classname: "custom_hud_layout", targetname: "defrag_hud", layout: options.layout ?? "panorama/layout/custom_game/defrag.vxml" },
    vec(32, 0, 64),
  );
  const world = node(
    "CMapWorld",
    [...entityExtras({ classname: "worldspawn" }), ["nextDecalID", int(0)], ["fixupEntityNames", bool(true)], ["mapUsageType", str("standard")]],
    [prefab, script, hud],
  );
  return {
    className: "CMapRootElement",
    attributes: [
      ["isprefab", bool(false)],
      ["editorbuild", int(8600)],
      ["editorversion", int(400)],
      ["showgrid", bool(true)],
      ["snaprotationangle", int(15)],
      ["gridspacing", { type: "float", value: "64" }],
      ["show3dgrid", bool(true)],
      ["itemFile", str("")],
      ["defaultcamera", element({ className: "CStoredCamera", attributes: [["position", vec(0, -1000, 1000)], ["lookat", vec()]] })],
      ["3dcameras", element({ className: "CStoredCameras", attributes: [["activecamera", int(-1)], ["cameras", elements()]] })],
      ["world", element(world)],
      ["visibility", element(node("CVisibilityMgr", [["nodes", elements()], ["hiddenFlags", ints()]]))],
      [
        "mapVariables",
        element({
          className: "CMapVariableSet",
          attributes: [
            ["variableNames", strings()],
            ["variableValues", strings()],
            ["variableTypeNames", strings()],
            ["variableTypeParameters", strings()],
            ["m_ChoiceGroups", elements()],
          ],
        }),
      ],
      [
        "rootSelectionSet",
        element({
          className: "CMapSelectionSet",
          attributes: [
            ["children", elements()],
            ["selectionSetName", str("")],
            ["selectionSetData", element({ className: "CObjectSelectionSetDataElement", attributes: [["selectedObjects", elements()]] })],
          ],
        }),
      ],
      ["m_ReferencedMeshSnapshots", elements()],
      ["m_bIsCordoning", bool(false)],
      ["m_bCordonsVisible", bool(false)],
      ["nodeInstanceData", elements()],
    ],
  };
}

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function writeElement(e: Element, indent: string, out: string[]) {
  out.push(`${indent}${quote(e.className)}`, `${indent}{`);
  const inner = indent + "\t";
  out.push(`${inner}"id" "elementid" ${quote(randomUUID())}`);
  for (const [name, v] of e.attributes) {
    if (v.type === "element") {
      out.push(`${inner}${quote(name)} ${quote(v.value.className)}`);
      writeBody(v.value, inner, out);
    } else if (v.type === "element_array") {
      out.push(`${inner}${quote(name)} "element_array"`, `${inner}[`);
      v.value.forEach((child, i) => {
        writeElement(child, inner + "\t", out);
        if (i < v.value.length - 1) out[out.length - 1] += ",";
      });
      out.push(`${inner}]`);
    } else if (v.type === "string_array" || v.type === "int_array") {
      out.push(`${inner}${quote(name)} ${quote(v.type)}`, `${inner}[`);
      v.value.forEach((s, i) => out.push(`${inner}\t${quote(s)}${i < v.value.length - 1 ? "," : ""}`));
      out.push(`${inner}]`);
    } else {
      out.push(`${inner}${quote(name)} ${quote(v.type)} ${quote(v.value)}`);
    }
  }
  out.push(`${indent}}`);
}

function writeBody(e: Element, indent: string, out: string[]) {
  const start = out.length;
  writeElement(e, indent, out);
  out.splice(start, 1);
}

export function toKeyValues2(root: Element) {
  const out = ["<!-- dmx encoding keyvalues2 4 format vmap 29 -->"];
  writeElement(root, "", out);
  return out.join("\n") + "\n";
}

function usage(): never {
  console.log("usage: node tools/make-map.ts --prefab maps/de_ancient.vmap --out <addon content>/maps/defrag_de_ancient.vmap");
  process.exit(1);
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { prefab: { type: "string" }, out: { type: "string" } } });
  if (!values.prefab || !values.out) usage();
  const out = resolve(values.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toKeyValues2(wrapperMap({ prefab: values.prefab })));
  console.log(`wrote ${out} (prefab ${values.prefab} + crossfire script + HUD)`);
}
