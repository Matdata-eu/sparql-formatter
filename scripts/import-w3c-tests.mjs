// Copies the SPARQL 1.1 and 1.2 syntax (and evaluation) test queries from a
// checkout of https://github.com/w3c/rdf-tests into test/w3c, with an index.
//
// Usage: node scripts/import-w3c-tests.mjs <path-to-rdf-tests>
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("Usage: node scripts/import-w3c-tests.mjs <path-to-rdf-tests>");
const out = new URL("../test/w3c/", import.meta.url).pathname;

const POSITIVE = new Set([
  "PositiveSyntaxTest",
  "PositiveSyntaxTest11",
  "PositiveUpdateSyntaxTest",
  "PositiveUpdateSyntaxTest11",
  "QueryEvaluationTest",
  "UpdateEvaluationTest",
  "CSVResultFormatTest",
]);
const NEGATIVE = new Set([
  "NegativeSyntaxTest",
  "NegativeSyntaxTest11",
  "NegativeUpdateSyntaxTest",
  "NegativeUpdateSyntaxTest11",
]);

function* manifests(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* manifests(p);
    else if (name === "manifest.ttl") yield p;
  }
}

rmSync(out, { recursive: true, force: true });
const tests = [];
const seen = new Set();
for (const version of ["sparql10", "sparql11", "sparql12"]) {
  for (const manifest of manifests(join(root, "sparql", version))) {
    const text = readFileSync(manifest, "utf8");
    // Split into statements: each test description starts with its subject at the start of a line.
    const blocks = text.split(/\n(?=[:<][^\s]*\s)/);
    for (const block of blocks) {
      const m = /^(\S+)[\s\S]*?(?:rdf:type|\sa)\s+mf:(\w+)/.exec(block.trim());
      if (!m) continue;
      const type = m[2];
      const positive = POSITIVE.has(type);
      if (!positive && !NEGATIVE.has(type)) continue;
      const file = /(?:mf:action|qt:query|ut:request)\s+<([^>]+\.(?:rq|ru))>/.exec(block)?.[1];
      if (!file) continue;
      const src = join(dirname(manifest), file);
      if (!existsSync(src)) continue;
      const rel = relative(join(root, "sparql"), src);
      if (seen.has(rel)) continue;
      seen.add(rel);
      mkdirSync(dirname(join(out, rel)), { recursive: true });
      copyFileSync(src, join(out, rel));
      const update = /Update/.test(type) || file.endsWith(".ru");
      tests.push({
        file: rel,
        name: m[1].replace(/^:/, ""),
        type,
        positive,
        update,
        version: { sparql10: "1.0", sparql11: "1.1", sparql12: "1.2" }[version],
      });
    }
  }
}
tests.sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(join(out, "index.json"), JSON.stringify(tests, null, 1) + "\n");
console.log(`Imported ${tests.length} tests (${tests.filter((t) => t.positive).length} positive)`);
