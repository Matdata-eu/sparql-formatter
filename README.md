# SPARQL Formatter

### A SPARQL 1.2 formatter that keeps your comments where you put them

[![Test](https://github.com/Matdata-eu/sparql-formatter/actions/workflows/test.yml/badge.svg)](https://github.com/Matdata-eu/sparql-formatter/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/@matdata/sparql-formatter)](https://www.npmjs.com/package/@matdata/sparql-formatter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@matdata/sparql-formatter` pretty-prints SPARQL queries and updates. It is the formatter of
[MatGUI](https://github.com/Matdata-eu/MatGUI) and a drop-in replacement for
[sparql-formatter](https://github.com/sparqling/sparql-formatter) (`spfmt`), with:

- **SPARQL 1.2** — `VERSION`, triple terms `<<( s p o )>>`, reified triples `<< s p o ~ r >>`, reifiers and
  annotations `{| ... |}`, base direction `"x"@ar--rtl`, and the new functions (`LANGDIR`, `STRLANGDIR`,
  `hasLANG`, `hasLANGDIR`, `isTRIPLE`, `TRIPLE`, `SUBJECT`, `PREDICATE`, `OBJECT`). SPARQL 1.0 and 1.1 are
  fully supported too.
- **Comments that stay in place** — every comment is kept next to the code it belongs to, including comments
  inside empty groups, between predicates, in expressions and at the end of the query
  ([sparqling/sparql-formatter#30](https://github.com/sparqling/sparql-formatter/issues/30)).
- **Safe output** — formatting never changes the meaning of a query and running it twice gives the same
  result. This is tested on the complete W3C SPARQL 1.0, 1.1 and 1.2 test suites, also with comments inserted
  between every pair of tokens.
- **Zero dependencies**, ESM + CommonJS + a browser bundle, TypeScript types and a CLI.

🌐 **Try it**: [playground](https://matdata-eu.github.io/sparql-formatter/)

## Example

```sparql
#comment 1
PREFIX :   <http://example.org/>
select * where { :alice :knows :bob ~:claim1 {| :source ?doc ; :certainty 0.9 |} .
graph ?g {
#comment 2
}
?city :type :City; # a city
      :country :Belgium ; :population ?pop
optional { ?city :name ?name } filter(?pop > 10000) } order by desc(?pop) limit 10
```

becomes

```sparql
#comment 1
PREFIX : <http://example.org/>

SELECT *
WHERE {
  :alice :knows :bob ~ :claim1 {| :source ?doc ; :certainty 0.9 |} .
  GRAPH ?g {
    #comment 2
  }
  ?city :type :City ; # a city
        :country :Belgium ;
        :population ?pop .
  OPTIONAL {
    ?city :name ?name .
  }
  FILTER (?pop > 10000)
}
ORDER BY DESC(?pop)
LIMIT 10
```

## Installation

```bash
npm install @matdata/sparql-formatter
```

## Usage

### JavaScript / TypeScript

```js
import { format } from "@matdata/sparql-formatter";

const pretty = format("select * where {?s ?p ?o}");
// SELECT *
// WHERE {
//   ?s ?p ?o .
// }

format(query, { indent: 4, compact: true });
```

CommonJS works too: `const { format } = require("@matdata/sparql-formatter");`

`format` throws a `SparqlSyntaxError` (with `line`, `column` and `offset`) when the input is not valid SPARQL:

```js
import { format, isValid, SparqlSyntaxError } from "@matdata/sparql-formatter";

try {
  format("SELECT * WHERE { ?s ?p }");
} catch (e) {
  if (e instanceof SparqlSyntaxError) console.log(e.line, e.column, e.message);
  // 1 24 "Expected an RDF term or a variable but found '}' (line 1, column 24)"
}

isValid("SELECT * {}"); // true
```

### Drop-in replacement for `sparql-formatter`

The package exports an `spfmt` object with the same `format(query, formattingMode, indentDepth)` signature as
[sparql-formatter](https://github.com/sparqling/sparql-formatter), so switching is a one-line change:

```diff
- import { spfmt } from "sparql-formatter";
+ import { spfmt } from "@matdata/sparql-formatter";

  spfmt.format(query);              // formattingMode "default"
  spfmt.format(query, "compact");
  spfmt.format(query, "default", 4);
```

The `turtle` and `jsonld` modes of sparql-formatter are not supported; use `parse()` to get the syntax tree.

### In the browser

```html
<script src="https://cdn.jsdelivr.net/npm/@matdata/sparql-formatter/dist/spfmt.min.js"></script>
<script>
  spfmt.format("select * where {?s ?p ?o}");
  sparqlFormatter.format("select * where {?s ?p ?o}", { indent: 4 }); // full API
</script>
```

Or as an ES module: `import { format } from "https://cdn.jsdelivr.net/npm/@matdata/sparql-formatter/+esm";`

### Command line

```bash
npx @matdata/sparql-formatter query.rq          # print the formatted query
cat query.rq | npx @matdata/sparql-formatter    # read from stdin
npx @matdata/sparql-formatter --write *.rq *.ru # format files in place
npx @matdata/sparql-formatter --check *.rq      # exit code 1 if a file isn't formatted (for CI)
```

Run `sparql-formatter --help` for all options (`--indent`, `--keyword-case`, `--function-case`, `--no-align`,
`--no-blank-lines`, `--compact`, `--line-width`).

## Options

| Option               | Default      | Description                                                                                      |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `indent`             | `2`          | Number of spaces, or the indent string itself (e.g. `"\t"`).                                     |
| `keywordCase`        | `"upper"`    | Case of keywords (`SELECT`, `WHERE`, `OPTIONAL`, ...): `"upper"`, `"lower"` or `"preserve"`.     |
| `functionCase`       | `"preserve"` | Case of built-in function names (`regex`, `STR`, `COUNT`, ...): `"upper"`, `"lower"`, `"preserve"`. |
| `alignPredicates`    | `true`       | Align the predicates of a subject under its first predicate. When `false`, indent them instead.  |
| `preserveBlankLines` | `true`       | Keep (at most one) blank line where the query has blank lines between statements.                |
| `compact`            | `false`      | Put group patterns with a single triple on one line: `OPTIONAL { ?s :p ?o }`.                     |
| `lineWidth`          | `100`        | Line width used by `compact` and to wrap long object and `VALUES` lists.                          |
| `insertWhere`        | `true`       | Write the optional `WHERE` keyword of `SELECT`, `CONSTRUCT` and `DESCRIBE` queries.               |

## Formatting style

- Keywords are upper case; prefixed names, IRIs, variables and literals are written exactly as in the input.
- The prologue (`BASE`, `PREFIX`, `VERSION`) is followed by a blank line.
- Each clause (`SELECT`, `FROM`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`, `OFFSET`, `VALUES`) starts
  on a new line; every pattern in a group gets its own line.
- Triple patterns end with ` .`, predicate lists with ` ;` are aligned, and objects are separated by `, `.
- The optional `.` after `OPTIONAL { }`, `FILTER`, ... and superfluous `;` are removed; their comments are kept.
- Long object lists and `VALUES` lists are wrapped, one item per line.

### Comments

Comments are attached to the code around them:

- a comment at the end of a line stays at the end of that line;
- a comment on its own line stays on its own line, before the code that follows it, at that code's indentation;
- comments before a closing `}` stay inside the block;
- blank lines before comments are kept.

If a comment ends up in the middle of an expression, the formatter continues the expression on the next line
rather than moving the comment. The formatter never drops a comment: if it can't place one, it throws an error
instead of returning a query without it.

## What is checked

The parser implements the complete [SPARQL 1.2 grammar](https://www.w3.org/TR/sparql12-query/#sparqlGrammar)
for queries and updates, including the grammar notes (no variables in `INSERT DATA`, no blank nodes in
`DELETE`, the number of values in `VALUES` rows, no reifiers after property paths, ...). It does not check
rules that go beyond the grammar, such as variable scoping in `SELECT` and `BIND`, grouping rules of
aggregates, or blank node label reuse across basic graph patterns: formatting such a query works.

## API

| Export                       | Description                                                            |
| ---------------------------- | ---------------------------------------------------------------------- |
| `format(query, options?)`    | Format a query or update. Also the default export.                     |
| `isValid(query)`             | `true` when the query is syntactically valid SPARQL 1.2.               |
| `parse(query)`               | Parse into a concrete syntax tree (`Query` or `Update`).               |
| `formatAst(ast, options?)`   | Format a tree returned by `parse`.                                     |
| `tokenize(query)`            | The tokens of a query, with the comments attached to them.             |
| `spfmt`                      | `{ format, parse, tokenize }`, compatible with `sparql-formatter`.      |
| `SparqlSyntaxError`          | Error thrown for invalid input (`line`, `column`, `offset`, `expected`). |

## Development

```bash
npm install
npm test            # unit tests + W3C test suites (Node 22+, runs the TypeScript sources directly)
npm run typecheck
npm run lint        # prettier --check
npm run build       # dist/: ESM, CommonJS, browser bundle, CLI and type declarations
npm run test:dist   # smoke test of the built package
```

The source is in `src/`: `lexer.ts` (tokens and comments), `parser.ts` (recursive-descent parser),
`printer.ts` (layout) and `writer.ts` (output buffer that places the comments).

The W3C test queries in `test/w3c` are imported from [w3c/rdf-tests](https://github.com/w3c/rdf-tests) with:

```bash
git clone --depth 1 https://github.com/w3c/rdf-tests
node scripts/import-w3c-tests.mjs rdf-tests
```

## Releasing

Releases are published to npm by the [publish workflow](.github/workflows/publish.yml) when a GitHub release is
published. The version is taken from the release tag (`v1.2.3` → `1.2.3`; a pre-release such as `v1.3.0-beta.1`
is published with the `next` dist-tag).

The workflow uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): there is no npm token in
the repository. One-time setup on [npmjs.com](https://www.npmjs.com/package/@matdata/sparql-formatter) →
**Settings** → **Trusted Publisher** → **GitHub Actions**:

- Organization or user: `Matdata-eu`
- Repository: `sparql-formatter`
- Workflow filename: `publish.yml`

npm only lets you add a trusted publisher to a package that already exists, so the very first version has to be
published once by hand (`npm run build && npm publish --access public`) by a member of the `@matdata` npm
organization.

The [playground](https://matdata-eu.github.io/sparql-formatter/) is deployed to GitHub Pages on every push to
`main` (repository **Settings** → **Pages** → Source: **GitHub Actions**).

## License

[MIT](LICENSE). The test queries in `test/w3c` come from the W3C test suites and are distributed under the
[W3C test suite licenses](https://www.w3.org/Consortium/Legal/2008/04-testsuite-copyright.html).
