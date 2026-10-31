import { test } from "node:test";
import assert from "node:assert/strict";
import { toKeyValues2, wrapperMap } from "../make-map.ts";

test("the wrapper map is balanced keyvalues2 with the prefab, script and HUD", () => {
  const text = toKeyValues2(wrapperMap({ prefab: "maps/de_ancient.vmap" }));
  assert.match(text, /^<!-- dmx encoding keyvalues2 4 format vmap 29 -->\n"CMapRootElement"\n\{/);
  assert.equal((text.match(/\{/g) ?? []).length, (text.match(/\}/g) ?? []).length);
  assert.equal((text.match(/\[/g) ?? []).length, (text.match(/\]/g) ?? []).length);
  assert.match(text, /"targetMapPath" "string" "maps\/de_ancient.vmap"/);
  assert.match(text, /"classname" "string" "point_script"/);
  assert.match(text, /"cs_script" "string" "maps\/scripts\/crossfire.vjs"/);
  assert.match(text, /"layout" "string" "panorama\/layout\/custom_game\/defrag.vxml"/);
  assert.match(text, /"world" "CMapWorld"\n\t\{\n\t\t"id" "elementid" "[0-9a-f-]{36}"/);
  const ids = text.match(/"id" "elementid" "[^"]+"/g) ?? [];
  assert.equal(new Set(ids).size, ids.length);
});
