import { context, build, type BuildOptions } from "esbuild";
import { compact, type Pack } from "@defrag/scenario";
import { readdirSync, mkdirSync, copyFileSync, existsSync, readFileSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";

const root = import.meta.dirname;
const outdir = join(root, "dist", "scripts");
const addonDir = process.env.CS2_ADDON_DIR ? resolve(process.env.CS2_ADDON_DIR) : undefined;
const watch = process.argv.includes("--watch");

const packsDirs = [
  resolve(process.env.DEFRAG_PACKS_DIR ?? join(root, "..", "scenario-packs")),
  ...(process.env.CS2_ADDON_DIR ? [join(resolve(process.env.CS2_ADDON_DIR), "scenario-packs")] : []),
];

function readPacks() {
  const byMap = new Map<string, Pack>();
  const files: string[] = [];
  for (const dir of packsDirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const file = join(dir, name);
      files.push(file);
      const pack = JSON.parse(readFileSync(file, "utf8")) as Pack;
      const seen = byMap.get(pack.map);
      if (!seen) {
        byMap.set(pack.map, pack);
        continue;
      }
      const ids = new Set(seen.scenarios.map((s) => s.id));
      seen.scenarios.push(...pack.scenarios.filter((s) => !ids.has(s.id)));
    }
  }
  return { packs: [...byMap.values()], files };
}

const entryPoints = readdirSync(join(root, "src"))
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
  .map((name) => join(root, "src", name));

function copyToAddon(files: string[]) {
  if (!addonDir) return;
  const target = join(addonDir, "maps", "scripts");
  mkdirSync(target, { recursive: true });
  for (const file of files) {
    copyFileSync(file, join(target, file.slice(outdir.length + 1)));
  }
  console.log(`copied ${files.length} script(s) to ${target}`);
  cpSync(join(root, "panorama"), join(addonDir, "panorama"), { recursive: true });
  console.log(`copied the HUD layout to ${join(addonDir, "panorama")}`);
}

const options: BuildOptions = {
  entryPoints,
  outdir,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["cs_script/point_script"],
  metafile: true,
  logLevel: "info",
  plugins: [
    {
      name: "scenario-packs",
      setup(b) {
        b.onResolve({ filter: /^defrag:packs$/ }, () => ({ path: "packs", namespace: "scenario-packs" }));
        b.onLoad({ filter: /.*/, namespace: "scenario-packs" }, () => {
          const { packs, files } = readPacks();
          const count = packs.reduce((n, p) => n + p.scenarios.length, 0);
          console.log(`bundling ${count} scenarios on ${packs.length} map(s) from ${packsDirs.join(", ")}`);
          return {
            contents: `export default ${JSON.stringify(packs.map((p) => ({ ...p, demos: undefined, scenarios: p.scenarios.map(compact) })))};`,
            loader: "js",
            watchDirs: packsDirs.filter((d) => existsSync(d)),
            watchFiles: files,
          };
        });
      },
    },
    {
      name: "copy-to-addon",
      setup(b) {
        b.onEnd((result) => {
          if (result.errors.length || !result.metafile) return;
          copyToAddon(Object.keys(result.metafile.outputs).map((file) => resolve(file)));
        });
      },
    },
  ],
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
