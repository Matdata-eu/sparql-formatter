import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { format, isValid, SparqlSyntaxError } from "../src/index.ts";

function error(query: string): SparqlSyntaxError {
  try {
    format(query);
  } catch (e) {
    assert.ok(e instanceof SparqlSyntaxError, `expected a SparqlSyntaxError, got ${e}`);
    return e;
  }
  assert.fail(`expected a syntax error for: ${query}`);
}

describe("syntax errors", () => {
  test("report line and column", () => {
    const e = error("SELECT * WHERE {\n  ?s ?p\n}");
    assert.equal(e.line, 3);
    assert.equal(e.column, 1);
    assert.match(e.message, /Expected .* but found '}'/);
  });

  test("unterminated constructs", () => {
    error("SELECT * WHERE { ?s ?p ?o");
    error("SELECT * WHERE { ?s ?p 'unterminated }");
    error("SELECT (COUNT(?x) AS ?c WHERE {}");
    error("PREFIX ex <http://example.org/> SELECT * {}");
  });

  test("invalid terms and keywords", () => {
    error("SELECT * WHERE { ?s ?p ?o } LIMIT ten");
    error("SELEC * WHERE {}");
    error("SELECT * WHERE { FILTER(unknownFunction(?x)) }");
    error("SELECT * WHERE { ?s ?p ?o . ?s ?p }");
    error("SELECT * WHERE { ?s ?p ?o ?s ?p ?o }");
  });

  test("built-in arity", () => {
    error("SELECT * { FILTER(REGEX(?x)) }");
    error("SELECT * { FILTER(STR(?x, ?y)) }");
    error("SELECT * { BIND(NOW(1) AS ?n) }");
    error("SELECT * { FILTER(BOUND(1)) }");
    assert.ok(isValid("SELECT * { FILTER(REGEX(?x, 'a', 'i')) BIND(NOW() AS ?n) BIND(CONCAT() AS ?e) }"));
  });

  test("VALUES rows must match the variables", () => {
    error("SELECT * { VALUES (?a ?b) { (1) } }");
    error("SELECT * { VALUES (?a ?b) { (1 2 3) } }");
  });

  test("update data restrictions", () => {
    error("INSERT DATA { ?s :p :o }");
    error("DELETE DATA { _:b :p :o }");
    error("DELETE WHERE { [] :p ?o }");
    error("DELETE { ?s :p :o {| :a :b |} } WHERE { ?s ?p ?o }");
    assert.ok(isValid("INSERT DATA { _:b :p :o }"));
    assert.ok(isValid("DELETE { ?s :p :o ~ :r {| :a :b |} } WHERE { ?s ?p ?o }"));
  });

  test("surrogate escapes are rejected", () => {
    error('SELECT * { ?s ?p "\\uD800" }');
  });

  test("isValid", () => {
    assert.equal(isValid("SELECT * {}"), true);
    assert.equal(isValid("SELECT * {"), false);
  });
});
