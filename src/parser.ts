/**
 * Recursive-descent parser for SPARQL 1.2 queries and updates.
 *
 * Grammar: https://www.w3.org/TR/sparql12-query/#sparqlGrammar
 *
 * The parser checks the syntax of the query (it rejects anything the grammar
 * rejects), but it does not check the additional constraints of the spec that
 * a formatter doesn't need, such as variable scoping or blank node label reuse.
 */

import type * as A from "./ast.ts";
import { SparqlSyntaxError } from "./errors.ts";
import { tokenize, type Token } from "./lexer.ts";

/** Built-in calls and aggregates (upper case), with their argument style. */
const BUILTINS = new Set([
  "COUNT",
  "SUM",
  "MIN",
  "MAX",
  "AVG",
  "SAMPLE",
  "GROUP_CONCAT",
  "STR",
  "LANG",
  "LANGMATCHES",
  "LANGDIR",
  "DATATYPE",
  "BOUND",
  "IRI",
  "URI",
  "BNODE",
  "RAND",
  "ABS",
  "CEIL",
  "FLOOR",
  "ROUND",
  "CONCAT",
  "SUBSTR",
  "STRLEN",
  "REPLACE",
  "UCASE",
  "LCASE",
  "ENCODE_FOR_URI",
  "CONTAINS",
  "STRSTARTS",
  "STRENDS",
  "STRBEFORE",
  "STRAFTER",
  "YEAR",
  "MONTH",
  "DAY",
  "HOURS",
  "MINUTES",
  "SECONDS",
  "TIMEZONE",
  "TZ",
  "NOW",
  "UUID",
  "STRUUID",
  "MD5",
  "SHA1",
  "SHA256",
  "SHA384",
  "SHA512",
  "COALESCE",
  "IF",
  "STRLANG",
  "STRLANGDIR",
  "STRDT",
  "SAMETERM",
  "ISIRI",
  "ISURI",
  "ISBLANK",
  "ISLITERAL",
  "ISNUMERIC",
  "HASLANG",
  "HASLANGDIR",
  "REGEX",
  "ISTRIPLE",
  "TRIPLE",
  "SUBJECT",
  "PREDICATE",
  "OBJECT",
]);

const AGGREGATES = new Set(["COUNT", "SUM", "MIN", "MAX", "AVG", "SAMPLE", "GROUP_CONCAT"]);
/** Built-ins that take no arguments: `NOW()`. */
const NO_ARGS = new Set(["RAND", "NOW", "UUID", "STRUUID"]);
/** Exact argument counts of fixed-arity built-ins (min, max). */
const ARITY: Record<string, [number, number]> = {
  LANGMATCHES: [2, 2],
  CONTAINS: [2, 2],
  STRSTARTS: [2, 2],
  STRENDS: [2, 2],
  STRBEFORE: [2, 2],
  STRAFTER: [2, 2],
  STRLANG: [2, 2],
  STRDT: [2, 2],
  SAMETERM: [2, 2],
  IF: [3, 3],
  STRLANGDIR: [3, 3],
  TRIPLE: [3, 3],
  REGEX: [2, 3],
  SUBSTR: [2, 3],
  REPLACE: [3, 4],
  CONCAT: [0, Infinity],
  COALESCE: [0, Infinity],
  BNODE: [0, 1],
};

const QUERY_FORMS = new Set(["SELECT", "CONSTRUCT", "DESCRIBE", "ASK"]);
const UPDATE_KEYWORDS = new Set(["LOAD", "CLEAR", "DROP", "CREATE", "ADD", "MOVE", "COPY", "INSERT", "DELETE", "WITH"]);

/** Parse a SPARQL 1.2 query or update into a concrete syntax tree. */
export function parse(input: string): A.Ast {
  return new Parser(tokenize(input)).parseUnit();
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // -------------------------------------------------------------------------
  // Token helpers
  // -------------------------------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (t.type !== "EOF") this.pos++;
    return t;
  }

  /** Is the token the given keyword (case-insensitive)? */
  private isKw(t: Token, ...keywords: string[]): boolean {
    return t.type === "NAME" && keywords.includes(t.value.toUpperCase());
  }

  private isPunct(t: Token, ...values: string[]): boolean {
    return t.type === "PUNCT" && values.includes(t.value);
  }

  private fail(t: Token, expected: string): never {
    const found = t.type === "EOF" ? "end of input" : `'${t.value}'`;
    throw new SparqlSyntaxError(`Expected ${expected} but found ${found}`, t.offset, t.line, t.column, [expected]);
  }

  private expectKw(keyword: string): Token {
    const t = this.peek();
    if (!this.isKw(t, keyword)) this.fail(t, keyword);
    return this.next();
  }

  private expectPunct(value: string): Token {
    const t = this.peek();
    if (!this.isPunct(t, value)) this.fail(t, `'${value}'`);
    return this.next();
  }

  private optKw(...keywords: string[]): Token | null {
    return this.isKw(this.peek(), ...keywords) ? this.next() : null;
  }

  private optPunct(value: string): Token | null {
    return this.isPunct(this.peek(), value) ? this.next() : null;
  }

  private term(...tokens: Token[]): A.Term {
    return { type: "Term", tokens };
  }

  /** `(` directly followed by `)` (NIL) or `[` followed by `]` (ANON). */
  private isEmptyPair(open: string, close: string): boolean {
    return this.isPunct(this.peek(), open) && this.isPunct(this.peek(1), close);
  }

  // -------------------------------------------------------------------------
  // Units
  // -------------------------------------------------------------------------

  parseUnit(): A.Ast {
    const start = this.pos;
    const prologue = this.parsePrologue();
    if (QUERY_FORMS.has(this.peek().type === "NAME" ? this.peek().value.toUpperCase() : "")) {
      const form = this.parseQueryForm();
      const values = this.isKw(this.peek(), "VALUES") ? this.parseValues() : null;
      const eof = this.peek();
      if (eof.type !== "EOF") this.fail(eof, "end of query");
      return { type: "Query", prologue, form, values, eof };
    }
    this.pos = start;
    return this.parseUpdate();
  }

  private parsePrologue(): A.PrologueDecl[] {
    const decls: A.PrologueDecl[] = [];
    for (;;) {
      const t = this.peek();
      if (this.isKw(t, "BASE")) {
        const keyword = this.next();
        const value = this.next();
        if (value.type !== "IRIREF") this.fail(value, "an IRI");
        decls.push({ type: "Base", keyword, prefix: null, value });
      } else if (this.isKw(t, "PREFIX")) {
        const keyword = this.next();
        const prefix = this.next();
        if (prefix.type !== "PNAME_NS") this.fail(prefix, "a prefix name such as 'ex:'");
        const value = this.next();
        if (value.type !== "IRIREF") this.fail(value, "an IRI");
        decls.push({ type: "Prefix", keyword, prefix, value });
      } else if (this.isKw(t, "VERSION")) {
        const keyword = this.next();
        const value = this.next();
        if (value.type !== "STRING" || value.value.startsWith("'''") || value.value.startsWith('"""')) {
          this.fail(value, "a version string");
        }
        decls.push({ type: "Version", keyword, prefix: null, value });
      } else {
        return decls;
      }
    }
  }

  private parseQueryForm(): A.QueryForm {
    const t = this.peek();
    switch (t.value.toUpperCase()) {
      case "SELECT":
        return this.parseSelect();
      case "CONSTRUCT":
        return this.parseConstruct();
      case "DESCRIBE":
        return this.parseDescribe();
      default:
        return this.parseAsk();
    }
  }

  private parseSelectClause(): A.SelectClause {
    const keyword = this.expectKw("SELECT");
    const modifier = this.optKw("DISTINCT", "REDUCED");
    const star = this.optPunct("*");
    const items: (A.Term | A.Projection)[] = [];
    if (!star) {
      for (;;) {
        const t = this.peek();
        if (t.type === "VAR") {
          items.push(this.term(this.next()));
        } else if (this.isPunct(t, "(")) {
          const open = this.next();
          const expression = this.parseExpression();
          const as = this.expectKw("AS");
          const variable = this.parseVar();
          const close = this.expectPunct(")");
          items.push({ type: "Projection", open, expression, as, variable, close });
        } else {
          break;
        }
      }
      if (items.length === 0) this.fail(this.peek(), "'*', a variable or '(' after SELECT");
    }
    return { type: "SelectClause", keyword, modifier, star, items };
  }

  private parseSelect(): A.SelectQuery {
    const select = this.parseSelectClause();
    const datasets = this.parseDatasets();
    const where = this.parseWhereClause(true);
    const modifiers = this.parseSolutionModifier();
    return { type: "Select", select, datasets, where, modifiers };
  }

  private parseSubSelect(): A.SubSelect {
    const select = this.parseSelectClause();
    const where = this.parseWhereClause(true);
    const modifiers = this.parseSolutionModifier();
    const values = this.isKw(this.peek(), "VALUES") ? this.parseValues() : null;
    return { type: "SubSelect", select, datasets: [], where, modifiers, values };
  }

  private parseConstruct(): A.ConstructQuery {
    const keyword = this.expectKw("CONSTRUCT");
    if (this.isPunct(this.peek(), "{")) {
      const template = this.parseTriplesTemplate(false);
      const datasets = this.parseDatasets();
      const where = this.parseWhereClause(true);
      const modifiers = this.parseSolutionModifier();
      return { type: "Construct", keyword, template, datasets, where, shortForm: null, modifiers };
    }
    const datasets = this.parseDatasets();
    const whereKw = this.expectKw("WHERE");
    const template = this.parseTriplesTemplate(false);
    const modifiers = this.parseSolutionModifier();
    return {
      type: "Construct",
      keyword,
      template: null,
      datasets,
      where: null,
      shortForm: { keyword: whereKw, template },
      modifiers,
    };
  }

  private parseDescribe(): A.DescribeQuery {
    const keyword = this.expectKw("DESCRIBE");
    const star = this.optPunct("*");
    const items: A.Term[] = [];
    if (!star) {
      while (this.isVarOrIri(this.peek())) items.push(this.term(this.next()));
      if (items.length === 0) this.fail(this.peek(), "'*', a variable or an IRI after DESCRIBE");
    }
    const datasets = this.parseDatasets();
    const where =
      this.isKw(this.peek(), "WHERE") || this.isPunct(this.peek(), "{") ? this.parseWhereClause(true) : null;
    const modifiers = this.parseSolutionModifier();
    return { type: "Describe", keyword, star, items, datasets, where, modifiers };
  }

  private parseAsk(): A.AskQuery {
    const keyword = this.expectKw("ASK");
    const datasets = this.parseDatasets();
    const where = this.parseWhereClause(true);
    const modifiers = this.parseSolutionModifier();
    return { type: "Ask", keyword, datasets, where, modifiers };
  }

  private parseDatasets(): A.DatasetClause[] {
    const datasets: A.DatasetClause[] = [];
    while (this.isKw(this.peek(), "FROM")) {
      const from = this.next();
      const named = this.optKw("NAMED");
      datasets.push({ type: "DatasetClause", from, named, iri: this.parseIri() });
    }
    return datasets;
  }

  private parseWhereClause(optionalKeyword: boolean): A.WhereClause {
    const keyword = optionalKeyword ? this.optKw("WHERE") : this.expectKw("WHERE");
    return { keyword, group: this.parseGroupGraphPattern() };
  }

  private parseSolutionModifier(): A.SolutionModifier {
    const modifiers: A.SolutionModifier = { groupBy: null, having: null, orderBy: null, limitOffset: [] };
    if (this.isKw(this.peek(), "GROUP")) {
      const group = this.next();
      const by = this.expectKw("BY");
      const conditions: A.Node[] = [];
      while (this.startsCondition(this.peek())) {
        if (this.isPunct(this.peek(), "(")) {
          const open = this.next();
          const expression = this.parseExpression();
          const as = this.optKw("AS");
          const variable = as ? this.parseVar() : null;
          const close = this.expectPunct(")");
          conditions.push({ type: "Projection", open, expression, as, variable, close });
        } else if (this.peek().type === "VAR") {
          conditions.push(this.term(this.next()));
        } else {
          conditions.push(this.parseConstraint());
        }
      }
      if (conditions.length === 0) this.fail(this.peek(), "a GROUP BY condition");
      modifiers.groupBy = { group, by, conditions };
    }
    if (this.isKw(this.peek(), "HAVING")) {
      const keyword = this.next();
      const conditions: A.Node[] = [];
      while (this.startsCondition(this.peek()) && this.peek().type !== "VAR") {
        conditions.push(this.parseConstraint());
      }
      if (conditions.length === 0) this.fail(this.peek(), "a HAVING condition");
      modifiers.having = { keyword, conditions };
    }
    if (this.isKw(this.peek(), "ORDER")) {
      const order = this.next();
      const by = this.expectKw("BY");
      const conditions: A.Node[] = [];
      for (;;) {
        const t = this.peek();
        if (this.isKw(t, "ASC", "DESC")) {
          const direction = this.next();
          conditions.push({ type: "OrderCondition", direction, expression: this.parseBracketed() });
        } else if (t.type === "VAR") {
          conditions.push(this.term(this.next()));
        } else if (this.startsCondition(t)) {
          conditions.push(this.parseConstraint());
        } else {
          break;
        }
      }
      if (conditions.length === 0) this.fail(this.peek(), "an ORDER BY condition");
      modifiers.orderBy = { order, by, conditions };
    }
    const first = this.optKw("LIMIT", "OFFSET");
    if (first) {
      modifiers.limitOffset.push({ keyword: first, value: this.parseInteger() });
      const second = this.optKw(this.isKw(first, "LIMIT") ? "OFFSET" : "LIMIT");
      if (second) modifiers.limitOffset.push({ keyword: second, value: this.parseInteger() });
    }
    return modifiers;
  }

  private parseInteger(): Token {
    const t = this.peek();
    if (t.type !== "INTEGER") this.fail(t, "an integer");
    return this.next();
  }

  /** Can this token start a GROUP BY / HAVING / ORDER BY condition? */
  private startsCondition(t: Token): boolean {
    return (
      t.type === "VAR" ||
      this.isPunct(t, "(") ||
      t.type === "IRIREF" ||
      t.type === "PNAME_LN" ||
      t.type === "PNAME_NS" ||
      (t.type === "NAME" && (BUILTINS.has(t.value.toUpperCase()) || this.isKw(t, "EXISTS", "NOT")))
    );
  }

  /** Constraint: BrackettedExpression | BuiltInCall | FunctionCall */
  private parseConstraint(): A.Node {
    const t = this.peek();
    if (this.isPunct(t, "(")) return this.parseBracketed();
    if (t.type === "NAME") return this.parseBuiltInCall();
    if (t.type === "IRIREF" || t.type === "PNAME_LN" || t.type === "PNAME_NS") {
      const iri = this.parseIri();
      if (!this.isPunct(this.peek(), "(")) this.fail(this.peek(), "'(' of a function call");
      return this.parseArgList(iri, false);
    }
    return this.fail(t, "'(', a built-in call or a function call");
  }

  // -------------------------------------------------------------------------
  // Updates
  // -------------------------------------------------------------------------

  private parseUpdate(): A.Update {
    const parts: A.UpdatePart[] = [];
    for (;;) {
      const prologue = this.parsePrologue();
      const t = this.peek();
      let operation: A.UpdateOperation | null = null;
      if (t.type === "NAME" && UPDATE_KEYWORDS.has(t.value.toUpperCase())) {
        operation = this.parseUpdateOperation();
      } else if (t.type !== "EOF") {
        this.fail(t, parts.length === 0 && prologue.length === 0 ? "a query or update" : "an update operation");
      }
      const semicolon = operation ? this.optPunct(";") : null;
      parts.push({ prologue, operation, semicolon });
      if (!semicolon) break;
    }
    const eof = this.peek();
    if (eof.type !== "EOF") this.fail(eof, "';' or end of update");
    return { type: "Update", parts, eof };
  }

  private parseUpdateOperation(): A.UpdateOperation {
    const t = this.peek();
    const kw = t.value.toUpperCase();
    switch (kw) {
      case "LOAD": {
        const keyword = this.next();
        const silent = this.optKw("SILENT");
        const iri = this.parseIri();
        let into: A.Words | null = null;
        if (this.isKw(this.peek(), "INTO")) {
          const intoKw = this.next();
          const graph = this.expectKw("GRAPH");
          into = { type: "Words", tokens: [intoKw, graph, this.parseIri()] };
        }
        return { type: "Load", keyword, silent, iri, into };
      }
      case "CLEAR":
      case "DROP":
      case "CREATE": {
        const keyword = this.next();
        const silent = this.optKw("SILENT");
        let target: A.Words;
        if (kw !== "CREATE" && this.isKw(this.peek(), "DEFAULT", "NAMED", "ALL")) {
          target = { type: "Words", tokens: [this.next()] };
        } else {
          const graph = this.expectKw("GRAPH");
          target = { type: "Words", tokens: [graph, this.parseIri()] };
        }
        return { type: "GraphManagement", keyword, silent, target };
      }
      case "ADD":
      case "MOVE":
      case "COPY": {
        const keyword = this.next();
        const silent = this.optKw("SILENT");
        const from = this.parseGraphOrDefault();
        const to = this.expectKw("TO");
        const target = this.parseGraphOrDefault();
        return { type: "GraphTransfer", keyword, silent, from, to, target };
      }
      case "INSERT": {
        if (this.isKw(this.peek(1), "DATA")) {
          const keywords: [Token, Token] = [this.next(), this.next()];
          return { type: "QuadData", keywords, quads: this.checkQuads(this.parseQuads(), true, false) };
        }
        return this.parseModify();
      }
      case "DELETE": {
        if (this.isKw(this.peek(1), "DATA", "WHERE")) {
          const keywords: [Token, Token] = [this.next(), this.next()];
          const noVars = this.isKw(keywords[1], "DATA");
          return { type: "QuadData", keywords, quads: this.checkQuads(this.parseQuads(), noVars, true) };
        }
        return this.parseModify();
      }
      default:
        return this.parseModify();
    }
  }

  private parseGraphOrDefault(): A.Words {
    if (this.isKw(this.peek(), "DEFAULT")) return { type: "Words", tokens: [this.next()] };
    const graph = this.optKw("GRAPH");
    const iri = this.parseIri();
    return { type: "Words", tokens: graph ? [graph, iri] : [iri] };
  }

  private parseModify(): A.Modify {
    let withClause: A.Modify["with"] = null;
    if (this.isKw(this.peek(), "WITH")) {
      const keyword = this.next();
      withClause = { keyword, iri: this.parseIri() };
    }
    let del: A.Modify["delete"] = null;
    let ins: A.Modify["insert"] = null;
    if (this.isKw(this.peek(), "DELETE")) {
      const keyword = this.next();
      del = { keyword, quads: this.checkQuads(this.parseQuads(), false, true) };
    }
    if (this.isKw(this.peek(), "INSERT")) {
      const keyword = this.next();
      ins = { keyword, quads: this.parseQuads() };
    }
    if (!del && !ins) this.fail(this.peek(), "DELETE or INSERT");
    const using: A.Modify["using"] = [];
    while (this.isKw(this.peek(), "USING")) {
      const keyword = this.next();
      const named = this.optKw("NAMED");
      using.push({ keyword, named, iri: this.parseIri() });
    }
    const where = this.parseWhereClause(false);
    return { type: "Modify", with: withClause, delete: del, insert: ins, using, where };
  }

  /** `{ TriplesTemplate? }` of CONSTRUCT and of `GRAPH x { }` in quads */
  private parseTriplesTemplate(path: boolean): A.TriplesTemplate {
    const open = this.expectPunct("{");
    const items: A.PatternItem[] = [];
    while (!this.isPunct(this.peek(), "}")) {
      if (!this.startsTriples(this.peek())) this.fail(this.peek(), "a triple pattern or '}'");
      const node = this.parseTriplesSameSubject(path);
      const dot = this.optPunct(".");
      items.push({ node, dot });
      if (!dot && !this.isPunct(this.peek(), "}")) this.fail(this.peek(), "'.' or '}'");
    }
    const close = this.next();
    return { type: "TriplesTemplate", open, items, close };
  }

  /**
   * Notes 8 and 9 of the grammar: no variables in INSERT DATA / DELETE DATA,
   * no blank nodes in DELETE DATA, DELETE WHERE and DELETE templates.
   */
  private checkQuads(quads: A.TriplesTemplate, noVars: boolean, noBlankNodes: boolean): A.TriplesTemplate {
    const reject = (t: Token, what: string): never => {
      throw new SparqlSyntaxError(`${what} are not allowed here`, t.offset, t.line, t.column);
    };
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach((v, i) => {
          // An annotation block without a preceding reifier has an implicit blank node reifier.
          if (
            noBlankNodes &&
            (v as A.Node)?.type === "AnnotationBlock" &&
            (i === 0 || value[i - 1].type !== "Reifier")
          ) {
            reject((v as A.AnnotationBlock).open, "Blank nodes");
          }
          visit(v);
        });
        return;
      }
      const node = value as Record<string, unknown>;
      if (typeof node.offset === "number" && typeof node.value === "string") {
        const t = node as unknown as Token;
        if (noVars && t.type === "VAR") reject(t, "Variables");
        if (noBlankNodes && (t.type === "BLANK_NODE_LABEL" || this.isPunct(t, "["))) reject(t, "Blank nodes");
        return;
      }
      if (noBlankNodes && node.type === "Reifier" && !node.id) reject(node.tilde as Token, "Blank nodes");
      if (noBlankNodes && node.type === "ReifiedTriple" && !node.reifier) reject(node.open as Token, "Blank nodes");
      for (const child of Object.values(node)) visit(child);
    };
    visit(quads.items);
    return quads;
  }

  /** `{ Quads }`: triples and `GRAPH x { triples }` blocks */
  private parseQuads(): A.TriplesTemplate {
    const open = this.expectPunct("{");
    const items: A.PatternItem[] = [];
    while (!this.isPunct(this.peek(), "}")) {
      if (this.isKw(this.peek(), "GRAPH")) {
        const keyword = this.next();
        const name = this.parseVarOrIri();
        const template = this.parseTriplesTemplate(false);
        items.push({ node: { type: "QuadsGraph", keyword, name, template }, dot: this.optPunct(".") });
      } else if (this.startsTriples(this.peek())) {
        const node = this.parseTriplesSameSubject(false);
        const dot = this.optPunct(".");
        items.push({ node, dot });
        if (!dot && !this.isPunct(this.peek(), "}") && !this.isKw(this.peek(), "GRAPH")) {
          this.fail(this.peek(), "'.' or '}'");
        }
      } else {
        this.fail(this.peek(), "a triple pattern, GRAPH or '}'");
      }
    }
    const close = this.next();
    return { type: "TriplesTemplate", open, items, close };
  }

  // -------------------------------------------------------------------------
  // Graph patterns
  // -------------------------------------------------------------------------

  private parseGroupGraphPattern(): A.GroupGraphPattern {
    const open = this.expectPunct("{");
    if (this.isKw(this.peek(), "SELECT")) {
      const subSelect = this.parseSubSelect();
      const close = this.expectPunct("}");
      return { type: "GroupGraphPattern", open, subSelect, items: [], close };
    }
    const items: A.PatternItem[] = [];
    let needsDot = false; // a triples block was not terminated by '.'
    for (;;) {
      const t = this.peek();
      if (this.isPunct(t, "}")) break;
      if (this.startsTriples(t)) {
        if (needsDot) this.fail(t, "'.' before the next triple pattern");
        const node = this.parseTriplesSameSubject(true);
        const dot = this.optPunct(".");
        items.push({ node, dot });
        needsDot = !dot;
      } else {
        const node = this.parseGraphPatternNotTriples();
        items.push({ node, dot: this.optPunct(".") });
        needsDot = false;
      }
    }
    const close = this.next();
    return { type: "GroupGraphPattern", open, subSelect: null, items, close };
  }

  private parseGraphPatternNotTriples(): A.Node {
    const t = this.peek();
    if (this.isPunct(t, "{")) {
      const groups = [this.parseGroupGraphPattern()];
      const keywords: Token[] = [];
      while (this.isKw(this.peek(), "UNION")) {
        keywords.push(this.next());
        groups.push(this.parseGroupGraphPattern());
      }
      return groups.length === 1 ? groups[0] : { type: "Union", groups, keywords };
    }
    if (t.type === "NAME") {
      switch (t.value.toUpperCase()) {
        case "OPTIONAL": {
          const keyword = this.next();
          return { type: "Optional", keyword, group: this.parseGroupGraphPattern() };
        }
        case "MINUS": {
          const keyword = this.next();
          return { type: "Minus", keyword, group: this.parseGroupGraphPattern() };
        }
        case "GRAPH": {
          const keyword = this.next();
          const name = this.parseVarOrIri();
          return { type: "Graph", keyword, name, group: this.parseGroupGraphPattern() };
        }
        case "SERVICE": {
          const keyword = this.next();
          const silent = this.optKw("SILENT");
          const name = this.parseVarOrIri();
          return { type: "Service", keyword, silent, name, group: this.parseGroupGraphPattern() };
        }
        case "FILTER": {
          const keyword = this.next();
          return { type: "Filter", keyword, constraint: this.parseConstraint() };
        }
        case "BIND": {
          const keyword = this.next();
          const open = this.expectPunct("(");
          const expression = this.parseExpression();
          const as = this.expectKw("AS");
          const variable = this.parseVar();
          const close = this.expectPunct(")");
          return { type: "Bind", keyword, open, expression, as, variable, close };
        }
        case "VALUES":
          return this.parseValues();
      }
    }
    return this.fail(t, "a triple pattern, a graph pattern or '}'");
  }

  private parseValues(): A.Values {
    const keyword = this.expectKw("VALUES");
    return { type: "Values", keyword, block: this.parseDataBlock() };
  }

  private parseDataBlock(): A.DataBlock {
    const t = this.peek();
    if (t.type === "VAR") {
      const variable = this.term(this.next());
      const open = this.expectPunct("{");
      const values: A.Node[] = [];
      while (!this.isPunct(this.peek(), "}")) values.push(this.parseDataBlockValue());
      const close = this.next();
      return { type: "DataBlock", variable, variables: null, open, values, rows: [], close };
    }
    const varsOpen = this.expectPunct("(");
    const vars: A.Term[] = [];
    while (this.peek().type === "VAR") vars.push(this.term(this.next()));
    const varsClose = this.expectPunct(")");
    const open = this.expectPunct("{");
    const rows: A.DataBlockRow[] = [];
    while (!this.isPunct(this.peek(), "}")) {
      const rowOpen = this.expectPunct("(");
      const values: A.Node[] = [];
      while (!this.isPunct(this.peek(), ")")) values.push(this.parseDataBlockValue());
      if (values.length !== vars.length) {
        throw new SparqlSyntaxError(
          `Expected ${vars.length} value(s) in this VALUES row, found ${values.length}`,
          rowOpen.offset,
          rowOpen.line,
          rowOpen.column,
        );
      }
      rows.push({ open: rowOpen, values, close: this.next() });
    }
    const close = this.next();
    return {
      type: "DataBlock",
      variable: null,
      variables: { open: varsOpen, vars, close: varsClose },
      open,
      values: [],
      rows,
      close,
    };
  }

  private parseDataBlockValue(): A.Node {
    const t = this.peek();
    if (this.isKw(t, "UNDEF")) return this.term(this.next());
    if (this.isPunct(t, "<<(")) return this.parseTripleTerm("data");
    if (t.type === "IRIREF" || t.type === "PNAME_LN" || t.type === "PNAME_NS") return this.parseIri();
    const literal = this.tryParseLiteral();
    if (literal) return literal;
    return this.fail(t, "a data value (IRI, literal, UNDEF or triple term)");
  }

  // -------------------------------------------------------------------------
  // Triples
  // -------------------------------------------------------------------------

  private startsTriples(t: Token): boolean {
    switch (t.type) {
      case "VAR":
      case "IRIREF":
      case "PNAME_LN":
      case "PNAME_NS":
      case "BLANK_NODE_LABEL":
      case "STRING":
      case "INTEGER":
      case "DECIMAL":
      case "DOUBLE":
        return true;
      case "NAME":
        return this.isKw(t, "TRUE", "FALSE");
      case "PUNCT":
        return ["(", "[", "<<", "<<(", "+", "-"].includes(t.value);
      default:
        return false;
    }
  }

  /** TriplesSameSubject(Path) */
  private parseTriplesSameSubject(path: boolean): A.Triples {
    const t = this.peek();
    let subject: A.Node;
    let required = true;
    if (this.isPunct(t, "[") && !this.isEmptyPair("[", "]")) {
      subject = this.parseBlankNodePropertyList(path);
      required = false;
    } else if (this.isPunct(t, "(") && !this.isEmptyPair("(", ")")) {
      subject = this.parseCollection(path);
      required = false;
    } else if (this.isPunct(t, "<<")) {
      subject = this.parseReifiedTriple();
      required = false;
    } else {
      subject = this.parseVarOrTerm();
    }
    const properties = required || this.startsVerb(this.peek(), path) ? this.parsePropertyListNotEmpty(path) : null;
    return { type: "Triples", subject, properties };
  }

  private startsVerb(t: Token, path: boolean): boolean {
    if (t.type === "VAR" || t.type === "IRIREF" || t.type === "PNAME_LN" || t.type === "PNAME_NS") return true;
    if (t.type === "NAME" && t.value === "a") return true;
    return path && this.isPunct(t, "^", "!", "(");
  }

  private parsePropertyListNotEmpty(path: boolean): A.PropertyList {
    const entries: A.PropertyEntry[] = [];
    for (;;) {
      const verb = this.parseVerb(path);
      const objects: A.ObjectEntry[] = [];
      for (;;) {
        const node = this.parseGraphNode(path);
        const annotations = this.parseAnnotations(path);
        if (annotations.length > 0 && verb.type !== "Term") {
          const t = annotations[0].type === "Reifier" ? annotations[0].tilde : annotations[0].open;
          throw new SparqlSyntaxError(
            "A reifier or annotation can only follow a simple predicate, not a property path",
            t.offset,
            t.line,
            t.column,
          );
        }
        const entry: A.ObjectEntry = { node, annotations, comma: this.optPunct(",") };
        objects.push(entry);
        if (!entry.comma) break;
      }
      const semicolons: Token[] = [];
      while (this.isPunct(this.peek(), ";")) semicolons.push(this.next());
      entries.push({ verb, objects, semicolons });
      if (semicolons.length === 0 || !this.startsVerb(this.peek(), path)) break;
    }
    return { type: "PropertyList", entries };
  }

  private parseVerb(path: boolean): A.Node {
    const t = this.peek();
    if (t.type === "VAR") return this.term(this.next());
    if (!path) {
      if (t.type === "NAME" && t.value === "a") return this.term(this.next());
      return this.parseIri("a predicate");
    }
    return this.parsePath();
  }

  /** Verb of a reified triple or triple term: Var | iri | 'a' */
  private parseSimpleVerb(allowVar: boolean): A.Term {
    const t = this.peek();
    if (t.type === "VAR" && allowVar) return this.term(this.next());
    if (t.type === "NAME" && t.value === "a") return this.term(this.next());
    return this.parseIri("a predicate");
  }

  private parseAnnotations(path: boolean): (A.Reifier | A.AnnotationBlock)[] {
    const annotations: (A.Reifier | A.AnnotationBlock)[] = [];
    for (;;) {
      const t = this.peek();
      if (this.isPunct(t, "~")) {
        annotations.push(this.parseReifier());
      } else if (this.isPunct(t, "{|")) {
        const open = this.next();
        const properties = this.parsePropertyListNotEmpty(path);
        const close = this.expectPunct("|}");
        annotations.push({ type: "AnnotationBlock", open, properties, close });
      } else {
        return annotations;
      }
    }
  }

  private parseReifier(): A.Reifier {
    const tilde = this.expectPunct("~");
    const t = this.peek();
    let id: A.Term | null = null;
    if (t.type === "VAR" || t.type === "IRIREF" || t.type === "PNAME_LN" || t.type === "PNAME_NS") {
      id = this.term(this.next());
    } else if (t.type === "BLANK_NODE_LABEL") {
      id = this.term(this.next());
    } else if (this.isEmptyPair("[", "]")) {
      id = this.term(this.next(), this.next());
    }
    return { type: "Reifier", tilde, id };
  }

  private parseGraphNode(path: boolean): A.Node {
    const t = this.peek();
    if (this.isPunct(t, "[") && !this.isEmptyPair("[", "]")) return this.parseBlankNodePropertyList(path);
    if (this.isPunct(t, "(") && !this.isEmptyPair("(", ")")) return this.parseCollection(path);
    if (this.isPunct(t, "<<")) return this.parseReifiedTriple();
    return this.parseVarOrTerm();
  }

  private parseBlankNodePropertyList(path: boolean): A.BlankNodePropertyList {
    const open = this.expectPunct("[");
    const properties = this.parsePropertyListNotEmpty(path);
    const close = this.expectPunct("]");
    return { type: "BlankNodePropertyList", open, properties, close };
  }

  private parseCollection(path: boolean): A.Collection {
    const open = this.expectPunct("(");
    const items: A.Node[] = [];
    while (!this.isPunct(this.peek(), ")")) items.push(this.parseGraphNode(path));
    const close = this.next();
    return { type: "Collection", open, items, close };
  }

  private parseReifiedTriple(): A.ReifiedTriple {
    const open = this.expectPunct("<<");
    const subject = this.parseReifiedTripleTerm();
    const predicate = this.parseSimpleVerb(true);
    const object = this.parseReifiedTripleTerm();
    const reifier = this.isPunct(this.peek(), "~") ? this.parseReifier() : null;
    const close = this.expectPunct(">>");
    return { type: "ReifiedTriple", open, subject, predicate, object, reifier, close };
  }

  /** ReifiedTripleSubject / ReifiedTripleObject */
  private parseReifiedTripleTerm(): A.Node {
    const t = this.peek();
    if (this.isPunct(t, "<<")) return this.parseReifiedTriple();
    if (this.isPunct(t, "<<(")) return this.parseTripleTerm("pattern");
    if (this.isPunct(t, "(")) this.fail(t, "a variable, IRI, literal, blank node or triple");
    if (this.isPunct(t, "[") && !this.isEmptyPair("[", "]")) {
      this.fail(t, "a variable, IRI, literal, blank node or triple");
    }
    return this.parseVarOrTerm();
  }

  /**
   * `<<( s p o )>>`
   * - pattern: TripleTerm (subject/object: var, iri, literal, bnode, triple term)
   * - expression: ExprTripleTerm (subject: iri | var; object: iri, literal, var, triple term)
   * - data: TripleTermData (subject: iri; object: iri, literal, triple term)
   */
  private parseTripleTerm(kind: "pattern" | "expression" | "data"): A.TripleTerm {
    const open = this.expectPunct("<<(");
    const part = (isSubject: boolean): A.Node => {
      const t = this.peek();
      if (this.isPunct(t, "<<(")) {
        if (isSubject && kind !== "pattern") this.fail(t, "an IRI or variable");
        return this.parseTripleTerm(kind);
      }
      if (t.type === "VAR") {
        if (kind === "data") this.fail(t, "an IRI or literal (variables are not allowed in VALUES)");
        return this.term(this.next());
      }
      if (t.type === "IRIREF" || t.type === "PNAME_LN" || t.type === "PNAME_NS") return this.parseIri();
      if (t.type === "BLANK_NODE_LABEL" || this.isEmptyPair("[", "]")) {
        if (kind !== "pattern") this.fail(t, "an IRI, literal or variable");
        return t.type === "BLANK_NODE_LABEL" ? this.term(this.next()) : this.term(this.next(), this.next());
      }
      if (isSubject && kind !== "pattern") this.fail(t, kind === "data" ? "an IRI" : "an IRI or variable");
      const literal = this.tryParseLiteral();
      if (literal) return literal;
      return this.fail(t, "an RDF term");
    };
    const subject = part(true);
    const predicate = this.parseSimpleVerb(kind !== "data");
    const object = part(false);
    const close = this.expectPunct(")>>");
    return { type: "TripleTerm", open, subject, predicate, object, close };
  }

  // -------------------------------------------------------------------------
  // Terms
  // -------------------------------------------------------------------------

  private isVarOrIri(t: Token): boolean {
    return t.type === "VAR" || t.type === "IRIREF" || t.type === "PNAME_LN" || t.type === "PNAME_NS";
  }

  private parseVar(): A.Term {
    const t = this.peek();
    if (t.type !== "VAR") this.fail(t, "a variable");
    return this.term(this.next());
  }

  private parseIri(expected = "an IRI"): A.Term {
    const t = this.peek();
    if (t.type !== "IRIREF" && t.type !== "PNAME_LN" && t.type !== "PNAME_NS") this.fail(t, expected);
    return this.term(this.next());
  }

  private parseVarOrIri(): A.Term {
    const t = this.peek();
    if (!this.isVarOrIri(t)) this.fail(t, "a variable or an IRI");
    return this.term(this.next());
  }

  /** RDFLiteral | NumericLiteral | BooleanLiteral, or null */
  private tryParseLiteral(): A.Term | null {
    const t = this.peek();
    if (t.type === "STRING") {
      const tokens = [this.next()];
      const n = this.peek();
      if (n.type === "LANG_DIR") {
        tokens.push(this.next());
      } else if (this.isPunct(n, "^^")) {
        tokens.push(this.next());
        tokens.push(...this.parseIri().tokens);
      }
      return this.term(...tokens);
    }
    if (t.type === "INTEGER" || t.type === "DECIMAL" || t.type === "DOUBLE") return this.term(this.next());
    if (this.isPunct(t, "+", "-")) {
      const n = this.peek(1);
      if ((n.type === "INTEGER" || n.type === "DECIMAL" || n.type === "DOUBLE") && !n.spaceBefore) {
        return this.term(this.next(), this.next());
      }
      return null;
    }
    if (t.type === "NAME" && this.isKw(t, "TRUE", "FALSE")) return this.term(this.next());
    return null;
  }

  /** VarOrTerm: Var | iri | RDFLiteral | NumericLiteral | BooleanLiteral | BlankNode | NIL | TripleTerm */
  private parseVarOrTerm(): A.Node {
    const t = this.peek();
    switch (t.type) {
      case "VAR":
      case "IRIREF":
      case "PNAME_LN":
      case "PNAME_NS":
      case "BLANK_NODE_LABEL":
        return this.term(this.next());
    }
    if (this.isEmptyPair("(", ")") || this.isEmptyPair("[", "]")) return this.term(this.next(), this.next());
    if (this.isPunct(t, "<<(")) return this.parseTripleTerm("pattern");
    const literal = this.tryParseLiteral();
    if (literal) return literal;
    return this.fail(t, "an RDF term or a variable");
  }

  // -------------------------------------------------------------------------
  // Property paths
  // -------------------------------------------------------------------------

  private parsePath(): A.Node {
    const items = [this.parsePathSequence()];
    const separators: Token[] = [];
    while (this.isPunct(this.peek(), "|")) {
      separators.push(this.next());
      items.push(this.parsePathSequence());
    }
    return items.length === 1 ? items[0] : { type: "PathAlternative", items, separators };
  }

  private parsePathSequence(): A.Node {
    const items = [this.parsePathEltOrInverse()];
    const separators: Token[] = [];
    while (this.isPunct(this.peek(), "/")) {
      separators.push(this.next());
      items.push(this.parsePathEltOrInverse());
    }
    return items.length === 1 ? items[0] : { type: "PathSequence", items, separators };
  }

  private parsePathEltOrInverse(): A.Node {
    if (this.isPunct(this.peek(), "^")) {
      const caret = this.next();
      return { type: "PathInverse", caret, item: this.parsePathElt() };
    }
    return this.parsePathElt();
  }

  private parsePathElt(): A.Node {
    const primary = this.parsePathPrimary();
    const t = this.peek();
    if (this.isPunct(t, "?", "*", "+") && !this.isPathModAmbiguous(t)) {
      return { type: "PathModified", item: primary, modifier: this.next() };
    }
    return primary;
  }

  /** `:p ?x` must not read `?` as a modifier: the lexer makes `?x` a VAR, so only a bare `?` is a modifier. */
  private isPathModAmbiguous(t: Token): boolean {
    // A signed number such as `:p +1` would be read as path mod + number by
    // the tokenizer; SPARQL's longest-match rule makes `+1` an INTEGER_POSITIVE.
    if (this.isPunct(t, "+", "-")) {
      const n = this.peek(1);
      return (n.type === "INTEGER" || n.type === "DECIMAL" || n.type === "DOUBLE") && !n.spaceBefore;
    }
    return false;
  }

  private parsePathPrimary(): A.Node {
    const t = this.peek();
    if (t.type === "NAME" && t.value === "a") return this.term(this.next());
    if (this.isPunct(t, "!")) {
      const bang = this.next();
      return { type: "PathNegated", bang, item: this.parsePathNegatedPropertySet() };
    }
    if (this.isPunct(t, "(")) {
      const open = this.next();
      const path = this.parsePath();
      const close = this.expectPunct(")");
      return { type: "PathGroup", open, path, close };
    }
    return this.parseIri("a predicate or property path");
  }

  private parsePathNegatedPropertySet(): A.Node {
    if (this.isPunct(this.peek(), "(")) {
      const open = this.next();
      if (this.isPunct(this.peek(), ")")) return { type: "PathGroup", open, path: null, close: this.next() };
      const items = [this.parsePathOneInPropertySet()];
      const separators: Token[] = [];
      while (this.isPunct(this.peek(), "|")) {
        separators.push(this.next());
        items.push(this.parsePathOneInPropertySet());
      }
      const close = this.expectPunct(")");
      const path: A.Node = items.length === 1 ? items[0] : { type: "PathAlternative", items, separators };
      return { type: "PathGroup", open, path, close };
    }
    return this.parsePathOneInPropertySet();
  }

  private parsePathOneInPropertySet(): A.Node {
    const t = this.peek();
    if (this.isPunct(t, "^")) {
      const caret = this.next();
      const n = this.peek();
      const item = n.type === "NAME" && n.value === "a" ? this.term(this.next()) : this.parseIri();
      return { type: "PathInverse", caret, item };
    }
    if (t.type === "NAME" && t.value === "a") return this.term(this.next());
    return this.parseIri();
  }

  // -------------------------------------------------------------------------
  // Expressions
  // -------------------------------------------------------------------------

  parseExpression(): A.Node {
    let left = this.parseAnd();
    while (this.isPunct(this.peek(), "||")) {
      const operator = this.next();
      left = { type: "Binary", left, operator, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): A.Node {
    let left = this.parseRelational();
    while (this.isPunct(this.peek(), "&&")) {
      const operator = this.next();
      left = { type: "Binary", left, operator, right: this.parseRelational() };
    }
    return left;
  }

  private parseRelational(): A.Node {
    const left = this.parseAdditive();
    const t = this.peek();
    if (this.isPunct(t, "=", "!=", "<", ">", "<=", ">=")) {
      const operator = this.next();
      return { type: "Binary", left, operator, right: this.parseAdditive() };
    }
    if (this.isKw(t, "IN")) {
      const inKw = this.next();
      return { type: "In", expression: left, not: null, in: inKw, list: this.parseExpressionList() };
    }
    if (this.isKw(t, "NOT") && this.isKw(this.peek(1), "IN")) {
      const not = this.next();
      const inKw = this.next();
      return { type: "In", expression: left, not, in: inKw, list: this.parseExpressionList() };
    }
    return left;
  }

  private parseAdditive(): A.Node {
    let left = this.parseMultiplicative();
    while (this.isPunct(this.peek(), "+", "-")) {
      const operator = this.next();
      left = { type: "Binary", left, operator, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): A.Node {
    let left = this.parseUnary();
    while (this.isPunct(this.peek(), "*", "/")) {
      const operator = this.next();
      left = { type: "Binary", left, operator, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): A.Node {
    const t = this.peek();
    if (this.isPunct(t, "!")) {
      const operator = this.next();
      return { type: "Unary", operator, expression: this.parseUnary() };
    }
    if (this.isPunct(t, "+", "-")) {
      const n = this.peek(1);
      // A signed number literal (`-1`) is a single term.
      if ((n.type === "INTEGER" || n.type === "DECIMAL" || n.type === "DOUBLE") && !n.spaceBefore) {
        return this.term(this.next(), this.next());
      }
      const operator = this.next();
      return { type: "Unary", operator, expression: this.parsePrimary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): A.Node {
    const t = this.peek();
    if (this.isPunct(t, "(")) return this.parseBracketed();
    if (this.isPunct(t, "<<(")) return this.parseTripleTerm("expression");
    if (t.type === "VAR") return this.term(this.next());
    if (t.type === "IRIREF" || t.type === "PNAME_LN" || t.type === "PNAME_NS") {
      const iri = this.parseIri();
      return this.isPunct(this.peek(), "(") ? this.parseArgList(iri, false) : iri;
    }
    if (t.type === "NAME" && !this.isKw(t, "TRUE", "FALSE")) return this.parseBuiltInCall();
    const literal = this.tryParseLiteral();
    if (literal) return literal;
    return this.fail(t, "an expression");
  }

  private parseBracketed(): A.Bracketed {
    const open = this.expectPunct("(");
    const expression = this.parseExpression();
    const close = this.expectPunct(")");
    return { type: "Bracketed", open, expression, close };
  }

  private parseExpressionList(): A.ExpressionList {
    const open = this.expectPunct("(");
    const items: A.Node[] = [];
    const commas: Token[] = [];
    if (!this.isPunct(this.peek(), ")")) {
      items.push(this.parseExpression());
      while (this.isPunct(this.peek(), ",")) {
        commas.push(this.next());
        items.push(this.parseExpression());
      }
    }
    const close = this.expectPunct(")");
    return { type: "ExpressionList", open, items, commas, close };
  }

  private parseBuiltInCall(): A.Node {
    const t = this.peek();
    const name = t.value.toUpperCase();
    if (name === "EXISTS") {
      const keyword = this.next();
      return { type: "Exists", not: null, keyword, group: this.parseGroupGraphPattern() };
    }
    if (name === "NOT" && this.isKw(this.peek(1), "EXISTS")) {
      const not = this.next();
      const keyword = this.next();
      return { type: "Exists", not, keyword, group: this.parseGroupGraphPattern() };
    }
    if (t.type !== "NAME" || !BUILTINS.has(name)) return this.fail(t, "an expression");
    const nameToken = this.next();
    if (!this.isPunct(this.peek(), "(")) this.fail(this.peek(), `'(' after ${nameToken.value}`);
    const call = this.parseArgList(nameToken, true);

    // Arity checks keep the parser as strict as the grammar.
    const n = call.args.length;
    if (NO_ARGS.has(name)) {
      if (n > 0) this.fail(call.args.length ? this.tokenOf(call.args[0]) : call.close, "')'");
    } else if (ARITY[name]) {
      const [min, max] = ARITY[name];
      if (n < min || n > max) {
        throw new SparqlSyntaxError(
          `${nameToken.value} expects ${min === max ? min : `${min} to ${max}`} argument(s), found ${n}`,
          nameToken.offset,
          nameToken.line,
          nameToken.column,
        );
      }
    } else if (n !== 1) {
      throw new SparqlSyntaxError(
        `${nameToken.value} expects 1 argument, found ${n}`,
        nameToken.offset,
        nameToken.line,
        nameToken.column,
      );
    }
    if (call.distinct && !AGGREGATES.has(name)) this.fail(call.distinct, "an expression");
    if (call.separator && name !== "GROUP_CONCAT") this.fail(call.separator.semicolon, "')'");
    if (name === "BOUND" && (call.args[0].type !== "Term" || call.args[0].tokens[0].type !== "VAR")) {
      this.fail(this.tokenOf(call.args[0]), "a variable");
    }
    return call;
  }

  /** First token of a node, used for error positions. */
  private tokenOf(node: A.Node): Token {
    switch (node.type) {
      case "Term":
        return node.tokens[0];
      case "Binary":
        return this.tokenOf(node.left);
      case "In":
        return this.tokenOf(node.expression);
      case "Call":
        return node.name.type === "Term" ? node.name.tokens[0] : node.name;
      default:
        return "open" in node ? (node as { open: Token }).open : this.peek();
    }
  }

  /** `name( [DISTINCT] args [; SEPARATOR = "x"] )` */
  private parseArgList(name: Token | A.Term, builtin: boolean): A.Call {
    const open = this.expectPunct("(");
    const upper = name.type === "Term" ? "" : name.value.toUpperCase();
    const distinct = this.optKw("DISTINCT");
    const args: A.Node[] = [];
    const commas: Token[] = [];
    let separator: A.Call["separator"] = null;
    if (!this.isPunct(this.peek(), ")")) {
      if (upper === "COUNT" && this.isPunct(this.peek(), "*")) {
        args.push(this.term(this.next()));
      } else {
        args.push(this.parseExpression());
      }
      while (this.isPunct(this.peek(), ",")) {
        commas.push(this.next());
        args.push(this.parseExpression());
      }
      if (this.isPunct(this.peek(), ";")) {
        const semicolon = this.next();
        const keyword = this.expectKw("SEPARATOR");
        const equals = this.expectPunct("=");
        const value = this.peek();
        if (value.type !== "STRING") this.fail(value, "a string");
        separator = { semicolon, keyword, equals, value: this.term(this.next()) };
      }
    } else if (distinct) {
      this.fail(this.peek(), "an expression");
    }
    const close = this.expectPunct(")");
    return {
      type: "Call",
      name,
      builtin,
      open,
      distinct,
      args,
      commas,
      separator,
      close,
    };
  }
}
