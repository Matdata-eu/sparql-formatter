import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { format } from "../src/index.ts";
import { dedent, commentTexts } from "./helpers.ts";

function check(input: string, expected: string) {
  const output = format(dedent(input));
  assert.equal(output, dedent(expected));
  assert.equal(format(output), output, "formatting is not idempotent");
  assert.deepEqual(commentTexts(output), commentTexts(dedent(input)), "comments were lost or reordered");
}

describe("comments stay where they are", () => {
  // https://github.com/sparqling/sparql-formatter/issues/30
  test("comment inside an empty GRAPH block (sparql-formatter#30)", () => {
    check(
      `
      #comment 1
      SELECT * WHERE {
      GRAPH ?g {
      #comment 2
      }
      }`,
      `
      #comment 1
      SELECT *
      WHERE {
        GRAPH ?g {
          #comment 2
        }
      }`,
    );
  });

  test("comments before and after triples", () => {
    check(
      `
      SELECT * WHERE {
        # comment 1
        ?s ?p ?o . # comment hoge
        # comment 2
      }`,
      `
      SELECT *
      WHERE {
        # comment 1
        ?s ?p ?o . # comment hoge
        # comment 2
      }`,
    );
  });

  test("trailing comment before an inserted dot", () => {
    check(
      `
      SELECT ?s WHERE {
        ?s ?p 42 # comment
      }`,
      `
      SELECT ?s
      WHERE {
        ?s ?p 42 . # comment
      }`,
    );
  });

  test("comments on predicate lines", () => {
    check(
      `
      SELECT * {
        ?city wdt:P31 wd:Q515 ; # instance of city
              wdt:P17 wd:Q31 ;  # in Belgium
              # population
              wdt:P1082 ?pop .
      }`,
      `
      SELECT *
      WHERE {
        ?city wdt:P31 wd:Q515 ; # instance of city
              wdt:P17 wd:Q31 ; # in Belgium
              # population
              wdt:P1082 ?pop .
      }`,
    );
  });

  test("comments inside OPTIONAL, FILTER and UNION", () => {
    check(
      `
      SELECT * {
        OPTIONAL { # optional part
          ?s :p ?o
        } # after optional
        { ?a ?b ?c } # left
        UNION # union
        { ?d ?e ?f }
        FILTER ( # open
          ?o > 1 # condition
        )
      }`,
      `
      SELECT *
      WHERE {
        OPTIONAL { # optional part
          ?s :p ?o .
        } # after optional
        {
          ?a ?b ?c .
        } # left
        UNION # union
        {
          ?d ?e ?f .
        }
        FILTER ( # open
          ?o > 1 # condition
          )
      }`,
    );
  });

  test("comments in the prologue and select clause", () => {
    check(
      `
      #!/usr/bin/env spang2
      # @option --fmt

      PREFIX : <http://example.org/> # the default prefix
      SELECT ?a # first
        ?b # second
      { ?a :p ?b }`,
      `
      #!/usr/bin/env spang2
      # @option --fmt

      PREFIX : <http://example.org/> # the default prefix

      SELECT ?a # first
        ?b # second
      WHERE {
        ?a :p ?b .
      }`,
    );
  });

  test("comments at the end of the query", () => {
    check(
      `
      SELECT * { ?s ?p ?o } LIMIT 10 # at most ten
      # the end`,
      `
      SELECT *
      WHERE {
        ?s ?p ?o .
      }
      LIMIT 10 # at most ten
      # the end`,
    );
  });

  test("comments only", () => {
    check(
      `
      # just a comment

      # and another one`,
      `
      # just a comment

      # and another one`,
    );
  });

  test("comments of dropped tokens are kept", () => {
    check(
      `
      SELECT * {
        OPTIONAL { ?s ?p ?o }
        # before the dot
        . # after the dot
        ?a ?b ?c ; # after the semicolon
      }`,
      `
      SELECT *
      WHERE {
        OPTIONAL {
          ?s ?p ?o .
        }
        # before the dot
        # after the dot
        ?a ?b ?c . # after the semicolon
      }`,
    );
  });

  test("comments in updates", () => {
    check(
      `
      # insert a book
      INSERT DATA { # data
        :book :title "SPARQL" # title
      } ; # next
      # clear
      CLEAR ALL`,
      `
      # insert a book
      INSERT DATA { # data
        :book :title "SPARQL" . # title
      } ; # next

      # clear
      CLEAR ALL`,
    );
  });

  test("hash signs inside IRIs and strings are not comments", () => {
    check(
      `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      SELECT * { ?s rdf:type ?o FILTER(?o != "#not a comment") }`,
      `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

      SELECT *
      WHERE {
        ?s rdf:type ?o .
        FILTER (?o != "#not a comment")
      }`,
    );
  });

  test("blank lines between statements are kept (at most one)", () => {
    check(
      `
      SELECT * {
        ?a ?b ?c .



        # section 2
        ?d ?e ?f .

        ?g ?h ?i .
      }`,
      `
      SELECT *
      WHERE {
        ?a ?b ?c .

        # section 2
        ?d ?e ?f .

        ?g ?h ?i .
      }`,
    );
  });

  test("CRLF line endings", () => {
    assert.equal(format("SELECT * {\r\n  ?s ?p ?o # c\r\n}\r\n"), "SELECT *\nWHERE {\n  ?s ?p ?o . # c\n}");
  });
});
