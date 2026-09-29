# Changelog

## 1.0.0

First release.

- Formats SPARQL 1.2 queries and updates (VERSION, triple terms, reified triples, reifiers, annotations, base
  direction, new built-in functions) as well as SPARQL 1.0 and 1.1.
- Keeps comments where they are, including inside empty groups
  ([sparqling/sparql-formatter#30](https://github.com/sparqling/sparql-formatter/issues/30)).
- Options: `indent`, `keywordCase`, `functionCase`, `alignPredicates`, `preserveBlankLines`, `compact`,
  `lineWidth`, `insertWhere`.
- `spfmt` export compatible with `sparql-formatter`.
- ESM, CommonJS and browser builds, TypeScript types and a `sparql-formatter` CLI.
- Tested with the W3C SPARQL 1.0, 1.1 and 1.2 test suites.
