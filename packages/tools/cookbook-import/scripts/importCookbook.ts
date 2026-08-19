/**
 * CLI entry point for the curated public-domain cookbook import.
 *
 * Thin by design: argument parsing and wiring only. Everything it decides lives in `src/runImport.ts` and
 * the pure modules beneath it, so the behaviour is testable without a process.
 *
 * ## Usage
 *
 * ```bash
 * # 1. Download the book ONCE, by hand (see README — never fetched at runtime, and never by a service).
 * curl -fL -o /tmp/pg12350.txt https://www.gutenberg.org/cache/epub/12350/pg12350.txt
 *
 * # 2. Import it as the curator.
 * npm run import --workspace=@kitchensink/cookbook-import -- \
 *     --book international-jewish \
 *     --file /tmp/pg12350.txt \
 *     --recipe-url http://localhost:3000 \
 *     --token-file /tmp/linkage/linkage-credentials.json \
 *     --ledger /tmp/cookbook-ledger.json \
 *     --limit 150
 * ```
 *
 * The token file is the artefact `packages/tools/cross-service-e2e/scripts/mintLinkageCredentials.ts`
 * writes; mint it with `LINKAGE_SCOPES=recipes:import:public`, because `imported_public` is declarable only
 * with that grant (ADR-0023). A raw bearer may be passed with `--token` instead.
 *
 * ⛔ **This writes recipes.** Point it at a local or sandbox origin. It has no production affordance and
 * must never be given one.
 *
 * @sideEffect Reads files, performs network I/O, writes the ledger and the report.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { COOKBOOKS } from '../src/cookbooks.js';
import { ImportLedger } from '../src/importLedger.js';
import { RecipeApiClient } from '../src/RecipeApiClient.js';
import { renderReport } from '../src/importReport.js';
import { runImport } from '../src/runImport.js';

/** Read `--flag value` pairs into a map. */
function parseArgs(argv: readonly string[]): Map<string, string> {
    const args = new Map<string, string>();

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];

        if (token !== undefined && token.startsWith('--')) {
            args.set(token.slice(2), argv[index + 1] ?? '');
            index += 1;
        }
    }

    return args;
}

/** Read a required argument, failing with the usage line rather than a stack trace. */
function required(args: Map<string, string>, name: string): string {
    const value = args.get(name);

    if (value === undefined || value.trim() === '') {
        throw new Error(`cookbook-import: --${name} is required. See this file's header for usage.`);
    }

    return value;
}

const args = parseArgs(process.argv.slice(2));
const bookKey = required(args, 'book');
const book = COOKBOOKS[bookKey];

if (book === undefined) {
    throw new Error(`cookbook-import: unknown --book "${bookKey}". Known: ${Object.keys(COOKBOOKS).join(', ')}`);
}

const tokenFile = args.get('token-file');
const token =
    tokenFile === undefined || tokenFile === ''
        ? required(args, 'token')
        : (JSON.parse(readFileSync(tokenFile, 'utf-8')) as { token: string }).token;

const report = await runImport({
    book,
    plainText: readFileSync(required(args, 'file'), 'utf-8'),
    client: new RecipeApiClient({ baseUrl: required(args, 'recipe-url'), token }),
    ledger: ImportLedger.load(args.get('ledger') ?? '.cookbook-import-ledger.json'),
    limit: Number(args.get('limit') ?? 150),
    settleMs: Number(args.get('settle-ms') ?? 30_000),
    log: (message) => {
        console.log(message);
    },
});

console.log(renderReport(report));

const reportPath = args.get('report');

if (reportPath !== undefined && reportPath !== '') {
    writeFileSync(reportPath, `${JSON.stringify(report, null, 4)}\n`, 'utf-8');
    console.log(`report written to ${reportPath}`);
}

// A run that created nothing is a failure worth an exit code: it is the difference between "the corpus had
// nothing left to import" and "every create was refused", and CI cannot tell those apart from stdout.
if (report.imported === 0 && report.alreadyImported === 0) {
    process.exitCode = 1;
}
