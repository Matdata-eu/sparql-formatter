/**
 * Concrete syntax tree for SPARQL 1.2 queries and updates.
 *
 * The tree keeps a reference to every source token (keywords, punctuation,
 * terms) so the printer can re-emit the comments attached to them and keep
 * the original spelling of terms.
 */

import type { Token } from "./lexer.ts";

// ---------------------------------------------------------------------------
// Terms and triples
// ---------------------------------------------------------------------------

/**
 * A term printed as the concatenation of its tokens: an IRI, a variable, a
 * literal (`"x"@en`, `"1"^^xsd:int`), a signed number (`-1`), a blank node,
 * `a`, `true`, `NIL` (`()`), `ANON` (`[]`), `UNDEF`.
 */
export interface Term {
  type: "Term";
  tokens: Token[];
}

/** `<<( s p o )>>` */
export interface TripleTerm {
  type: "TripleTerm";
  open: Token;
  subject: Node;
  predicate: Term;
  object: Node;
  close: Token;
}

/** `<< s p o ~ r >>` */
export interface ReifiedTriple {
  type: "ReifiedTriple";
  open: Token;
  subject: Node;
  predicate: Term;
  object: Node;
  reifier: Reifier | null;
  close: Token;
}

/** `~ id` */
export interface Reifier {
  type: "Reifier";
  tilde: Token;
  id: Term | null;
}

/** `{| p o ; ... |}` */
export interface AnnotationBlock {
  type: "AnnotationBlock";
  open: Token;
  properties: PropertyList;
  close: Token;
}

/** `( a b c )` */
export interface Collection {
  type: "Collection";
  open: Token;
  items: Node[];
  close: Token;
}

/** `[ p o ; ... ]` */
export interface BlankNodePropertyList {
  type: "BlankNodePropertyList";
  open: Token;
  properties: PropertyList;
  close: Token;
}

export interface ObjectEntry {
  node: Node;
  annotations: (Reifier | AnnotationBlock)[];
  /** The `,` that follows this object, if any. */
  comma: Token | null;
}

export interface PropertyEntry {
  verb: Node;
  objects: ObjectEntry[];
  /** The `;` tokens that follow this entry (`; ;` is legal). */
  semicolons: Token[];
}

export interface PropertyList {
  type: "PropertyList";
  /** `;` tokens that appear before the first entry are not legal; entries only. */
  entries: PropertyEntry[];
}

/** A subject with its property list: `?s :p ?o ; :q ?r` */
export interface Triples {
  type: "Triples";
  subject: Node;
  properties: PropertyList | null;
}

// Property paths ------------------------------------------------------------

export interface PathAlternative {
  type: "PathAlternative";
  items: Node[];
  separators: Token[];
}

export interface PathSequence {
  type: "PathSequence";
  items: Node[];
  separators: Token[];
}

export interface PathInverse {
  type: "PathInverse";
  caret: Token;
  item: Node;
}

export interface PathModified {
  type: "PathModified";
  item: Node;
  modifier: Token;
}

export interface PathNegated {
  type: "PathNegated";
  bang: Token;
  item: Node;
}

/** `( path )` in a property path, also `!( a | ^b )` */
export interface PathGroup {
  type: "PathGroup";
  open: Token;
  path: Node | null;
  close: Token;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export interface Binary {
  type: "Binary";
  left: Node;
  operator: Token;
  right: Node;
}

/** `x IN (...)` / `x NOT IN (...)` */
export interface InExpression {
  type: "In";
  expression: Node;
  not: Token | null;
  in: Token;
  list: ExpressionList;
}

export interface Unary {
  type: "Unary";
  operator: Token;
  expression: Node;
}

export interface Bracketed {
  type: "Bracketed";
  open: Token;
  expression: Node;
  close: Token;
}

/** `( e1, e2 )` or `()` */
export interface ExpressionList {
  type: "ExpressionList";
  open: Token;
  items: Node[];
  commas: Token[];
  close: Token;
}

/** A built-in call, aggregate or function call. */
export interface Call {
  type: "Call";
  /** A NAME token for built-ins, a Term for IRI function calls. */
  name: Token | Term;
  builtin: boolean;
  /** The opening parenthesis; a call written as `NOW()` has no args. */
  open: Token;
  distinct: Token | null;
  args: Node[];
  commas: Token[];
  /** GROUP_CONCAT separator: `; SEPARATOR = "x"` */
  separator: { semicolon: Token; keyword: Token; equals: Token; value: Term } | null;
  close: Token;
}

/** `EXISTS { }` / `NOT EXISTS { }` */
export interface Exists {
  type: "Exists";
  not: Token | null;
  keyword: Token;
  group: GroupGraphPattern;
}

// ---------------------------------------------------------------------------
// Graph patterns
// ---------------------------------------------------------------------------

export interface GroupGraphPattern {
  type: "GroupGraphPattern";
  open: Token;
  subSelect: SubSelect | null;
  items: PatternItem[];
  close: Token;
}

export interface PatternItem {
  node: Node;
  /** The `.` that follows the item, if any. */
  dot: Token | null;
}

export interface Union {
  type: "Union";
  groups: GroupGraphPattern[];
  keywords: Token[];
}

export interface Optional {
  type: "Optional";
  keyword: Token;
  group: GroupGraphPattern;
}

export interface Minus {
  type: "Minus";
  keyword: Token;
  group: GroupGraphPattern;
}

export interface GraphPattern {
  type: "Graph";
  keyword: Token;
  name: Term;
  group: GroupGraphPattern;
}

export interface Service {
  type: "Service";
  keyword: Token;
  silent: Token | null;
  name: Term;
  group: GroupGraphPattern;
}

export interface Filter {
  type: "Filter";
  keyword: Token;
  constraint: Node;
}

export interface Bind {
  type: "Bind";
  keyword: Token;
  open: Token;
  expression: Node;
  as: Token;
  variable: Term;
  close: Token;
}

export interface Values {
  type: "Values";
  keyword: Token;
  block: DataBlock;
}

export interface DataBlockRow {
  /** `( v1 v2 )`; for NIL rows `open`/`close` are the `(` `)` tokens and values is empty. */
  open: Token;
  values: Node[];
  close: Token;
}

export interface DataBlock {
  type: "DataBlock";
  /** Single variable form: `?x { ... }` */
  variable: Term | null;
  /** Multi-variable form: `( ?a ?b ) { ... }` */
  variables: { open: Token; vars: Term[]; close: Token } | null;
  open: Token;
  /** Values of the single-variable form. */
  values: Node[];
  /** Rows of the multi-variable form. */
  rows: DataBlockRow[];
  close: Token;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface PrologueDecl {
  type: "Base" | "Prefix" | "Version";
  keyword: Token;
  /** PREFIX only */
  prefix: Token | null;
  value: Token;
}

export interface Projection {
  type: "Projection";
  open: Token;
  expression: Node;
  as: Token | null;
  variable: Term | null;
  close: Token;
}

export interface SelectClause {
  type: "SelectClause";
  keyword: Token;
  modifier: Token | null;
  star: Token | null;
  items: (Term | Projection)[];
}

export interface DatasetClause {
  type: "DatasetClause";
  from: Token;
  named: Token | null;
  iri: Term;
}

export interface WhereClause {
  keyword: Token | null;
  group: GroupGraphPattern;
}

export interface OrderCondition {
  type: "OrderCondition";
  direction: Token | null;
  expression: Node;
}

export interface SolutionModifier {
  groupBy: { group: Token; by: Token; conditions: Node[] } | null;
  having: { keyword: Token; conditions: Node[] } | null;
  orderBy: { order: Token; by: Token; conditions: Node[] } | null;
  /** LIMIT and OFFSET in source order */
  limitOffset: { keyword: Token; value: Token }[];
}

export interface SelectQuery {
  type: "Select";
  select: SelectClause;
  datasets: DatasetClause[];
  where: WhereClause;
  modifiers: SolutionModifier;
}

export interface SubSelect extends Omit<SelectQuery, "type"> {
  type: "SubSelect";
  values: Values | null;
}

/** Triples inside `{ }` of a CONSTRUCT template or quad data */
export interface TriplesTemplate {
  type: "TriplesTemplate";
  open: Token;
  items: PatternItem[];
  close: Token;
}

export interface ConstructQuery {
  type: "Construct";
  keyword: Token;
  template: TriplesTemplate | null;
  datasets: DatasetClause[];
  /** Full form: WHERE clause. Short form (`CONSTRUCT WHERE { triples }`): `where.keyword` + `shortTemplate` */
  where: WhereClause | null;
  shortForm: { keyword: Token; template: TriplesTemplate } | null;
  modifiers: SolutionModifier;
}

export interface DescribeQuery {
  type: "Describe";
  keyword: Token;
  star: Token | null;
  items: Term[];
  datasets: DatasetClause[];
  where: WhereClause | null;
  modifiers: SolutionModifier;
}

export interface AskQuery {
  type: "Ask";
  keyword: Token;
  datasets: DatasetClause[];
  where: WhereClause;
  modifiers: SolutionModifier;
}

export type QueryForm = SelectQuery | ConstructQuery | DescribeQuery | AskQuery;

export interface Query {
  type: "Query";
  prologue: PrologueDecl[];
  form: QueryForm;
  values: Values | null;
  eof: Token;
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

/** Keyword/IRI sequences such as `GRAPH <g>`, `DEFAULT`, `SILENT` */
export interface Words {
  type: "Words";
  tokens: (Token | Term)[];
}

export interface QuadsGraph {
  type: "QuadsGraph";
  keyword: Token;
  name: Term;
  template: TriplesTemplate;
}

export interface Load {
  type: "Load";
  keyword: Token;
  silent: Token | null;
  iri: Term;
  into: Words | null;
}

/** CLEAR, DROP, CREATE */
export interface GraphManagement {
  type: "GraphManagement";
  keyword: Token;
  silent: Token | null;
  target: Words;
}

/** ADD, MOVE, COPY */
export interface GraphTransfer {
  type: "GraphTransfer";
  keyword: Token;
  silent: Token | null;
  from: Words;
  to: Token;
  target: Words;
}

/** INSERT DATA, DELETE DATA, DELETE WHERE */
export interface QuadDataOperation {
  type: "QuadData";
  keywords: [Token, Token];
  quads: TriplesTemplate;
}

export interface Modify {
  type: "Modify";
  with: { keyword: Token; iri: Term } | null;
  delete: { keyword: Token; quads: TriplesTemplate } | null;
  insert: { keyword: Token; quads: TriplesTemplate } | null;
  using: { keyword: Token; named: Token | null; iri: Term }[];
  where: WhereClause;
}

export type UpdateOperation = Load | GraphManagement | GraphTransfer | QuadDataOperation | Modify;

export interface UpdatePart {
  prologue: PrologueDecl[];
  operation: UpdateOperation | null;
  semicolon: Token | null;
}

export interface Update {
  type: "Update";
  parts: UpdatePart[];
  eof: Token;
}

export type Node =
  | Term
  | TripleTerm
  | ReifiedTriple
  | Reifier
  | AnnotationBlock
  | Collection
  | BlankNodePropertyList
  | PropertyList
  | Triples
  | PathAlternative
  | PathSequence
  | PathInverse
  | PathModified
  | PathNegated
  | PathGroup
  | Binary
  | InExpression
  | Unary
  | Bracketed
  | ExpressionList
  | Call
  | Exists
  | GroupGraphPattern
  | Union
  | Optional
  | Minus
  | GraphPattern
  | Service
  | Filter
  | Bind
  | Values
  | DataBlock
  | Projection
  | OrderCondition
  | SubSelect
  | TriplesTemplate
  | QuadsGraph;

export type Ast = Query | Update;
