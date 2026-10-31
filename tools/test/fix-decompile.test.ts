import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixDecompile, references } from "../fix-decompile.ts";

test("references finds the map's own asset paths in binary and text", () => {
  const text = "\0maps/de_x/worldnodes/a_draw0.vmdl\0materials/other.vmat\0maps/de_x/_vrf/p/rock.vmat\0";
  assert.deepEqual([...references(text, "de_x")], ["maps/de_x/worldnodes/a_draw0.vmdl", "maps/de_x/_vrf/p/rock.vmat"]);
});

test("flattened decompiler output is moved to the paths the map and models reference", () => {
  const content = mkdtempSync(join(tmpdir(), "defrag-fix-"));
  const maps = join(content, "maps");
  mkdirSync(maps);
  writeFileSync(join(maps, "de_x.vmap"), "\0maps/de_x/worldnodes/a_draw0.vmdl\0maps/de_x/_vrf/p/rock.vmat\0maps/de_x/entities/gone.vmdl\0");
  writeFileSync(join(maps, "a_draw0.vmdl"), 'filename = "maps/de_x/worldnodes/a_meshset_0.dmx"');
  writeFileSync(join(maps, "a_meshset_0.dmx"), "mesh");
  writeFileSync(join(maps, "rock.vmat"), 'TextureColor "maps/de_x/_vrf/p/rock.png"');
  writeFileSync(join(maps, "rock.png"), "png");

  const result = fixDecompile(content, "de_x");
  assert.equal(result.moved, 4);
  assert.deepEqual(result.missing, ["maps/de_x/entities/gone.vmdl"]);
  assert.equal(readFileSync(join(maps, "de_x/worldnodes/a_meshset_0.dmx"), "utf8"), "mesh");
  assert.ok(existsSync(join(maps, "de_x/_vrf/p/rock.png")));
  assert.ok(!existsSync(join(maps, "a_draw0.vmdl")));
  assert.equal(fixDecompile(content, "de_x").moved, 0);
});
