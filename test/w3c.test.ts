/**
 * Conformance tests with the SPARQL 1.0, 1.1 and 1.2 test suites of the W3C
 * (https://github.com/w3c/rdf-tests, imported with scripts/import-w3c-tests.mjs).
 *
 * For every positive syntax/evaluation query:
 *  - it parses and formats,
 *  - formatting is idempotent,
 *  - formatting doesn't change the query (same syntax tree),
 *  - with comments inserted between all tokens, no comment is lost or reordered.
 *
 * Negative syntax tests must be rejected, except the ones that break rules the
 * formatter doesn't check (variable scoping, aggregates, blank node label reuse).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { format, isValid, tokenize, type FormatOptions } from "../src/index.ts";
import { structure } from "./helpers.ts";

interface W3cTest {
  file: string;
  name: string;
  type: string;
  positive: boolean;
  update: boolean;
  version: string;
}

const dir = new URL("./w3c/", import.meta.url);
const tests: W3cTest[] = JSON.parse(readFileSync(new URL("index.json", dir), "utf8"));
const read = (t: W3cTest) => readFileSync(new URL(t.file, dir), "utf8");

/** Negative tests about rules beyond the grammar: the formatter accepts these queries. */
const SEMANTIC_ONLY = new Set([
  "sparql10/syntax-sparql3/syn-blabel-cross-graph-bad.rq",
  "sparql10/syntax-sparql3/syn-blabel-cross-optional-bad.rq",
  "sparql10/syntax-sparql3/syn-blabel-cross-union-bad.rq",
  "sparql10/syntax-sparql4/syn-bad-34.rq",
  "sparql10/syntax-sparql4/syn-bad-35.rq",
  "sparql10/syntax-sparql4/syn-bad-36.rq",
  "sparql10/syntax-sparql4/syn-bad-37.rq",
  "sparql10/syntax-sparql4/syn-bad-38.rq",
  "sparql11/aggregates/agg08.rq",
  "sparql11/aggregates/agg09.rq",
  "sparql11/aggregates/agg10.rq",
  "sparql11/aggregates/agg11.rq",
  "sparql11/aggregates/agg12.rq",
  "sparql11/grouping/group06.rq",
  "sparql11/grouping/group07.rq",
  "sparql11/syntax-query/syn-bad-01.rq",
  "sparql11/syntax-query/syn-bad-02.rq",
  "sparql11/syntax-query/syn-bad-03.rq",
  "sparql11/syntax-query/syntax-BINDscope6.rq",
  "sparql11/syntax-query/syntax-BINDscope7.rq",
  "sparql11/syntax-query/syntax-BINDscope8.rq",
  "sparql11/syntax-query/syntax-SELECTscope2.rq",
  "sparql11/syntax-update-1/syntax-update-54.ru",
  "sparql12/syntax/duplicated-values-variable.rq",
  "sparql12/syntax/group-by-scope-bad-1.rq",
  "sparql12/syntax/group-by-scope-bad-2.rq",
  "sparql12/syntax/group-by-scope-bad-3.rq",
  "sparql12/syntax/nested-aggregate-functions.rq",
]);

/** Insert comments between the tokens of a query. */
function addComments(query: string, style: (i: number) => string): string {
  const tokens = tokenize(query).filter((t) => t.type !== "EOF");
  let out = "";
  let pos = 0;
  tokens.forEach((t, i) => {
    out += query.slice(pos, t.end);
    pos = t.end;
    const next = tokens[i + 1];
    // Don't split signed numbers (`-1` is a single token in SPARQL).
    const signed = /^[+-]$/.test(t.value) && next && /INTEGER|DECIMAL|DOUBLE/.test(next.type) && !next.spaceBefore;
    if (!signed) out += style(i);
  });
  return out + query.slice(pos);
}

const STYLES: Record<string, (i: number) => string> = {
  "own line": (i) => `\n# c${i}\n`,
  trailing: (i) => ` # c${i}\n`,
  mixed: (i) => [` # c${i}\n`, `\n\n# c${i}\n`, `\n# c${i}\n\n`, ` # c${i}\n\n\n# d${i}\n`, "\n\n", "", " "][i % 7],
};

const OPTION_SETS: FormatOptions[] = [
  { compact: true, lineWidth: 60 },
  { alignPredicates: false, indent: "\t", keywordCase: "lower", functionCase: "upper", preserveBlankLines: false },
  { lineWidth: 20, insertWhere: false },
];

function commentList(text: string): string[] {
  return text.match(/# [cd]\d+/g) ?? [];
}

for (const version of ["1.0", "1.1", "1.2"]) {
  describe(`W3C SPARQL ${version} test suite`, () => {
    const positive = tests.filter((t) => t.version === version && t.positive);
    const negative = tests.filter((t) => t.version === version && !t.positive);

    test(`${positive.length} positive tests: format, idempotency, meaning`, () => {
      for (const t of positive) {
        const query = read(t);
        const formatted = format(query);
        assert.equal(format(formatted), formatted, `not idempotent: ${t.file}`);
        assert.equal(structure(formatted), structure(query), `formatting changed ${t.file}`);
      }
    });

    for (const [name, style] of Object.entries(STYLES)) {
      test(`${positive.length} positive tests with comments (${name})`, () => {
        for (const t of positive) {
          const query = addComments(read(t), style);
          const formatted = format(query);
          assert.deepEqual(commentList(formatted), commentList(query), `comments moved in ${t.file}`);
          assert.equal(format(formatted), formatted, `not idempotent with comments: ${t.file}`);
          assert.equal(structure(formatted), structure(query), `formatting changed ${t.file}`);
        }
      });
    }

    for (const options of OPTION_SETS) {
      test(`${positive.length} positive tests with comments and options ${JSON.stringify(options)}`, () => {
        for (const t of positive) {
          const query = addComments(read(t), STYLES.mixed);
          const formatted = format(query, options);
          assert.deepEqual(commentList(formatted), commentList(query), `comments moved in ${t.file}`);
          assert.equal(format(formatted, options), formatted, `not idempotent: ${t.file}`);
          assert.equal(structure(formatted), structure(query), `formatting changed ${t.file}`);
          const plain = format(read(t), options);
          assert.equal(format(plain, options), plain, `not idempotent: ${t.file}`);
        }
      });
    }

    test(`${negative.length} negative tests are rejected`, () => {
      for (const t of negative) {
        const valid = isValid(read(t));
        if (SEMANTIC_ONLY.has(t.file)) assert.equal(valid, true, `now rejected (update SEMANTIC_ONLY): ${t.file}`);
        else assert.equal(valid, false, `should be rejected: ${t.file}`);
      }
    });
  });
}
