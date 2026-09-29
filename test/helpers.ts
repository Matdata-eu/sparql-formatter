import { parse, tokenize, type Ast } from "../src/index.ts";

/** Remove the common indentation of a template literal and trim the first/last line breaks. */
export function dedent(text: string): string {
  const lines = text
    .replace(/^\n/, "")
    .replace(/\n\s*$/, "")
    .split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return lines.map((l) => l.slice(indent)).join("\n");
}

/**
 * A structural fingerprint of a query: node types and token spellings, without
 * the tokens the formatter may add or remove (`.`, `;`, `WHERE`) and without positions.
 * Two queries with the same fingerprint have the same meaning.
 */
export function structure(query: string): string {
  const ast: Ast = parse(query);
  const walk = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(walk);
    const obj = value as Record<string, unknown>;
    if (typeof obj.offset === "number" && typeof obj.value === "string") {
      return obj.type === "NAME" ? String(obj.value).toUpperCase() : obj.value;
    }
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    for (const key of keys.sort()) {
      if (key === "dot" || key === "semicolons" || key === "eof") continue;
      // WhereClause: { keyword, group } - the WHERE keyword is optional
      if (key === "keyword" && keys.length === 2 && keys.includes("group")) continue;
      out[key] = walk(obj[key]);
    }
    return out;
  };
  return JSON.stringify(walk(ast));
}

/** All comment texts in source order. */
export function commentTexts(query: string): string[] {
  const out: string[] = [];
  for (const t of tokenize(query)) {
    for (const c of t.leading) out.push(c.text);
    if (t.trailing) out.push(t.trailing.text);
  }
  return out;
}
