import { test, describe } from "node:test";
import assert from "node:assert/strict";
import defaultFormat, { format, formatAst, parse, spfmt, tokenize } from "../src/index.ts";

describe("API", () => {
  test("default export is format", () => {
    assert.equal(defaultFormat, format);
  });

  test("parse + formatAst", () => {
    const ast = parse("SELECT * { ?s ?p ?o }");
    assert.equal(ast.type, "Query");
    assert.equal(formatAst(ast), "SELECT *\nWHERE {\n  ?s ?p ?o .\n}");
    assert.equal(parse("CLEAR ALL").type, "Update");
  });

  test("tokenize attaches comments to tokens", () => {
    const tokens = tokenize("# lead\nSELECT # trail\n*");
    assert.equal(tokens[0].value, "SELECT");
    assert.deepEqual(
      tokens[0].leading.map((c) => c.text),
      ["# lead"],
    );
    assert.equal(tokens[0].trailing?.text, "# trail");
    assert.equal(tokens.at(-1)?.type, "EOF");
  });

  test("spfmt is compatible with sparql-formatter", () => {
    assert.equal(spfmt.format("select * where {?s ?p ?o}"), "SELECT *\nWHERE {\n  ?s ?p ?o .\n}");
    assert.equal(spfmt.format("select * where {?s ?p ?o}", "default", 4), "SELECT *\nWHERE {\n    ?s ?p ?o .\n}");
    assert.equal(spfmt.format("ASK { OPTIONAL { ?s ?p ?o } }", "compact"), "ASK {\n  OPTIONAL { ?s ?p ?o }\n}");
    assert.throws(() => spfmt.format("select * {}", "turtle" as "default"), /Unsupported formatting mode/);
  });
});
