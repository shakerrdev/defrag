import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

export const HEADER = "<!-- dmx encoding binary 9 format vmap 40 -->\n";

export const T = {
  element: 1,
  int: 2,
  float: 3,
  bool: 4,
  string: 5,
  vector3: 10,
  qangle: 12,
  uint64: 15,
  elementArray: 33,
  intArray: 34,
  stringArray: 37,
} as const;

export type Value =
  | { t: typeof T.element; v: Element | null }
  | { t: typeof T.int | typeof T.float | typeof T.bool; v: number }
  | { t: typeof T.string; v: string }
  | { t: typeof T.vector3 | typeof T.qangle; v: [number, number, number] }
  | { t: typeof T.uint64; v: bigint }
  | { t: typeof T.elementArray; v: Element[] }
  | { t: typeof T.intArray; v: number[] }
  | { t: typeof T.stringArray; v: string[] };

export type Element = { type: string; name: string; attributes: [string, Value][] };

const el = (v: Element | null): Value => ({ t: T.element, v });
const els = (v: Element[] = []): Value => ({ t: T.elementArray, v });
const int = (v: number): Value => ({ t: T.int, v });
const float = (v: number): Value => ({ t: T.float, v });
const bool = (v: boolean): Value => ({ t: T.bool, v: v ? 1 : 0 });
const str = (v: string): Value => ({ t: T.string, v });
const vec = (x = 0, y = 0, z = 0): Value => ({ t: T.vector3, v: [x, y, z] });
const ang = (): Value => ({ t: T.qangle, v: [0, 0, 0] });
const u64 = (v: bigint): Value => ({ t: T.uint64, v });
const strs = (v: string[] = []): Value => ({ t: T.stringArray, v });
const ints = (v: number[] = []): Value => ({ t: T.intArray, v });

const element = (type: string, attributes: [string, Value][], name = ""): Element => ({ type, name, attributes });

const referenceId = () => randomBytes(8).readBigUInt64LE();

function nodeAttributes(children: Element[], origin = vec(), reference = true): [string, Value][] {
  return [
    ["nodeID", int(0)],
    ["referenceID", u64(reference ? referenceId() : 0n)],
    ["children", els(children)],
    ["variableTargetKeys", strs()],
    ["variableNames", strs()],
    ["origin", origin],
    ["angles", ang()],
    ["scales", vec(1, 1, 1)],
    ["transformLocked", bool(false)],
    ["force_hidden", bool(false)],
    ["editorOnly", bool(false)],
  ];
}

function entityAttributes(properties: Record<string, string>): [string, Value][] {
  return [
    [
      "relayPlugData",
      el(element("DmePlugList", [
        ["names", strs()],
        ["dataTypes", ints()],
        ["plugTypes", ints()],
        ["descriptions", strs()],
      ])),
    ],
    ["connectionsData", els()],
    ["entity_properties", el(element("EditGameClassProps", Object.entries(properties).map(([k, v]) => [k, str(v)])))],
  ];
}

function entity(properties: Record<string, string>, origin: Value): Element {
  return element("CMapEntity", [
    ...nodeAttributes([], origin),
    ...entityAttributes(properties),
    ["hitNormal", vec(0, 0, 1)],
    ["isProceduralEntity", bool(false)],
  ]);
}

export type MapOptions = { prefab: string; script?: string; layout?: string };

export function wrapperMap(options: MapOptions): { root: Element; prefix: [string, Value][] } {
  const visibility = element("CVisibilityMgr", [...nodeAttributes([], vec(), false), ["nodes", els()], ["hiddenFlags", ints()]]);
  const prefab = element("CMapPrefab", [
    ...nodeAttributes([]),
    ["fixupEntityNames", bool(false)],
    ["loadAtRuntime", bool(false)],
    ["loadIfNested", bool(true)],
    ["targetMapPath", str(options.prefab)],
    ["targetName", str("")],
  ]);
  const script = entity(
    { classname: "point_script", targetname: "defrag", cs_script: options.script ?? "maps/scripts/crossfire.vjs" },
    vec(0, 0, 64),
  );
  const hud = entity(
    { classname: "custom_hud_layout", targetname: "defrag_hud", layout: options.layout ?? "panorama/layout/custom_game/defrag.vxml" },
    vec(32, 0, 64),
  );
  const world = element("CMapWorld", [
    ...nodeAttributes([prefab, script, hud], vec(), false),
    ...entityAttributes({ classname: "worldspawn", targetname: "" }),
    ["nextDecalID", int(0)],
    ["fixupEntityNames", bool(true)],
    ["mapUsageType", str("standard")],
  ]);
  [visibility, world, prefab, script, hud].forEach((node, id) => setAttribute(node, "nodeID", int(id)));
  const root = element("CMapRootElement", [
    ["isprefab", bool(false)],
    ["editorbuild", int(10112)],
    ["editorversion", int(400)],
    ["itemFile", str("")],
    ["defaultcamera", el(element("CStoredCamera", [["position", vec(0, -1000, 1000)], ["lookat", vec()]]))],
    ["3dcameras", el(element("CStoredCameras", [["activecamera", int(-1)], ["cameras", els()]]))],
    ["world", el(world)],
    ["visbility", el(visibility)],
    [
      "mapVariables",
      el(element("CMapVariableSet", [
        ["variableNames", strs()],
        ["variableValues", strs()],
        ["variableTypeNames", strs()],
        ["variableTypeParameters", strs()],
        ["m_ChoiceGroups", els()],
        ["variableEditorOverrides", strs()],
      ])),
    ],
    [
      "rootSelectionSet",
      el(element("CMapSelectionSet", [["children", els()], ["selectionSetName", str("")], ["selectionSetData", el(null)], ["setType", int(0)]])),
    ],
    ["m_ReferencedMeshSnapshots", els()],
    ["m_bIsCordoning", bool(false)],
    ["m_bCordonsVisible", bool(false)],
    ["nodeInstanceData", els()],
    ["showgrid", bool(true)],
    ["snaprotationangle", int(15)],
    ["gridspacing", float(64)],
    ["show3dgrid", bool(true)],
  ]);
  const prefix: [string, Value][] = [["map_asset_references", strs([options.prefab])]];
  return { root, prefix };
}

function setAttribute(e: Element, name: string, value: Value) {
  const at = e.attributes.findIndex(([n]) => n === name);
  if (at >= 0) e.attributes[at] = [name, value];
  else e.attributes.push([name, value]);
}

class Writer {
  private chunks: Buffer[] = [];
  bytes(b: Buffer) {
    this.chunks.push(b);
  }
  u8(v: number) {
    this.bytes(Buffer.from([v]));
  }
  i32(v: number) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v);
    this.bytes(b);
  }
  f32(v: number) {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v);
    this.bytes(b);
  }
  u64(v: bigint) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(v);
    this.bytes(b);
  }
  cstr(s: string) {
    this.bytes(Buffer.from(s + "\0", "utf8"));
  }
  done() {
    return Buffer.concat(this.chunks);
  }
}

function collect(root: Element, extra: Element[]) {
  const order: Element[] = [];
  const seen = new Set<Element>();
  const visit = (e: Element) => {
    if (seen.has(e)) return;
    seen.add(e);
    order.push(e);
    for (const [, v] of e.attributes) {
      if (v.t === T.element && v.v) visit(v.v);
      if (v.t === T.elementArray) v.v.forEach(visit);
    }
  };
  visit(root);
  for (const e of extra) visit(e);
  return order;
}

export function toBinaryDmx({ root, prefix }: { root: Element; prefix: [string, Value][] }): Buffer {
  const prefixElement = element("$prefix_element$", prefix);
  const all = collect(root, [prefixElement]);
  const ordered = [root, prefixElement, ...all.filter((e) => e !== root && e !== prefixElement)];
  const index = new Map(ordered.map((e, i) => [e, i]));

  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const intern = (s: string) => {
    let i = stringIndex.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      stringIndex.set(s, i);
    }
    return i;
  };
  intern("CMapRootElement");
  intern("");
  intern("$prefix_attribute$");
  for (const e of ordered) {
    intern(e.type);
    intern(e.name);
    for (const [name, v] of e.attributes) {
      intern(name);
      if (v.t === T.string) intern(v.v);
    }
  }

  const w = new Writer();
  w.cstr(HEADER);
  w.i32(1);
  w.i32(prefix.length);
  for (const [name, v] of prefix) {
    w.cstr(name);
    writeValue(w, v, true);
  }
  w.i32(strings.length);
  for (const s of strings) w.cstr(s);
  w.i32(ordered.length);
  for (const e of ordered) {
    w.i32(intern(e.type));
    w.i32(intern(e.name));
    w.bytes(randomBytes(16));
  }
  for (const e of ordered) {
    w.i32(e.attributes.length);
    for (const [name, v] of e.attributes) {
      w.i32(intern(name));
      writeValue(w, v, false);
    }
  }
  return w.done();

  function writeValue(out: Writer, v: Value, inline: boolean) {
    out.u8(v.t);
    switch (v.t) {
      case T.element:
        return out.i32(v.v ? index.get(v.v)! : -1);
      case T.int:
        return out.i32(v.v);
      case T.float:
        return out.f32(v.v);
      case T.bool:
        return out.u8(v.v);
      case T.string:
        return inline ? out.cstr(v.v) : out.i32(intern(v.v));
      case T.vector3:
      case T.qangle:
        return v.v.forEach((n) => out.f32(n));
      case T.uint64:
        return out.u64(v.v);
      case T.elementArray:
        out.i32(v.v.length);
        return v.v.forEach((child) => out.i32(index.get(child)!));
      case T.intArray:
        out.i32(v.v.length);
        return v.v.forEach((n) => out.i32(n));
      case T.stringArray:
        out.i32(v.v.length);
        return v.v.forEach((s) => out.cstr(s));
    }
  }
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
  writeFileSync(out, toBinaryDmx(wrapperMap({ prefab: values.prefab })));
  console.log(`wrote ${out} (prefab ${values.prefab} + crossfire script + HUD)`);
}
