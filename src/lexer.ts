/**
 * SPARQL 1.2 lexer.
 *
 * Produces the significant tokens of a query together with the comments
 * that surround them. Comments are not dropped: every comment is attached to
 * a token, either as a *trailing* comment (it sits on the same line as the
 * token that precedes it) or as a *leading* comment (it sits on a line of its
 * own before the next token). The printer re-emits them relative to those
 * tokens, which is what keeps comments in place after formatting.
 *
 * Terminals follow https://www.w3.org/TR/sparql12-query/#sparqlGrammar
 */

import { SparqlSyntaxError } from "./errors.ts";

export type TokenType =
  | "IRIREF"
  | "PNAME_NS"
  | "PNAME_LN"
  | "BLANK_NODE_LABEL"
  | "VAR"
  | "LANG_DIR"
  | "INTEGER"
  | "DECIMAL"
  | "DOUBLE"
  | "STRING"
  | "NAME" // keyword, built-in function name, `a`, `true`, `false`
  | "PUNCT"
  | "EOF";

export interface Comment {
  /** The comment text including the leading `#`, without the line break. */
  text: string;
  offset: number;
  line: number;
  column: number;
  /** Number of blank lines between the previous token/comment and this comment. */
  blankLinesBefore: number;
}

export interface Token {
  type: TokenType;
  /** The exact source text of the token. */
  value: string;
  offset: number;
  end: number;
  line: number;
  column: number;
  /** Index of this token in the token list. */
  index: number;
  /** Comments on their own line(s) before this token. */
  leading: Comment[];
  /** Comment on the same line after this token. */
  trailing: Comment | null;
  /** Number of blank lines between the previous token (or leading comment) and this token. */
  blankLinesBefore: number;
  /** Whether whitespace or a comment separates this token from the previous one. */
  spaceBefore: boolean;
}

// ---------------------------------------------------------------------------
// Character classes
// ---------------------------------------------------------------------------

const PN_CHARS_BASE =
  "A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D" +
  "\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const PN_CHARS_U = PN_CHARS_BASE + "_";
const PN_CHARS = PN_CHARS_U + "\\-0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040";
const PLX = "%[0-9A-Fa-f]{2}|\\\\[_~.\\-!$&'()*+,;=/?#@%]";

const PN_PREFIX = `[${PN_CHARS_BASE}](?:[${PN_CHARS}.]*[${PN_CHARS}])?`;
const PN_LOCAL = `(?:[${PN_CHARS_U}:0-9]|${PLX})(?:(?:[${PN_CHARS}.:]|${PLX})*(?:[${PN_CHARS}:]|${PLX}))?`;

const RE_PNAME = new RegExp(`(?:${PN_PREFIX})?:(?:${PN_LOCAL})?`, "uy");
const RE_VAR = new RegExp(`[?$][${PN_CHARS_U}0-9][${PN_CHARS_U}0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*`, "uy");
const RE_BNODE = new RegExp(`_:[${PN_CHARS_U}0-9](?:[${PN_CHARS}.]*[${PN_CHARS}])?`, "uy");
const RE_IRIREF = /<(?:[^<>"{}|^`\\\u0000- ]|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8})*>/y;
const RE_LANG_DIR = /@[a-zA-Z]+(?:-[a-zA-Z0-9]+)*(?:--[a-zA-Z]+)?/y;
const RE_DOUBLE = /(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)[eE][+-]?[0-9]+/y;
const RE_DECIMAL = /[0-9]*\.[0-9]+/y;
const RE_INTEGER = /[0-9]+/y;
const RE_NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

const ECHAR_UCHAR = String.raw`\\[tbnrf\\"']|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8}`;
const RE_STRING_LONG1 = new RegExp(String.raw`'''(?:(?:'|'')?(?:[^'\\]|${ECHAR_UCHAR}))*'''`, "y");
const RE_STRING_LONG2 = new RegExp(String.raw`"""(?:(?:"|"")?(?:[^"\\]|${ECHAR_UCHAR}))*"""`, "y");
const RE_STRING1 = new RegExp(String.raw`'(?:[^'\\\n\r]|${ECHAR_UCHAR})*'`, "y");
const RE_STRING2 = new RegExp(String.raw`"(?:[^"\\\n\r]|${ECHAR_UCHAR})*"`, "y");

/** `\uD800`-`\uDFFF` (and `\U0000D800`...) do not denote characters. */
const RE_SURROGATE_ESCAPE = /\\(?:u|U0000)[dD][89a-fA-F][0-9a-fA-F]{2}/;

/** Punctuation, longest first so that the longest match wins. */
const PUNCTUATION = [
  "<<(",
  ")>>",
  "<<",
  ">>",
  "{|",
  "|}",
  "^^",
  "&&",
  "||",
  "!=",
  "<=",
  ">=",
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  ".",
  ",",
  ";",
  "*",
  "/",
  "|",
  "^",
  "?",
  "+",
  "-",
  "!",
  "=",
  "<",
  ">",
  "~",
];

function match(re: RegExp, input: string, pos: number): string | null {
  re.lastIndex = pos;
  const m = re.exec(input);
  return m ? m[0] : null;
}

/**
 * Split a query into tokens. Comments are attached to tokens (see module docs).
 * The last token is always an `EOF` token that carries the comments at the end
 * of the query.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let lineStart = 0;

  let pendingComments: Comment[] = [];
  let newlinesSinceLast = 0; // newlines since the previous token or comment
  let sawSpace = false;
  let prevToken: Token | null = null;
  let prevTokenLine = -1;

  const advanceLines = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const c = input.charCodeAt(i);
      if (c === 10 || (c === 13 && input.charCodeAt(i + 1) !== 10)) {
        line++;
        lineStart = i + 1;
      }
    }
  };

  const error = (message: string): never => {
    throw new SparqlSyntaxError(message, pos, line, pos - lineStart + 1);
  };

  while (pos < input.length) {
    const ch = input[pos];

    // White space
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      if (ch === "\n" || (ch === "\r" && input[pos + 1] !== "\n")) {
        newlinesSinceLast++;
        line++;
        lineStart = pos + 1;
      }
      sawSpace = true;
      pos++;
      continue;
    }

    // Comments
    if (ch === "#") {
      let end = pos;
      while (end < input.length && input[end] !== "\n" && input[end] !== "\r") end++;
      const comment: Comment = {
        text: input.slice(pos, end).replace(/\s+$/, ""),
        offset: pos,
        line,
        column: pos - lineStart + 1,
        blankLinesBefore: Math.max(0, newlinesSinceLast - 1),
      };
      if (prevToken && prevTokenLine === line && pendingComments.length === 0 && !prevToken.trailing) {
        prevToken.trailing = comment;
      } else {
        pendingComments.push(comment);
      }
      newlinesSinceLast = 0;
      sawSpace = true;
      pos = end;
      continue;
    }

    const startLine = line;
    const startColumn = pos - lineStart + 1;
    let type: TokenType;
    let value: string | null = null;

    if (ch === "<") {
      if (input.startsWith("<<(", pos)) {
        type = "PUNCT";
        value = "<<(";
      } else if (input.startsWith("<<", pos)) {
        type = "PUNCT";
        value = "<<";
      } else if ((value = match(RE_IRIREF, input, pos))) {
        type = "IRIREF";
      } else {
        type = "PUNCT";
        value = input.startsWith("<=", pos) ? "<=" : "<";
      }
    } else if (ch === "?" || ch === "$") {
      value = match(RE_VAR, input, pos);
      if (value) {
        type = "VAR";
      } else if (ch === "?") {
        type = "PUNCT";
        value = "?";
      } else {
        return error("Invalid variable name");
      }
    } else if (ch === '"' || ch === "'") {
      value =
        ch === '"'
          ? (match(RE_STRING_LONG2, input, pos) ?? match(RE_STRING2, input, pos))
          : (match(RE_STRING_LONG1, input, pos) ?? match(RE_STRING1, input, pos));
      if (!value) return error("Unterminated or invalid string literal");
      type = "STRING";
    } else if (ch === "@") {
      value = match(RE_LANG_DIR, input, pos);
      if (!value) return error("Invalid language tag");
      type = "LANG_DIR";
    } else if (ch === "_" && input[pos + 1] === ":") {
      value = match(RE_BNODE, input, pos);
      if (!value) return error("Invalid blank node label");
      type = "BLANK_NODE_LABEL";
    } else if ((ch >= "0" && ch <= "9") || (ch === "." && /[0-9]/.test(input[pos + 1] ?? ""))) {
      if ((value = match(RE_DOUBLE, input, pos))) type = "DOUBLE";
      else if ((value = match(RE_DECIMAL, input, pos))) type = "DECIMAL";
      else {
        value = match(RE_INTEGER, input, pos)!;
        type = "INTEGER";
      }
    } else {
      // Prefixed names first: they may start with letters (keywords can't contain ':')
      const pname = match(RE_PNAME, input, pos);
      if (pname) {
        value = pname;
        type = pname.endsWith(":") && pname.indexOf(":") === pname.length - 1 ? "PNAME_NS" : "PNAME_LN";
      } else if ((value = match(RE_NAME, input, pos))) {
        type = "NAME";
      } else {
        value = PUNCTUATION.find((p) => input.startsWith(p, pos)) ?? null;
        if (!value) return error(`Unexpected character '${String.fromCodePoint(input.codePointAt(pos)!)}'`);
        type = "PUNCT";
      }
    }

    if ((type === "STRING" || type === "IRIREF") && RE_SURROGATE_ESCAPE.test(value!)) {
      return error("Escape sequences for surrogate code points (U+D800 to U+DFFF) are not allowed");
    }

    const token: Token = {
      type,
      value: value!,
      offset: pos,
      end: pos + value!.length,
      line: startLine,
      column: startColumn,
      index: tokens.length,
      leading: pendingComments,
      trailing: null,
      blankLinesBefore: Math.max(0, newlinesSinceLast - 1),
      spaceBefore: sawSpace,
    };
    tokens.push(token);
    advanceLines(pos, token.end); // long strings may span lines
    pos = token.end;
    prevToken = token;
    prevTokenLine = line;
    pendingComments = [];
    newlinesSinceLast = 0;
    sawSpace = false;
  }

  tokens.push({
    type: "EOF",
    value: "",
    offset: input.length,
    end: input.length,
    line,
    column: input.length - lineStart + 1,
    index: tokens.length,
    leading: pendingComments,
    trailing: null,
    blankLinesBefore: Math.max(0, newlinesSinceLast - 1),
    spaceBefore: sawSpace,
  });
  return tokens;
}
