/**
 * Pretty-printer: turns the syntax tree back into SPARQL text.
 */

import type * as A from "./ast.ts";
import type { Token } from "./lexer.ts";
import { Writer } from "./writer.ts";

export type Case = "upper" | "lower" | "preserve";

export interface FormatOptions {
  /** Indentation: a number of spaces or the indent string itself (e.g. `"\t"`). Default: 2 */
  indent?: number | string;
  /** Case of keywords such as SELECT, WHERE, OPTIONAL. Default: `"upper"` */
  keywordCase?: Case;
  /** Case of built-in function names such as `regex`, `STR`, `COUNT`. Default: `"preserve"` */
  functionCase?: Case;
  /** Align the predicates of a subject that has several (`;`) under the first predicate. Default: true */
  alignPredicates?: boolean;
  /** Keep (at most one) blank line where the query has blank lines between statements. Default: true */
  preserveBlankLines?: boolean;
  /** Put small group graph patterns on one line: `OPTIONAL { ?s :p ?o }`. Default: false */
  compact?: boolean;
  /** Maximum line width used by `compact` and to wrap long `VALUES` lists. Default: 100 */
  lineWidth?: number;
  /** Always write `WHERE` before the group graph pattern of SELECT, CONSTRUCT and DESCRIBE. Default: true */
  insertWhere?: boolean;
}

interface ResolvedOptions {
  indent: string;
  keywordCase: Case;
  functionCase: Case;
  alignPredicates: boolean;
  preserveBlankLines: boolean;
  compact: boolean;
  lineWidth: number;
  insertWhere: boolean;
}

export function resolveOptions(options: FormatOptions = {}): ResolvedOptions {
  const indent =
    typeof options.indent === "string" ? options.indent : " ".repeat(Math.max(0, Math.floor(options.indent ?? 2)));
  return {
    indent,
    keywordCase: options.keywordCase ?? "upper",
    functionCase: options.functionCase ?? "preserve",
    alignPredicates: options.alignPredicates ?? true,
    preserveBlankLines: options.preserveBlankLines ?? true,
    compact: options.compact ?? false,
    lineWidth: options.lineWidth ?? 100,
    insertWhere: options.insertWhere ?? true,
  };
}

function applyCase(text: string, c: Case): string {
  return c === "upper" ? text.toUpperCase() : c === "lower" ? text.toLowerCase() : text;
}

export class Printer {
  private w: Writer;
  private options: ResolvedOptions;

  constructor(options: ResolvedOptions) {
    this.options = options;
    this.w = this.newWriter();
  }

  private newWriter(ignoreComments = false): Writer {
    return new Writer({
      indent: this.options.indent,
      preserveBlankLines: this.options.preserveBlankLines,
      ignoreComments,
    });
  }

  print(ast: A.Ast): { text: string; comments: number } {
    if (ast.type === "Query") this.query(ast);
    else this.update(ast);
    return { text: this.w.toString(), comments: this.w.commentCount };
  }

  /**
   * Render `fn` on a scratch writer and return the result if it fits on one
   * line (no comments, no line breaks) within `width` characters.
   */
  private measure(fn: () => void, width: number, ignoreComments = false): string | null {
    const saved = this.w;
    this.w = this.newWriter(ignoreComments);
    try {
      fn();
      const line = this.w.singleLine();
      return line !== null && line.length <= width ? line : null;
    } finally {
      this.w = saved;
    }
  }

  private remainingWidth(): number {
    return this.options.lineWidth - this.w.column();
  }

  // -------------------------------------------------------------------------
  // Tokens
  // -------------------------------------------------------------------------

  private kw(t: Token, blank = false): void {
    this.w.token(t, applyCase(t.value, this.options.keywordCase), blank);
  }

  /** A keyword that was not in the source (e.g. an inserted WHERE). */
  private synthKw(text: string): void {
    this.w.text(applyCase(text, this.options.keywordCase));
  }

  private tok(t: Token, blank = false): void {
    this.w.token(t, t.value, blank);
  }

  private sp(): void {
    this.w.space();
  }

  private nl(): void {
    this.w.newline();
  }

  // -------------------------------------------------------------------------
  // Units
  // -------------------------------------------------------------------------

  private prologue(decls: A.PrologueDecl[]): void {
    for (const decl of decls) {
      this.nl();
      this.kw(decl.keyword, true);
      this.sp();
      if (decl.prefix) {
        this.tok(decl.prefix);
        this.sp();
      }
      this.tok(decl.value);
    }
    if (decls.length > 0) this.w.blankLine();
  }

  private query(q: A.Query): void {
    this.prologue(q.prologue);
    const form = q.form;
    switch (form.type) {
      case "Select":
        this.selectClause(form.select);
        this.datasets(form.datasets);
        this.whereClause(form.where, this.options.insertWhere);
        this.solutionModifier(form.modifiers);
        break;
      case "Construct":
        this.nl();
        this.kw(form.keyword);
        if (form.template) {
          this.sp();
          this.triplesTemplate(form.template);
          this.datasets(form.datasets);
          this.whereClause(form.where!, this.options.insertWhere);
        } else {
          this.datasets(form.datasets);
          this.nl();
          this.kw(form.shortForm!.keyword);
          this.sp();
          this.triplesTemplate(form.shortForm!.template);
        }
        this.solutionModifier(form.modifiers);
        break;
      case "Describe":
        this.nl();
        this.kw(form.keyword);
        if (form.star) {
          this.sp();
          this.tok(form.star);
        }
        for (const item of form.items) {
          this.sp();
          this.term(item);
        }
        this.datasets(form.datasets);
        if (form.where) this.whereClause(form.where, this.options.insertWhere);
        this.solutionModifier(form.modifiers);
        break;
      case "Ask":
        this.nl();
        this.kw(form.keyword);
        if (form.datasets.length === 0 && !form.where.keyword) {
          this.sp();
          this.group(form.where.group);
        } else {
          this.datasets(form.datasets);
          this.whereClause(form.where, true);
        }
        this.solutionModifier(form.modifiers);
        break;
    }
    if (q.values) {
      this.nl();
      this.values(q.values);
    }
    this.nl();
    this.w.drop(q.eof);
  }

  private selectClause(s: A.SelectClause): void {
    this.nl();
    this.kw(s.keyword);
    if (s.modifier) {
      this.sp();
      this.kw(s.modifier);
    }
    if (s.star) {
      this.sp();
      this.tok(s.star);
    }
    for (const item of s.items) {
      this.sp();
      if (item.type === "Term") this.term(item);
      else this.projection(item);
    }
  }

  private projection(p: A.Projection): void {
    this.tok(p.open);
    this.expr(p.expression);
    if (p.as && p.variable) {
      this.sp();
      this.kw(p.as);
      this.sp();
      this.term(p.variable);
    }
    this.tok(p.close);
  }

  private datasets(datasets: A.DatasetClause[]): void {
    for (const d of datasets) {
      this.nl();
      this.kw(d.from);
      if (d.named) {
        this.sp();
        this.kw(d.named);
      }
      this.sp();
      this.term(d.iri);
    }
  }

  private whereClause(where: A.WhereClause, insertWhere: boolean): void {
    this.nl();
    if (where.keyword) {
      this.kw(where.keyword);
      this.sp();
    } else if (insertWhere) {
      this.synthKw("WHERE");
      this.sp();
    }
    this.group(where.group);
  }

  private solutionModifier(m: A.SolutionModifier): void {
    if (m.groupBy) {
      this.nl();
      this.kw(m.groupBy.group);
      this.sp();
      this.kw(m.groupBy.by);
      for (const c of m.groupBy.conditions) {
        this.sp();
        this.condition(c);
      }
    }
    if (m.having) {
      this.nl();
      this.kw(m.having.keyword);
      for (const c of m.having.conditions) {
        this.sp();
        this.condition(c);
      }
    }
    if (m.orderBy) {
      this.nl();
      this.kw(m.orderBy.order);
      this.sp();
      this.kw(m.orderBy.by);
      for (const c of m.orderBy.conditions) {
        this.sp();
        this.condition(c);
      }
    }
    for (const lo of m.limitOffset) {
      this.nl();
      this.kw(lo.keyword);
      this.sp();
      this.tok(lo.value);
    }
  }

  private condition(c: A.Node): void {
    if (c.type === "Projection") this.projection(c);
    else if (c.type === "OrderCondition") {
      if (c.direction) this.kw(c.direction);
      this.expr(c.expression);
    } else this.expr(c);
  }

  private update(u: A.Update): void {
    let first = true;
    for (const part of u.parts) {
      if (!first && (part.prologue.length > 0 || part.operation)) this.w.blankLine();
      this.prologue(part.prologue);
      if (part.operation) {
        this.updateOperation(part.operation);
        first = false;
      }
      if (part.semicolon) {
        this.sp();
        this.tok(part.semicolon);
      }
    }
    this.nl();
    this.w.drop(u.eof);
  }

  private words(words: A.Words): void {
    words.tokens.forEach((t, i) => {
      if (i > 0) this.sp();
      if ("tokens" in t) this.term(t);
      else this.kw(t);
    });
  }

  private updateOperation(op: A.UpdateOperation): void {
    this.nl();
    switch (op.type) {
      case "Load":
        this.kw(op.keyword);
        if (op.silent) {
          this.sp();
          this.kw(op.silent);
        }
        this.sp();
        this.term(op.iri);
        if (op.into) {
          this.sp();
          this.words(op.into);
        }
        break;
      case "GraphManagement":
        this.kw(op.keyword);
        if (op.silent) {
          this.sp();
          this.kw(op.silent);
        }
        this.sp();
        this.words(op.target);
        break;
      case "GraphTransfer":
        this.kw(op.keyword);
        if (op.silent) {
          this.sp();
          this.kw(op.silent);
        }
        this.sp();
        this.words(op.from);
        this.sp();
        this.kw(op.to);
        this.sp();
        this.words(op.target);
        break;
      case "QuadData":
        this.kw(op.keywords[0]);
        this.sp();
        this.kw(op.keywords[1]);
        this.sp();
        this.triplesTemplate(op.quads);
        break;
      case "Modify":
        if (op.with) {
          this.kw(op.with.keyword);
          this.sp();
          this.term(op.with.iri);
          this.nl();
        }
        if (op.delete) {
          this.kw(op.delete.keyword);
          this.sp();
          this.triplesTemplate(op.delete.quads);
          this.nl();
        }
        if (op.insert) {
          this.kw(op.insert.keyword);
          this.sp();
          this.triplesTemplate(op.insert.quads);
          this.nl();
        }
        for (const using of op.using) {
          this.kw(using.keyword);
          if (using.named) {
            this.sp();
            this.kw(using.named);
          }
          this.sp();
          this.term(using.iri);
          this.nl();
        }
        this.whereClause(op.where, true);
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------

  /**
   * Print `open`, the items on their own lines one level deeper, and `close`.
   * Comments before `close` stay inside the block.
   */
  private block(open: Token, close: Token, isEmpty: boolean, body: () => void, openText = open.value): void {
    this.w.token(open, openText);
    if (isEmpty && close.leading.length === 0 && !open.trailing) {
      this.tok(close);
      return;
    }
    this.w.indent();
    body();
    this.nl();
    this.w.commentsBefore(close);
    this.w.dedent();
    this.nl();
    this.tok(close);
  }

  /** Try to print a block on a single line (compact mode). */
  private inlineBlock(open: Token, close: Token, body: () => void): boolean {
    if (!this.options.compact) return false;
    const line = this.measure(() => {
      this.tok(open);
      this.sp();
      body();
      this.sp();
      this.tok(close);
    }, this.remainingWidth());
    if (line === null) return false;
    this.tok(open);
    this.sp();
    body();
    this.sp();
    this.tok(close);
    return true;
  }

  group(g: A.GroupGraphPattern): void {
    if (g.subSelect) {
      const sub = g.subSelect;
      this.block(g.open, g.close, false, () => {
        this.selectClause(sub.select);
        this.whereClause(sub.where, this.options.insertWhere);
        this.solutionModifier(sub.modifiers);
        if (sub.values) {
          this.nl();
          this.values(sub.values);
        }
      });
      return;
    }
    if (
      g.items.length === 1 &&
      g.items[0].node.type === "Triples" &&
      this.inlineBlock(g.open, g.close, () => this.patternItem(g.items[0], true))
    ) {
      return;
    }
    this.block(g.open, g.close, g.items.length === 0, () => {
      g.items.forEach((item) => {
        this.nl();
        this.patternItem(item, false);
      });
    });
  }

  private triplesTemplate(t: A.TriplesTemplate): void {
    if (
      t.items.length === 1 &&
      t.items[0].node.type === "Triples" &&
      this.inlineBlock(t.open, t.close, () => this.patternItem(t.items[0], true))
    ) {
      return;
    }
    this.block(t.open, t.close, t.items.length === 0, () => {
      for (const item of t.items) {
        this.nl();
        this.patternItem(item, false);
      }
    });
  }

  /** An item of a group: triples end with ` .`, other patterns have no dot. */
  private patternItem(item: A.PatternItem, inline: boolean): void {
    const node = item.node;
    if (node.type === "Triples") {
      this.triples(node, true);
      if (inline) {
        if (item.dot) this.w.drop(item.dot);
      } else {
        this.sp();
        if (item.dot) this.tok(item.dot);
        else this.w.text(".");
      }
      return;
    }
    this.pattern(node, true);
    if (item.dot) this.w.drop(item.dot);
  }

  private pattern(node: A.Node, first: boolean): void {
    switch (node.type) {
      case "GroupGraphPattern":
        this.markBlank(node.open, first);
        this.group(node);
        break;
      case "Union":
        node.groups.forEach((g, i) => {
          if (i > 0) {
            this.nl();
            this.kw(node.keywords[i - 1]);
            this.nl();
            this.group(g);
          } else {
            this.markBlank(g.open, first);
            this.group(g);
          }
        });
        break;
      case "Optional":
      case "Minus":
        this.kw(node.keyword, first);
        this.sp();
        this.group(node.group);
        break;
      case "Graph":
        this.kw(node.keyword, first);
        this.sp();
        this.term(node.name);
        this.sp();
        this.group(node.group);
        break;
      case "Service":
        this.kw(node.keyword, first);
        if (node.silent) {
          this.sp();
          this.kw(node.silent);
        }
        this.sp();
        this.term(node.name);
        this.sp();
        this.group(node.group);
        break;
      case "Filter":
        this.kw(node.keyword, first);
        this.sp();
        this.expr(node.constraint);
        break;
      case "Bind":
        this.kw(node.keyword, first);
        this.sp();
        this.tok(node.open);
        this.expr(node.expression);
        this.sp();
        this.kw(node.as);
        this.sp();
        this.term(node.variable);
        this.tok(node.close);
        break;
      case "Values":
        this.markBlank(node.keyword, first);
        this.values(node);
        break;
      case "QuadsGraph":
        this.kw(node.keyword, first);
        this.sp();
        this.term(node.name);
        this.sp();
        this.triplesTemplate(node.template);
        break;
      default:
        throw new Error(`Unexpected pattern ${node.type}`);
    }
  }

  /** Honour a blank line before the first token of a statement. */
  private markBlank(t: Token, blank: boolean): void {
    if (blank && t.blankLinesBefore > 0 && this.options.preserveBlankLines && this.w.atLineStart) {
      this.w.commentsBefore(t);
      this.w.blankLine();
    }
  }

  private values(v: A.Values): void {
    this.kw(v.keyword, true);
    this.sp();
    const b = v.block;
    if (b.variable) {
      this.term(b.variable);
      this.sp();
      const values = b.values;
      const inline = this.measure(() => this.valuesOneVar(b, true), this.remainingWidth());
      if (inline !== null || values.length === 0) {
        this.valuesOneVar(b, true);
      } else {
        this.valuesOneVar(b, false);
      }
      return;
    }
    const vars = b.variables!;
    this.tok(vars.open);
    vars.vars.forEach((variable, i) => {
      if (i > 0) this.sp();
      this.term(variable);
    });
    this.tok(vars.close);
    this.sp();
    this.block(b.open, b.close, b.rows.length === 0, () => {
      for (const row of b.rows) {
        this.nl();
        this.tok(row.open);
        row.values.forEach((value, i) => {
          if (i > 0) this.sp();
          this.node(value);
        });
        this.tok(row.close);
      }
    });
  }

  private valuesOneVar(b: A.DataBlock, inline: boolean): void {
    if (inline) {
      this.tok(b.open);
      for (const value of b.values) {
        this.sp();
        this.node(value);
      }
      if (b.values.length > 0) this.sp();
      this.tok(b.close);
      return;
    }
    this.block(b.open, b.close, false, () => {
      for (const value of b.values) {
        this.nl();
        this.node(value);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Triples
  // -------------------------------------------------------------------------

  private triples(t: A.Triples, blank: boolean): void {
    this.node(t.subject, blank);
    if (t.properties) {
      this.sp();
      this.propertyList(t.properties);
    }
  }

  private propertyList(pl: A.PropertyList, inline = false): void {
    // Continuation lines start under the first predicate, or one indent deeper than the subject's line.
    const indent = this.options.alignPredicates ? this.w.alignment() : this.w.continuation();
    pl.entries.forEach((entry, i) => {
      if (i > 0) {
        if (inline) this.sp();
        else this.w.newlineWith(indent);
      }
      this.node(entry.verb);
      this.sp();
      const object = (o: A.ObjectEntry) => {
        this.node(o.node);
        for (const a of o.annotations) {
          this.sp();
          this.node(a);
        }
        if (o.comma) this.tok(o.comma);
      };
      // An object list that doesn't fit on the line gets one object per line, aligned.
      const wrap =
        !inline &&
        entry.objects.length > 1 &&
        this.measure(
          () => entry.objects.forEach((o, j) => (j > 0 && this.sp(), object(o))),
          this.remainingWidth() - 2,
          true,
        ) === null;
      const objectIndent = wrap ? this.w.alignment() : "";
      entry.objects.forEach((o, j) => {
        if (j > 0) {
          if (wrap) this.w.newlineWith(objectIndent);
          else this.sp();
        }
        object(o);
      });
      const last = i === pl.entries.length - 1;
      entry.semicolons.forEach((semi, k) => {
        if (!last && k === 0) {
          this.sp();
          this.tok(semi);
        } else {
          this.w.drop(semi);
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Nodes (terms, paths, expressions)
  // -------------------------------------------------------------------------

  private term(t: A.Term, blank = false): void {
    t.tokens.forEach((token, i) => {
      if (token.type === "NAME" && token.value !== "a" && !/^(true|false)$/i.test(token.value)) {
        this.kw(token, blank && i === 0);
      } else {
        this.tok(token, blank && i === 0);
      }
    });
  }

  private node(n: A.Node, blank = false): void {
    switch (n.type) {
      case "Term":
        this.term(n, blank);
        break;
      case "TripleTerm":
        this.tok(n.open, blank);
        this.sp();
        this.node(n.subject);
        this.sp();
        this.term(n.predicate);
        this.sp();
        this.node(n.object);
        this.sp();
        this.tok(n.close);
        break;
      case "ReifiedTriple":
        this.tok(n.open, blank);
        this.sp();
        this.node(n.subject);
        this.sp();
        this.term(n.predicate);
        this.sp();
        this.node(n.object);
        if (n.reifier) {
          this.sp();
          this.node(n.reifier);
        }
        this.sp();
        this.tok(n.close);
        break;
      case "Reifier":
        this.tok(n.tilde);
        if (n.id) {
          this.sp();
          this.term(n.id);
        }
        break;
      case "AnnotationBlock": {
        // Annotations are usually short: keep them on one line when they fit.
        const render = (inline: boolean) => {
          this.tok(n.open);
          this.sp();
          this.propertyList(n.properties, inline);
          this.sp();
          this.tok(n.close);
        };
        render(this.measure(() => render(true), this.remainingWidth()) !== null);
        break;
      }
      case "BlankNodePropertyList":
        this.tok(n.open, blank);
        this.sp();
        this.propertyList(n.properties);
        this.sp();
        this.tok(n.close);
        break;
      case "Collection":
        this.tok(n.open, blank);
        for (const item of n.items) {
          this.sp();
          this.node(item);
        }
        this.sp();
        this.tok(n.close);
        break;
      case "PathAlternative":
      case "PathSequence":
        n.items.forEach((item, i) => {
          if (i > 0) this.tok(n.separators[i - 1]);
          this.node(item);
        });
        break;
      case "PathInverse":
        this.tok(n.caret);
        this.node(n.item);
        break;
      case "PathModified":
        this.node(n.item);
        this.tok(n.modifier);
        break;
      case "PathNegated":
        this.tok(n.bang);
        this.node(n.item);
        break;
      case "PathGroup":
        this.tok(n.open);
        if (n.path) this.node(n.path);
        this.tok(n.close);
        break;
      default:
        this.expr(n);
    }
  }

  private expr(n: A.Node): void {
    switch (n.type) {
      case "Binary":
        this.expr(n.left);
        this.sp();
        this.tok(n.operator);
        this.sp();
        this.expr(n.right);
        break;
      case "In":
        this.expr(n.expression);
        this.sp();
        if (n.not) {
          this.kw(n.not);
          this.sp();
        }
        this.kw(n.in);
        this.sp();
        this.expr(n.list);
        break;
      case "Unary":
        this.tok(n.operator);
        this.expr(n.expression);
        break;
      case "Bracketed":
        this.tok(n.open);
        this.expr(n.expression);
        this.tok(n.close);
        break;
      case "ExpressionList":
        this.tok(n.open);
        n.items.forEach((item, i) => {
          if (i > 0) {
            this.tok(n.commas[i - 1]);
            this.sp();
          }
          this.expr(item);
        });
        this.tok(n.close);
        break;
      case "Call":
        if (n.name.type === "Term") this.term(n.name);
        else this.w.token(n.name, applyCase(n.name.value, this.options.functionCase));
        this.tok(n.open);
        if (n.distinct) {
          this.kw(n.distinct);
          this.sp();
        }
        n.args.forEach((arg, i) => {
          if (i > 0) {
            this.tok(n.commas[i - 1]);
            this.sp();
          }
          this.expr(arg);
        });
        if (n.separator) {
          this.tok(n.separator.semicolon);
          this.sp();
          this.kw(n.separator.keyword);
          this.sp();
          this.tok(n.separator.equals);
          this.sp();
          this.term(n.separator.value);
        }
        this.tok(n.close);
        break;
      case "Exists":
        if (n.not) {
          this.kw(n.not);
          this.sp();
        }
        this.kw(n.keyword);
        this.sp();
        this.group(n.group);
        break;
      case "OrderCondition":
      case "Projection":
        this.condition(n);
        break;
      case "TripleTerm":
      case "Term":
        this.node(n);
        break;
      default:
        throw new Error(`Unexpected expression ${n.type}`);
    }
  }
}
