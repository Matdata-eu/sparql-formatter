/** Error thrown when a query can't be tokenized or parsed. */
export class SparqlSyntaxError extends Error {
  /** Character offset (0-based) in the input where the error occurred. */
  readonly offset: number;
  /** Line number (1-based). */
  readonly line: number;
  /** Column number (1-based). */
  readonly column: number;
  /** Human-readable descriptions of what the parser expected, when known. */
  readonly expected: string[];

  constructor(message: string, offset: number, line: number, column: number, expected: string[] = []) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "SparqlSyntaxError";
    this.offset = offset;
    this.line = line;
    this.column = column;
    this.expected = expected;
  }
}
