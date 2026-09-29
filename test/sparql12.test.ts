import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { format, isValid } from "../src/index.ts";
import { dedent, structure } from "./helpers.ts";

function check(input: string, expected: string) {
  const output = format(dedent(input));
  assert.equal(output, dedent(expected));
  assert.equal(format(output), output, "formatting is not idempotent");
  assert.equal(structure(output), structure(dedent(input)));
}

describe("SPARQL 1.2", () => {
  test("VERSION declaration", () => {
    check(
      `version "1.2" PREFIX : <http://example.org/> SELECT * {}`,
      `
      VERSION "1.2"
      PREFIX : <http://example.org/>

      SELECT *
      WHERE {}`,
    );
  });

  test("triple terms", () => {
    check(
      `SELECT * { ?s :claims <<( :a :b "c" )>> . <<(?x :p <<(:a :b :c)>>)>> :q ?o }`,
      `
      SELECT *
      WHERE {
        ?s :claims <<( :a :b "c" )>> .
        <<( ?x :p <<( :a :b :c )>> )>> :q ?o .
      }`,
    );
  });

  test("reified triples and reifiers", () => {
    check(
      `SELECT * { << :s :p :o ~ :r >> :source ?src . <<:a :b :c>> :q 1 . << << :x :y :z >> :p ?o ~ >> :r ?w }`,
      `
      SELECT *
      WHERE {
        << :s :p :o ~ :r >> :source ?src .
        << :a :b :c >> :q 1 .
        << << :x :y :z >> :p ?o ~ >> :r ?w .
      }`,
    );
  });

  test("annotations", () => {
    check(
      `SELECT * { :a :b :c ~:r {| :date "2020" ; :by ?who |} . ?s ?p ?o {| :source ?src |}, ?o2 ~ _:b ~ [] }`,
      `
      SELECT *
      WHERE {
        :a :b :c ~ :r {| :date "2020" ; :by ?who |} .
        ?s ?p ?o {| :source ?src |}, ?o2 ~ _:b ~ [] .
      }`,
    );
  });

  test("triple terms in expressions and VALUES", () => {
    check(
      `SELECT * { VALUES ?t { <<( :a :b "c"@en )>> UNDEF } FILTER(isTRIPLE(?t) && SUBJECT(?t) = :a && ?t != <<( ?s :p 1 )>>) BIND(TRIPLE(?s, ?p, ?o) AS ?tt) }`,
      `
      SELECT *
      WHERE {
        VALUES ?t { <<( :a :b "c"@en )>> UNDEF }
        FILTER (isTRIPLE(?t) && SUBJECT(?t) = :a && ?t != <<( ?s :p 1 )>>)
        BIND (TRIPLE(?s, ?p, ?o) AS ?tt)
      }`,
    );
  });

  test("base direction and the new built-ins", () => {
    check(
      `SELECT (LANGDIR(?l) AS ?d) (STRLANGDIR("x", "ar", "rtl") AS ?s) { ?x :label "مرحبا"@ar--rtl FILTER(hasLANG(?l) && hasLANGDIR(?l)) BIND(PREDICATE(?t) AS ?p) BIND(OBJECT(?t) AS ?o) }`,
      `
      SELECT (LANGDIR(?l) AS ?d) (STRLANGDIR("x", "ar", "rtl") AS ?s)
      WHERE {
        ?x :label "مرحبا"@ar--rtl .
        FILTER (hasLANG(?l) && hasLANGDIR(?l))
        BIND (PREDICATE(?t) AS ?p)
        BIND (OBJECT(?t) AS ?o)
      }`,
    );
  });

  test("reification in updates", () => {
    check(
      `INSERT DATA { :s :p :o ~ :r {| :added "today" |} . << :a :b :c ~ :r2 >> :q 1 }`,
      `
      INSERT DATA {
        :s :p :o ~ :r {| :added "today" |} .
        << :a :b :c ~ :r2 >> :q 1 .
      }`,
    );
  });

  test("'<<' is a single token", () => {
    // SPARQL 1.2 reads `<<` as one token: the longest match wins.
    assert.equal(isValid("SELECT * { FILTER(?o<<http://example.org/a>) }"), false);
    assert.equal(isValid("SELECT * { FILTER(?o < <http://example.org/a>) }"), true);
  });

  test("reifiers and annotations are rejected after property paths", () => {
    assert.equal(isValid("SELECT * { ?s :p/:q ?o {| ?a ?b |} }"), false);
    assert.equal(isValid("SELECT * { ?s :p+ ?o ~ :r }"), false);
    assert.equal(isValid("SELECT * { ?s :p ?o ~ :r {| ?a ?b |} }"), true);
  });
});
