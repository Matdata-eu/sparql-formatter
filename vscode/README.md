# SPARQL Formatter for VS Code

Formats SPARQL 1.2 queries and updates (`.rq`, `.ru`, `.sparql`) and keeps your comments where you put them.
It uses [@matdata/sparql-formatter](https://github.com/Matdata-eu/sparql-formatter), the formatter of
[MatGUI](https://github.com/Matdata-eu/MatGUI).

## Features

- **Format Document** (<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>) and format on save for SPARQL files.
- Supports SPARQL 1.0, 1.1 and 1.2: `VERSION`, triple terms, reified triples, annotations and more.
- Comments stay in place, also inside empty groups and between predicates.
- Formatting never changes the meaning of a query.
- Syntax errors are shown in the Problems panel as you type.

Indentation follows the editor settings (`editor.tabSize`, `editor.insertSpaces`).

To format on save:

```json
"[sparql]": {
  "editor.defaultFormatter": "matdata.matdata-sparql-formatter",
  "editor.formatOnSave": true
}
```

## Settings

| Setting                              | Default      | Description                                                                         |
| ------------------------------------ | ------------ | ----------------------------------------------------------------------------------- |
| `sparqlFormatter.keywordCase`        | `"upper"`    | Case of keywords (`SELECT`, `WHERE`, ...): `"upper"`, `"lower"` or `"preserve"`.    |
| `sparqlFormatter.functionCase`       | `"preserve"` | Case of built-in function names (`regex`, `STR`, ...): `"upper"`, `"lower"`, `"preserve"`. |
| `sparqlFormatter.alignPredicates`    | `true`       | Align the predicates of a subject under its first predicate. When off, indent them. |
| `sparqlFormatter.preserveBlankLines` | `true`       | Keep (at most one) blank line where the query has blank lines between statements.   |
| `sparqlFormatter.compact`            | `false`      | Put group patterns with a single triple on one line: `OPTIONAL { ?s :p ?o }`.        |
| `sparqlFormatter.lineWidth`          | `100`        | Line width used by `compact` and to wrap long object and `VALUES` lists.             |
| `sparqlFormatter.insertWhere`        | `true`       | Write the optional `WHERE` keyword of `SELECT`, `CONSTRUCT` and `DESCRIBE` queries.  |
| `sparqlFormatter.validate`           | `true`       | Show syntax errors in the Problems panel while you type.                             |

This extension does not include syntax highlighting. It works together with extensions that do, such as
[Stardog RDF Grammars](https://marketplace.visualstudio.com/items?itemName=stardog-union.stardog-rdf-grammars).

## Development

The extension bundles the formatter sources from `../src`, so it always uses the formatter in this repository.

```bash
cd vscode
npm install
npm run typecheck
npm run build      # dist/extension.js
npm run package    # matdata-sparql-formatter-<version>.vsix
code --install-extension matdata-sparql-formatter-1.0.0.vsix
```

To debug, open the `vscode` folder in VS Code and press F5 (**Run Extension**).

## Releasing

The [publish workflow](../.github/workflows/publish-vscode.yml) publishes the extension whenever a GitHub
release is published, together with the npm package, so both always have the same version. The version comes
from the release tag (`v1.2.3` → `1.2.3`). The Marketplace only accepts `major.minor.patch` versions, so releases
with a pre-release version (`v1.3.0-beta.1`) only go to npm.