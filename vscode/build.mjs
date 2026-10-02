// Bundle the extension and the formatter sources into a single CommonJS file.
import { build } from "esbuild";

const production = process.argv.includes("--production");

await build({
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  external: ["vscode"],
  minify: production,
  sourcemap: !production,
  logLevel: "info",
});
