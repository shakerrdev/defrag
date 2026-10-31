import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const TEXT_FILES = /\.(vmdl|vmat|vsnap)$/;

export function references(text: string, map: string) {
  const pattern = new RegExp(`maps/${map}/[A-Za-z0-9_\\-./]+\\.(?:vmdl|vmat|dmx|png|tga|vtex|vsnap|vmesh)`, "g");
  return new Set(text.match(pattern) ?? []);
}

export type Fix = { moved: number; missing: string[]; collisions: string[] };

export function fixDecompile(content: string, map: string): Fix {
  const maps = join(content, "maps");
  const pending = [join(maps, `${map}.vmap`)];
  const wanted = new Map<string, string>();
  const collisions: string[] = [];
  const scanned = new Set<string>();

  const scan = (file: string) => {
    if (scanned.has(file) || !existsSync(file)) return;
    scanned.add(file);
    for (const ref of references(readFileSync(file, "latin1"), map)) {
      const name = basename(ref);
      const known = wanted.get(name);
      if (known && known !== ref) collisions.push(`${name}: ${known} vs ${ref}`);
      if (!known) {
        wanted.set(name, ref);
        if (TEXT_FILES.test(name)) pending.push(join(maps, name), join(content, ref));
      }
    }
  };
  while (pending.length) scan(pending.pop()!);

  let moved = 0;
  const missing: string[] = [];
  for (const [name, ref] of wanted) {
    const target = join(content, ref);
    const flat = join(maps, name);
    if (existsSync(target)) continue;
    if (!existsSync(flat) || !statSync(flat).isFile()) {
      missing.push(ref);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    renameSync(flat, target);
    moved++;
  }
  return { moved, missing, collisions };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { content: { type: "string" }, map: { type: "string" } } });
  if (!values.content || !values.map) {
    console.log("usage: node tools/fix-decompile.ts --content <addon content folder> --map de_ancient");
    process.exit(1);
  }
  const content = resolve(values.content);
  const result = fixDecompile(content, values.map);
  const left = readdirSync(join(content, "maps")).filter((f) => /\.(vmdl|dmx|vmat|png)$/.test(f)).length;
  console.log(`moved ${result.moved} decompiled file(s) into maps/${values.map}/, ${result.missing.length} referenced file(s) not found, ${left} loose file(s) left in maps/`);
  for (const ref of result.missing.slice(0, 10)) console.log(`  missing ${ref}`);
  for (const c of result.collisions.slice(0, 10)) console.log(`  same file name for two paths: ${c}`);
}
