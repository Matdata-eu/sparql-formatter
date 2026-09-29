/**
 * SPARQL 1.2 formatter.
 *
 * ```js
 * import { format } from "@matdata/sparql-formatter";
 * format("select * where {?s ?p ?o}");
 * ```
 */

import type { Ast } from "./ast.ts";
import { parse } from "./parser.ts";
import { Printer, resolveOptions, type FormatOptions } from "./printer.ts";
import { tokenize } from "./lexer.ts";

export { parse } from "./parser.ts";
export { tokenize } from "./lexer.ts";
export { SparqlSyntaxError } from "./errors.ts";
export type { FormatOptions, Case } from "./printer.ts";
export type { Token, Comment, TokenType } from "./lexer.ts";
export type * from "./ast.ts";

function countComments(ast: Ast): number {
  // Every comment is attached to exactly one token; count them via a fresh tokenization-independent walk.
  let count = 0;
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj.offset === "number" && Array.isArray(obj.leading)) {
      count += (obj.leading as unknown[]).length + (obj.trailing ? 1 : 0);
      return;
    }
    Object.values(obj).forEach(visit);
  };
  visit(ast);
  return count;
}

/** Format a parsed query. */
export function formatAst(ast: Ast, options?: FormatOptions): string {
  const { text, comments } = new Printer(resolveOptions(options)).print(ast);
  const expected = countComments(ast);
  if (comments !== expected) {
    // Never silently drop comments: this would be a bug in the formatter.
    throw new Error(`Internal formatter error: ${expected - comments} comment(s) could not be placed`);
  }
  return text;
}

/**
 * Format a SPARQL 1.2 query or update.
 *
 * @throws {SparqlSyntaxError} when the input is not valid SPARQL.
 */
export function format(query: string, options?: FormatOptions): string {
  return formatAst(parse(query), options);
}

/** Check whether a query is valid SPARQL 1.2 syntax. */
export function isValid(query: string): boolean {
  try {
    parse(query);
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop-in replacement for the `spfmt` object of the `sparql-formatter`
 * package (`spfmt.format(query, formattingMode, indentDepth)`).
 */
export const spfmt = {
  parse,
  tokenize,
  format(query: string, formattingMode: "default" | "compact" = "default", indentDepth = 2): string {
    if (formattingMode !== "default" && formattingMode !== "compact") {
      throw new Error(`Unsupported formatting mode: ${formattingMode as string}`);
    }
    return format(query, { indent: indentDepth, compact: formattingMode === "compact" });
  },
};

export default format;
