import { context, build, type BuildOptions } from "esbuild";
import { compact, type Pack } from "@defrag/scenario";
import { readdirSync, mkdirSync, copyFileSync, existsSync, readFileSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";

const root = import.meta.dirname;
const outdir = join(root, "dist", "scripts");
const addonDir = process.env.CS2_ADDON_DIR ? resolve(process.env.CS2_ADDON_DIR) : undefined;
const watch = process.argv.includes("--watch");

const packsDir = resolve(process.env.DEFRAG_PACKS_DIR ?? join(root, "..", "scenario-packs"));

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
        b.onResolve({ filter: /^defrag:packs$/ }, () => ({ path: packsDir, namespace: "scenario-packs" }));
        b.onLoad({ filter: /.*/, namespace: "scenario-packs" }, () => {
          const files = existsSync(packsDir) ? readdirSync(packsDir).filter((f) => f.endsWith(".json")) : [];
          const packs = files.map((f) => {
            const pack = JSON.parse(readFileSync(join(packsDir, f), "utf8")) as Pack;
            return { ...pack, scenarios: pack.scenarios.map(compact) };
          });
          console.log(`bundling ${packs.length} scenario pack(s), ${packs.reduce((n, p) => n + p.scenarios.length, 0)} scenarios, from ${packsDir}`);
          return {
            contents: `export default ${JSON.stringify(packs)};`,
            loader: "js",
            watchDirs: existsSync(packsDir) ? [packsDir] : [],
            watchFiles: files.map((f) => join(packsDir, f)),
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
