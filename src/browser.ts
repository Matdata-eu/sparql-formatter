// Browser bundle entry: exposes `window.spfmt` (compatible with the original sparql-formatter)
// and `window.sparqlFormatter` with the full API.
import * as api from "./index.ts";

const g = globalThis as unknown as Record<string, unknown>;
g.spfmt = api.spfmt;
g.sparqlFormatter = api;
