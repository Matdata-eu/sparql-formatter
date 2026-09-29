import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { format, SparqlSyntaxError, type Case, type FormatOptions } from "./index.ts";

declare const __VERSION__: string;

const HELP = `Usage: sparql-formatter [options] [file ...]

Formats SPARQL 1.2 queries and updates. Reads from stdin when no file is given.

Options:
  -i, --indent <n|tab>        indentation: number of spaces or "tab" (default: 2)
      --keyword-case <case>   upper | lower | preserve (default: upper)
      --function-case <case>  upper | lower | preserve (default: preserve)
      --no-align              don't align predicates under the first predicate
      --no-blank-lines        remove blank lines instead of keeping them
      --compact               put small group patterns on one line
      --line-width <n>        maximum line width for --compact and VALUES (default: 100)
  -w, --write                 rewrite the files in place
  -c, --check                 exit with code 1 if a file is not formatted
  -v, --version               print the version
  -h, --help                  print this help
`;

function parseCase(value: string | undefined, name: string): Case | undefined {
  if (value === undefined) return undefined;
  if (value === "upper" || value === "lower" || value === "preserve") return value;
  throw new Error(`--${name} must be one of upper, lower, preserve`);
}

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      indent: { type: "string", short: "i" },
      "keyword-case": { type: "string" },
      "function-case": { type: "string" },
      "no-align": { type: "boolean" },
      "no-blank-lines": { type: "boolean" },
      compact: { type: "boolean" },
      "line-width": { type: "string" },
      write: { type: "boolean", short: "w" },
      check: { type: "boolean", short: "c" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${__VERSION__}\n`);
    return 0;
  }

  const options: FormatOptions = {
    keywordCase: parseCase(values["keyword-case"], "keyword-case"),
    functionCase: parseCase(values["function-case"], "function-case"),
    alignPredicates: !values["no-align"],
    preserveBlankLines: !values["no-blank-lines"],
    compact: values.compact ?? false,
  };
  if (values.indent !== undefined) {
    if (values.indent === "tab") options.indent = "\t";
    else if (/^\d+$/.test(values.indent)) options.indent = Number(values.indent);
    else throw new Error('--indent must be a number or "tab"');
  }
  if (values["line-width"] !== undefined) options.lineWidth = Number(values["line-width"]);

  const inputs = positionals.length > 0 ? positionals : ["-"];
  if (values.write && positionals.length === 0) throw new Error("--write needs at least one file");

  let status = 0;
  for (const file of inputs) {
    const source = readFileSync(file === "-" ? 0 : file, "utf8");
    let formatted: string;
    try {
      formatted = format(source, options);
    } catch (e) {
      if (e instanceof SparqlSyntaxError) {
        process.stderr.write(`${file === "-" ? "<stdin>" : file}:${e.line}:${e.column}: ${e.message}\n`);
        status = 2;
        continue;
      }
      throw e;
    }
    const output = formatted === "" ? "" : `${formatted}\n`;
    if (values.check) {
      if (output !== source) {
        process.stderr.write(`${file === "-" ? "<stdin>" : file}: not formatted\n`);
        status = Math.max(status, 1);
      }
    } else if (values.write) {
      if (output !== source) writeFileSync(file, output);
    } else {
      process.stdout.write(output);
    }
  }
  return status;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`sparql-formatter: ${(e as Error).message}\n`);
  process.exitCode = 2;
}
