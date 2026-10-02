// VS Code extension: document formatter and syntax error diagnostics for SPARQL.
import * as vscode from "vscode";
import { format, parse, SparqlSyntaxError, type Case, type FormatOptions } from "../../src/index.ts";

const LANGUAGE = "sparql";
const VALIDATE_DELAY = 300;

function formatOptions(document: vscode.TextDocument, editor: vscode.FormattingOptions): FormatOptions {
  const config = vscode.workspace.getConfiguration("sparqlFormatter", document);
  return {
    // Indentation follows the editor (tab size, spaces or tabs), like other VS Code formatters.
    indent: editor.insertSpaces ? editor.tabSize : "\t",
    keywordCase: config.get<Case>("keywordCase"),
    functionCase: config.get<Case>("functionCase"),
    alignPredicates: config.get<boolean>("alignPredicates"),
    preserveBlankLines: config.get<boolean>("preserveBlankLines"),
    compact: config.get<boolean>("compact"),
    lineWidth: config.get<number>("lineWidth"),
    insertWhere: config.get<boolean>("insertWhere"),
  };
}

function syntaxErrorDiagnostic(document: vscode.TextDocument, error: SparqlSyntaxError): vscode.Diagnostic {
  const start = document.positionAt(error.offset);
  const range = document.getWordRangeAtPosition(start, /\S+/) ?? new vscode.Range(start, start.translate(0, 1));
  // The message ends with "(line x, column y)", which the Problems panel already shows.
  const message = error.message.replace(/ \(line \d+, column \d+\)$/, "");
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
  diagnostic.source = "sparql-formatter";
  return diagnostic;
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("sparql-formatter");
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const validate = (document: vscode.TextDocument): void => {
    if (document.languageId !== LANGUAGE) return;
    if (!vscode.workspace.getConfiguration("sparqlFormatter", document).get<boolean>("validate")) {
      diagnostics.delete(document.uri);
      return;
    }
    try {
      parse(document.getText());
      diagnostics.delete(document.uri);
    } catch (e) {
      if (e instanceof SparqlSyntaxError) diagnostics.set(document.uri, [syntaxErrorDiagnostic(document, e)]);
      else diagnostics.delete(document.uri);
    }
  };

  const scheduleValidate = (document: vscode.TextDocument): void => {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        validate(document);
      }, VALIDATE_DELAY),
    );
  };

  context.subscriptions.push(
    diagnostics,
    vscode.languages.registerDocumentFormattingEditProvider(LANGUAGE, {
      provideDocumentFormattingEdits(document, options) {
        const text = document.getText();
        let formatted: string;
        try {
          formatted = format(text, formatOptions(document, options));
        } catch (e) {
          if (e instanceof SparqlSyntaxError) {
            diagnostics.set(document.uri, [syntaxErrorDiagnostic(document, e)]);
            void vscode.window.showWarningMessage(`SPARQL not formatted: ${e.message}`);
            return [];
          }
          throw e;
        }
        if (/\r?\n$/.test(text)) formatted += "\n";
        if (formatted === text) return [];
        const all = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
        return [vscode.TextEdit.replace(all, formatted)];
      },
    }),
    vscode.workspace.onDidOpenTextDocument(validate),
    vscode.workspace.onDidChangeTextDocument((event) => scheduleValidate(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearTimeout(timers.get(document.uri.toString()));
      timers.delete(document.uri.toString());
      diagnostics.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("sparqlFormatter.validate")) vscode.workspace.textDocuments.forEach(validate);
    }),
    { dispose: () => timers.forEach(clearTimeout) },
  );

  vscode.workspace.textDocuments.forEach(validate);
}

export function deactivate(): void {}
