// Smoke test of the built package: ESM, CommonJS, browser bundle and CLI.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import vm from "node:vm";

const query = "# find everything\nselect * where { graph ?g {\n# inside\n} ?s ?p ?o }";
const expected = "# find everything\nSELECT *\nWHERE {\n  GRAPH ?g {\n    # inside\n  }\n  ?s ?p ?o .\n}";

// ESM
const esm = await import("../dist/index.js");
assert.equal(esm.format(query), expected);
assert.equal(esm.spfmt.format(query), expected);
assert.equal(esm.default(query), expected);

// CommonJS
const require = createRequire(import.meta.url);
const cjs = require("../dist/index.cjs");
assert.equal(cjs.format(query), expected);
assert.equal(cjs.spfmt.format(query), expected);

// Browser bundle: window.spfmt
const sandbox = { window: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(new URL("../dist/spfmt.min.js", import.meta.url), "utf8"), sandbox);
assert.equal(sandbox.spfmt.format(query), expected);
assert.equal(sandbox.sparqlFormatter.format(query, { indent: 4 }).split("\n")[3], "    GRAPH ?g {");

// CLI
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim(), pkg.version);
assert.equal(execFileSync(process.execPath, [cli], { input: query, encoding: "utf8" }), `${expected}\n`);
const dir = mkdtempSync(join(tmpdir(), "spfmt-"));
const file = join(dir, "q.rq");
writeFileSync(file, query);
assert.equal(spawnSync(process.execPath, [cli, "--check", file]).status, 1);
execFileSync(process.execPath, [cli, "--write", file]);
assert.equal(readFileSync(file, "utf8"), `${expected}\n`);
assert.equal(spawnSync(process.execPath, [cli, "--check", file]).status, 0);
const bad = spawnSync(process.execPath, [cli], { input: "SELECT * {", encoding: "utf8" });
assert.equal(bad.status, 2);
assert.match(bad.stderr, /<stdin>:1:11: Expected/);

console.log("dist smoke test passed");
