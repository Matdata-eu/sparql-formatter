/**
 * Line-oriented output buffer that knows about comments.
 *
 * Every source token passes through the writer exactly once, either printed
 * (`token`) or dropped (`drop`, e.g. a superfluous `.`). Either way the
 * comments attached to the token are written: leading comments on their own
 * lines before the token, a trailing comment at the end of the line the token
 * ends up on. This is what keeps comments next to the code they belong to.
 */

import type { Comment, Token } from "./lexer.ts";

/** Punctuation that may be placed before a pending trailing comment on the same line. */
const ATTACHABLE = new Set([".", ",", ";"]);

export interface WriterOptions {
  indent: string;
  preserveBlankLines: boolean;
  /** Leave comments out (used to measure the width of code). */
  ignoreComments?: boolean;
}

export class Writer {
  private lines: string[] = [];
  private current = "";
  private currentIndent = "";
  private level = 0;
  /** Indent to use for the next line instead of the structural indent (alignment). */
  private nextIndent: string | null = null;
  private pendingSpace = false;
  private pendingTrailing: Comment[] = [];
  private leadingDone = new Set<Token>();
  /** Leading comments of dropped tokens, written before the next output. */
  private deferred: Comment[] = [];
  private options: WriterOptions;
  /** Number of comments written; used to check that no comment was lost. */
  commentCount = 0;

  constructor(options: WriterOptions) {
    this.options = options;
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  get atLineStart(): boolean {
    return this.current === "";
  }

  indent(): void {
    this.level++;
  }

  dedent(): void {
    this.level--;
  }

  private structuralIndent(): string {
    return this.options.indent.repeat(this.level);
  }

  /** Column (0-based) at which the next text will be written. */
  column(): number {
    if (this.atLineStart) return (this.nextIndent ?? this.structuralIndent()).length;
    return this.currentIndent.length + this.current.length + (this.pendingSpace ? 1 : 0);
  }

  space(): void {
    if (!this.atLineStart) this.pendingSpace = true;
  }

  /** End the current line. Does nothing on an empty line unless comments are pending. */
  newline(): void {
    if (this.atLineStart && this.pendingTrailing.length === 0) {
      // A structural line break cancels a continuation indent set by a comment.
      this.nextIndent = null;
      return;
    }
    const [first, ...rest] = this.pendingTrailing;
    let line = this.current;
    if (first !== undefined) {
      line = line === "" ? first.text : `${line} ${first.text}`;
      this.commentCount++;
    }
    this.lines.push((this.currentIndent + line).replace(/\s+$/, ""));
    this.current = "";
    this.pendingSpace = false;
    this.pendingTrailing = [];
    // Further comments that ended up on this line go on their own lines before the next output,
    // where a second formatting pass would put them too.
    this.deferred.push(...rest);
  }

  /** Indentation of the current line (or of the next line when nothing was written yet). */
  private lineIndent(): string {
    return this.atLineStart ? (this.nextIndent ?? this.structuralIndent()) : this.currentIndent;
  }

  /** Indent string that aligns a new line with the current column. */
  alignment(): string {
    const base = this.lineIndent();
    return base + " ".repeat(Math.max(0, this.column() - base.length));
  }

  /** Indent string one level deeper than the current line. */
  continuation(): string {
    return this.lineIndent() + this.options.indent;
  }

  /** Start a new line with the given indent string (from `alignment()` or `continuation()`). */
  newlineWith(indent: string): void {
    this.newline();
    this.nextIndent = indent;
  }

  /** Make sure the output ends with exactly one empty line (unless at the very start or after an opening brace). */
  blankLine(): void {
    this.newline();
    const last = this.lines[this.lines.length - 1];
    if (last === undefined || last === "" || /[{(\[]$/.test(last)) return;
    this.lines.push("");
  }

  /** Continue the current statement on a new line (used when a comment forces a break). */
  private breakLine(): void {
    if (this.atLineStart) return;
    this.newline();
    this.nextIndent = this.structuralIndent() + this.options.indent;
  }

  private write(text: string): void {
    if (text === "") return;
    if (this.atLineStart) {
      this.currentIndent = this.nextIndent ?? this.structuralIndent();
      this.nextIndent = null;
      this.current = text;
    } else {
      this.current += (this.pendingSpace ? " " : "") + text;
    }
    this.pendingSpace = false;
  }

  // -------------------------------------------------------------------------
  // Content
  // -------------------------------------------------------------------------

  private leadingComments(t: Token | null, blank: boolean): void {
    if (this.options.ignoreComments) return;
    const comments = [...this.deferred];
    this.deferred = [];
    if (t && t.leading.length > 0 && !this.leadingDone.has(t)) {
      this.leadingDone.add(t);
      comments.push(...t.leading);
    }
    if (comments.length > 0) {
      this.breakLine();
      const indent = this.nextIndent;
      for (const comment of comments) {
        if (comment.blankLinesBefore > 0 && this.options.preserveBlankLines) this.blankLine();
        this.nextIndent = indent;
        this.write(comment.text);
        this.commentCount++;
        this.newline();
      }
      this.nextIndent = indent;
    }
    if (t && blank && t.blankLinesBefore > 0 && this.options.preserveBlankLines && this.atLineStart) {
      this.blankLine();
    }
  }

  private trailingComment(t: Token): void {
    if (this.options.ignoreComments) return;
    if (t.trailing) {
      this.pendingTrailing.push(t.trailing);
    }
  }

  /**
   * Write a source token (optionally spelled differently, e.g. upper-cased).
   * `blank`: keep a blank line that precedes the token in the source.
   */
  token(t: Token, text: string = t.value, blank = false): void {
    if (this.pendingTrailing.length > 0 && !ATTACHABLE.has(text)) this.breakLine();
    this.leadingComments(t, blank);
    this.write(text);
    this.trailingComment(t);
  }

  /** Write only the comments of a token that is not printed. */
  drop(t: Token): void {
    if (this.options.ignoreComments) return;
    // The leading comments of a dropped token (e.g. the optional '.' after `OPTIONAL { }`) are
    // written before whatever is written next, exactly as if they were that token's comments.
    // This keeps formatting idempotent: on a second pass they *are* the next token's comments.
    if (!this.leadingDone.has(t)) {
      this.leadingDone.add(t);
      this.deferred.push(...t.leading);
    }
    // Keep the order of comments: a trailing comment after deferred comments is deferred too.
    if (this.deferred.length > 0 && t.trailing) this.deferred.push(t.trailing);
    else this.trailingComment(t);
  }

  /** Write only the leading comments of a token (used before closing brackets at the inner indent). */
  commentsBefore(t: Token): void {
    this.leadingComments(t, false);
  }

  /** Write text that doesn't come from a source token. */
  text(text: string): void {
    if (this.pendingTrailing.length > 0 && !ATTACHABLE.has(text)) this.breakLine();
    if (this.deferred.length > 0) this.leadingComments(null, false);
    this.write(text);
  }

  /** Has anything been written to the current line or earlier? */
  get isEmpty(): boolean {
    return this.lines.length === 0 && this.atLineStart;
  }

  /** The text written so far, if it fits on a single line without comments. */
  singleLine(): string | null {
    if (this.lines.length > 0 || this.pendingTrailing.length > 0 || this.deferred.length > 0 || this.commentCount > 0) {
      return null;
    }
    return this.current;
  }

  toString(): string {
    this.leadingComments(null, false);
    this.newline();
    while (this.lines.length > 0 && this.lines[this.lines.length - 1] === "") this.lines.pop();
    return this.lines.join("\n");
  }
}
