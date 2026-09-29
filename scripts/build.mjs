// Build: type declarations (tsc) + ESM, CommonJS and browser bundles (esbuild).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, rmSync, chmodSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const banner = `/*! ${pkg.name} v${pkg.version} | ${pkg.license} | ${pkg.homepage} */`;

rmSync("dist", { recursive: true, force: true });

// Type declarations only; the JavaScript comes from esbuild.
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--emitDeclarationOnly"], {
  stdio: "inherit",
});

const common = { bundle: true, sourcemap: true, target: "es2020", logLevel: "info", legalComments: "inline" };

await Promise.all([
  build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/index.js", format: "esm", platform: "neutral" }),
  build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/index.cjs", format: "cjs", platform: "node" }),
  // Browser build exposing `window.spfmt`, like the original sparql-formatter
  build({
    ...common,
    entryPoints: ["src/browser.ts"],
    outfile: "dist/spfmt.min.js",
    format: "iife",
    platform: "browser",
    minify: true,
    banner: { js: banner },
  }),
  build({
    ...common,
    entryPoints: ["src/cli.ts"],
    outfile: "dist/cli.js",
    format: "esm",
    platform: "node",
    target: "node18",
    banner: { js: "#!/usr/bin/env node" },
    define: { __VERSION__: JSON.stringify(pkg.version) },
  }),
]);

chmodSync("dist/cli.js", 0o755);

// The sources import each other with `.ts` extensions; the declarations must point at `.js`.
for (const file of readdirSync("dist").filter((f) => f.endsWith(".d.ts"))) {
  const path = `dist/${file}`;
  writeFileSync(path, readFileSync(path, "utf8").replace(/(from\s+["']\.\/[\w-]+)\.ts(["'])/g, "$1.js$2"));
}
