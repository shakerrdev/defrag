import { context, build, type BuildOptions } from "esbuild";
import { readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = import.meta.dirname;
const outdir = join(root, "dist", "scripts");
const addonDir = process.env.CS2_ADDON_DIR ? resolve(process.env.CS2_ADDON_DIR) : undefined;
const watch = process.argv.includes("--watch");

const entryPoints = readdirSync(join(root, "src"))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => join(root, "src", name));

function copyToAddon(files: string[]) {
  if (!addonDir) return;
  const target = join(addonDir, "scripts");
  mkdirSync(target, { recursive: true });
  for (const file of files) {
    copyFileSync(file, join(target, file.slice(outdir.length + 1)));
  }
  console.log(`copied ${files.length} script(s) to ${target}`);
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
