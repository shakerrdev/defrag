import { test } from "node:test";
import assert from "node:assert/strict";
import { HEADER, toBinaryDmx, wrapperMap } from "../make-map.ts";

type Parsed = { type: string; attrs: Map<string, unknown> };

function parse(buf: Buffer) {
  let p = buf.indexOf(0) + 1;
  const header = buf.subarray(0, p - 1).toString();
  const i32 = () => ((p += 4), buf.readInt32LE(p - 4));
  const cstr = () => {
    const end = buf.indexOf(0, p);
    const s = buf.subarray(p, end).toString("utf8");
    p = end + 1;
    return s;
  };
  let table: string[] = [];
  const value = (t: number, inline: boolean): unknown => {
    if (t >= 32) {
      const n = i32();
      return Array.from({ length: n }, () => value(t - 32, true));
    }
    switch (t) {
      case 1:
        return { ref: i32() };
      case 2:
        return i32();
      case 3:
        return (p += 4), buf.readFloatLE(p - 4);
      case 4:
        return buf[p++];
      case 5:
        return inline ? cstr() : table[i32()];
      case 10:
      case 12:
        return [0, 1, 2].map(() => ((p += 4), buf.readFloatLE(p - 4)));
      case 15:
        return (p += 8), buf.readBigUInt64LE(p - 8);
      default:
        throw new Error(`type ${t} at ${p}`);
    }
  };
  const prefix = new Map<string, unknown>();
  for (let i = i32(); i > 0; i--) for (let a = i32(); a > 0; a--) prefix.set(cstr(), value(buf[p++]!, true));
  table = Array.from({ length: i32() }, cstr);
  const elements: Parsed[] = Array.from({ length: i32() }, () => {
    const type = table[i32()]!;
    i32();
    p += 16;
    return { type, attrs: new Map() };
  });
  for (const e of elements) for (let a = i32(); a > 0; a--) e.attrs.set(table[i32()]!, value(buf[p++]!, false));
  return { header, prefix, elements, end: p };
}

test("the wrapper map is binary DMX the way Hammer saves vmaps, with the prefab, script and HUD", () => {
  const buf = toBinaryDmx(wrapperMap({ prefab: "maps/de_ancient.vmap" }));
  const { header, prefix, elements, end } = parse(buf);
  assert.equal(header, HEADER);
  assert.equal(end, buf.length);
  assert.deepEqual(prefix.get("map_asset_references"), ["maps/de_ancient.vmap"]);
  assert.equal(elements[0]!.type, "CMapRootElement");
  assert.equal(elements[1]!.type, "$prefix_element$");
  const root = elements[0]!.attrs;
  const world = elements[(root.get("world") as { ref: number }).ref]!;
  assert.equal(world.type, "CMapWorld");
  assert.equal(world.attrs.get("nodeID"), 1);
  assert.ok(root.has("visbility"));
  const children = (world.attrs.get("children") as { ref: number }[]).map((c) => elements[c.ref]!);
  assert.deepEqual(children.map((c) => c.type), ["CMapPrefab", "CMapEntity", "CMapEntity"]);
  assert.equal(children[0]!.attrs.get("targetMapPath"), "maps/de_ancient.vmap");
  const props = children.slice(1).map((c) => elements[(c.attrs.get("entity_properties") as { ref: number }).ref]!.attrs);
  assert.equal(props[0]!.get("classname"), "point_script");
  assert.equal(props[0]!.get("cs_script"), "maps/scripts/crossfire.vjs");
  assert.equal(props[1]!.get("classname"), "custom_hud_layout");
  assert.equal(props[1]!.get("layout"), "panorama/layout/custom_game/defrag.vxml");
});
