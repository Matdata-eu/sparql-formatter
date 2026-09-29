import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { format } from "../src/index.ts";
import { dedent, structure } from "./helpers.ts";

/** Assert that `input` formats to `expected`, and that formatting is idempotent. */
function check(input: string, expected: string, options?: Parameters<typeof format>[1]) {
  const output = format(dedent(input), options);
  assert.equal(output, dedent(expected));
  assert.equal(format(output, options), output, "formatting is not idempotent");
  assert.equal(structure(output), structure(dedent(input)), "formatting changed the query");
}

describe("queries", () => {
  test("basic select", () => {
    check(
      `select * where {?s ?p ?o}`,
      `
      SELECT *
      WHERE {
        ?s ?p ?o .
      }`,
    );
  });

  test("prologue is normalised and separated by a blank line", () => {
    check(
      `
      PREFIX foaf:   <http://xmlns.com/foaf/0.1/>
      base <http://example.org/>
      SELECT ?name WHERE { ?x foaf:name ?name }`,
      `
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      BASE <http://example.org/>

      SELECT ?name
      WHERE {
        ?x foaf:name ?name .
      }`,
    );
  });

  test("predicate-object lists are aligned", () => {
    check(
      `SELECT * { ?a :x ?x ; :y ?y , ?z ; }`,
      `
      SELECT *
      WHERE {
        ?a :x ?x ;
           :y ?y, ?z .
      }`,
    );
  });

  test("solution modifiers", () => {
    check(
      `
      SELECT ?x (MIN(?y) * 2 AS ?min) WHERE { ?x :p ?y . ?x :q ?z . }
      GROUP BY ?x (str(?z)) HAVING (sum(?y) > 10) ORDER BY DESC(?min) ?x LIMIT 5 OFFSET 10`,
      `
      SELECT ?x (MIN(?y) * 2 AS ?min)
      WHERE {
        ?x :p ?y .
        ?x :q ?z .
      }
      GROUP BY ?x (str(?z))
      HAVING (sum(?y) > 10)
      ORDER BY DESC(?min) ?x
      LIMIT 5
      OFFSET 10`,
    );
  });

  test("offset before limit keeps its order", () => {
    check(
      `SELECT * {} OFFSET 1 LIMIT 2`,
      `
      SELECT *
      WHERE {}
      OFFSET 1
      LIMIT 2`,
    );
  });

  test("graph patterns", () => {
    check(
      `
      SELECT * WHERE { ?x :name ?name OPTIONAL { ?x :mbox ?mbox } MINUS { ?x :hidden true }
      { ?a :b ?c } UNION { ?a :d ?c } UNION { ?a :e ?c }
      GRAPH ?g { ?s ?p ?o } SERVICE SILENT <http://example.org/sparql> { ?s ?p ?o }
      FILTER NOT EXISTS { ?x :q ?m FILTER(?n = ?m) } BIND(?p * (1 - ?discount) AS ?price) }`,
      `
      SELECT *
      WHERE {
        ?x :name ?name .
        OPTIONAL {
          ?x :mbox ?mbox .
        }
        MINUS {
          ?x :hidden true .
        }
        {
          ?a :b ?c .
        }
        UNION
        {
          ?a :d ?c .
        }
        UNION
        {
          ?a :e ?c .
        }
        GRAPH ?g {
          ?s ?p ?o .
        }
        SERVICE SILENT <http://example.org/sparql> {
          ?s ?p ?o .
        }
        FILTER NOT EXISTS {
          ?x :q ?m .
          FILTER (?n = ?m)
        }
        BIND (?p * (1 - ?discount) AS ?price)
      }`,
    );
  });

  test("sub-select", () => {
    check(
      `SELECT ?y ?minName WHERE { :alice :knows ?y . { SELECT ?y (MIN(?name) AS ?minName) WHERE { ?y :name ?name . } GROUP BY ?y } }`,
      `
      SELECT ?y ?minName
      WHERE {
        :alice :knows ?y .
        {
          SELECT ?y (MIN(?name) AS ?minName)
          WHERE {
            ?y :name ?name .
          }
          GROUP BY ?y
        }
      }`,
    );
  });

  test("VALUES", () => {
    check(
      `
      SELECT * { VALUES ?book { :book1 :book3 } ?book :title ?title }
      VALUES (?book ?title) { (UNDEF "SPARQL Tutorial") (:book2 undef) }`,
      `
      SELECT *
      WHERE {
        VALUES ?book { :book1 :book3 }
        ?book :title ?title .
      }
      VALUES (?book ?title) {
        (UNDEF "SPARQL Tutorial")
        (:book2 UNDEF)
      }`,
    );
  });

  test("long VALUES lists are wrapped", () => {
    const values = Array.from({ length: 30 }, (_, i) => `:item${i}`).join(" ");
    const out = format(`SELECT * { VALUES ?x { ${values} } }`);
    assert.match(out, /VALUES \?x \{\n    :item0\n    :item1\n/);
  });

  test("property paths", () => {
    check(
      `SELECT * { ?s ^:p/:q* ?o . ?s (:a|^:b)+ ?o . ?s !(rdf:type|^:x) ?o . ?s :p? ?o . ?s a/rdfs:subClassOf* ?c }`,
      `
      SELECT *
      WHERE {
        ?s ^:p/:q* ?o .
        ?s (:a|^:b)+ ?o .
        ?s !(rdf:type|^:x) ?o .
        ?s :p? ?o .
        ?s a/rdfs:subClassOf* ?c .
      }`,
    );
  });

  test("blank nodes and collections", () => {
    check(
      `SELECT * { [] :p [ :q ?o ] . ?s :list ( 1 2 ?x ) . [ :a ?b ; :c ?d ] :e ?f . ( :hoge :fuga ) ?p ?o }`,
      `
      SELECT *
      WHERE {
        [] :p [ :q ?o ] .
        ?s :list ( 1 2 ?x ) .
        [ :a ?b ;
          :c ?d ] :e ?f .
        ( :hoge :fuga ) ?p ?o .
      }`,
    );
  });

  test("literals are kept as written", () => {
    check(
      `SELECT * { ?s ?p "chat"@fr, 'x'^^xsd:string, -1, +2.5, 1.0e6, .5, true, FALSE, "hi"@en--ltr }`,
      `
      SELECT *
      WHERE {
        ?s ?p "chat"@fr, 'x'^^xsd:string, -1, +2.5, 1.0e6, .5, true, FALSE, "hi"@en--ltr .
      }`,
    );
    const long = `SELECT * { ?s ?p """long\n  string""" }`;
    assert.equal(format(long), `SELECT *\nWHERE {\n  ?s ?p """long\n  string""" .\n}`);
  });

  test("long object lists get one object per line", () => {
    check(
      `SELECT * { ?s rdfs:label "a very long label number one", "a very long label number two", "a very long label number three" ; a :T }`,
      `
      SELECT *
      WHERE {
        ?s rdfs:label "a very long label number one",
                      "a very long label number two",
                      "a very long label number three" ;
           a :T .
      }`,
    );
  });

  test("expressions", () => {
    check(
      `SELECT (?a+?b*-?c AS ?x) (!BOUND(?y) || ?z NOT IN (1, 2) AS ?w) (COUNT(DISTINCT *) AS ?n) (GROUP_CONCAT(?s ; separator=", ") AS ?g) {}`,
      `
      SELECT (?a + ?b * -?c AS ?x) (!BOUND(?y) || ?z NOT IN (1, 2) AS ?w) (COUNT(DISTINCT *) AS ?n) (GROUP_CONCAT(?s; SEPARATOR = ", ") AS ?g)
      WHERE {}`,
    );
  });

  test("function calls with IRIs", () => {
    check(
      `SELECT * { FILTER(<http://example.org/fn>(?x, 1)) FILTER xsd:integer(?y) BIND(geof:distance(?a,?b,uom:metre) AS ?d) }`,
      `
      SELECT *
      WHERE {
        FILTER (<http://example.org/fn>(?x, 1))
        FILTER xsd:integer(?y)
        BIND (geof:distance(?a, ?b, uom:metre) AS ?d)
      }`,
    );
  });

  test("CONSTRUCT, ASK and DESCRIBE", () => {
    check(
      `CONSTRUCT { ?x :name ?name } WHERE { ?x :name ?name }`,
      `
      CONSTRUCT {
        ?x :name ?name .
      }
      WHERE {
        ?x :name ?name .
      }`,
    );
    check(
      `CONSTRUCT FROM <g> WHERE { ?s ?p ?o }`,
      `
      CONSTRUCT
      FROM <g>
      WHERE {
        ?s ?p ?o .
      }`,
    );
    check(
      `ASK { ?s ?p ?o }`,
      `
      ASK {
        ?s ?p ?o .
      }`,
    );
    check(
      `ASK FROM <g> { ?s ?p ?o }`,
      `
      ASK
      FROM <g>
      WHERE {
        ?s ?p ?o .
      }`,
    );
    check(
      `DESCRIBE ?x <http://example.org/y> FROM NAMED <g> WHERE { ?x ?p ?o }`,
      `
      DESCRIBE ?x <http://example.org/y>
      FROM NAMED <g>
      WHERE {
        ?x ?p ?o .
      }`,
    );
    check(`describe <x>`, `DESCRIBE <x>`);
  });

  test("an empty query formats to an empty string", () => {
    assert.equal(format(""), "");
    assert.equal(format("  \n "), "");
  });
});

describe("updates", () => {
  test("INSERT DATA", () => {
    check(
      `
      PREFIX dc: <http://purl.org/dc/elements/1.1/>
      INSERT DATA
      {
        <http://example/book1> dc:title "A new book" ;
                               dc:creator "A.N.Other" .
      }`,
      `
      PREFIX dc: <http://purl.org/dc/elements/1.1/>

      INSERT DATA {
        <http://example/book1> dc:title "A new book" ;
                               dc:creator "A.N.Other" .
      }`,
    );
  });

  test("DELETE/INSERT WHERE with WITH and USING", () => {
    check(
      `WITH <http://example/addresses> DELETE { ?person :givenName 'Bill' } INSERT { ?person :givenName 'William' } USING <g1> USING NAMED <g2> WHERE { ?person :givenName 'Bill' }`,
      `
      WITH <http://example/addresses>
      DELETE {
        ?person :givenName 'Bill' .
      }
      INSERT {
        ?person :givenName 'William' .
      }
      USING <g1>
      USING NAMED <g2>
      WHERE {
        ?person :givenName 'Bill' .
      }`,
    );
  });

  test("several operations", () => {
    check(
      `LOAD SILENT <http://x> INTO GRAPH <g>; CLEAR ALL; DROP GRAPH <g> ; CREATE SILENT GRAPH <h>; ADD DEFAULT TO GRAPH <g>; MOVE GRAPH <a> TO <b>; COPY <a> TO DEFAULT; DELETE WHERE { ?s ?p ?o } ; DELETE DATA { GRAPH <g> { :a :b :c } } ;`,
      `
      LOAD SILENT <http://x> INTO GRAPH <g> ;

      CLEAR ALL ;

      DROP GRAPH <g> ;

      CREATE SILENT GRAPH <h> ;

      ADD DEFAULT TO GRAPH <g> ;

      MOVE GRAPH <a> TO <b> ;

      COPY <a> TO DEFAULT ;

      DELETE WHERE {
        ?s ?p ?o .
      } ;

      DELETE DATA {
        GRAPH <g> {
          :a :b :c .
        }
      } ;`,
    );
  });
});

describe("options", () => {
  const query = `select distinct ?s (count(?o) as ?n) where { ?s a :T ; :p ?o . optional { ?s :q ?r } } group by ?s`;

  test("indent", () => {
    assert.equal(
      format(query, { indent: 4 }),
      dedent(`
        SELECT DISTINCT ?s (count(?o) AS ?n)
        WHERE {
            ?s a :T ;
               :p ?o .
            OPTIONAL {
                ?s :q ?r .
            }
        }
        GROUP BY ?s`),
    );
    assert.match(format(query, { indent: "\t" }), /\n\t\?s a :T ;\n\t   :p \?o \./);
  });

  test("keywordCase and functionCase", () => {
    const lower = format(query, { keywordCase: "lower", functionCase: "upper" });
    assert.match(lower, /^select distinct \?s \(COUNT\(\?o\) as \?n\)\nwhere \{/);
    const preserve = format("Select * WHERE { ?s ?p ?o } Limit 1", { keywordCase: "preserve" });
    assert.equal(preserve, "Select *\nWHERE {\n  ?s ?p ?o .\n}\nLimit 1");
  });

  test("alignPredicates: false", () => {
    assert.equal(
      format("SELECT * { ?subject :a ?b ; :c ?d }", { alignPredicates: false }),
      "SELECT *\nWHERE {\n  ?subject :a ?b ;\n    :c ?d .\n}",
    );
  });

  test("compact", () => {
    assert.equal(
      format(query, { compact: true }),
      dedent(`
        SELECT DISTINCT ?s (count(?o) AS ?n)
        WHERE {
          ?s a :T ;
             :p ?o .
          OPTIONAL { ?s :q ?r }
        }
        GROUP BY ?s`),
    );
  });

  test("insertWhere: false", () => {
    assert.equal(format("SELECT * { ?s ?p ?o }", { insertWhere: false }), "SELECT *\n{\n  ?s ?p ?o .\n}");
  });

  test("preserveBlankLines", () => {
    const q = "SELECT * {\n  ?a ?b ?c .\n\n\n  ?d ?e ?f .\n}";
    assert.equal(format(q), "SELECT *\nWHERE {\n  ?a ?b ?c .\n\n  ?d ?e ?f .\n}");
    assert.equal(format(q, { preserveBlankLines: false }), "SELECT *\nWHERE {\n  ?a ?b ?c .\n  ?d ?e ?f .\n}");
  });
});
