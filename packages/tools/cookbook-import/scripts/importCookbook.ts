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
 * Add `--parse-pipeline` to also read every accepted ingredient line with BOTH engines and record what they
 * amounted to. ⛔ **That flag SPENDS REAL MONEY** against ADR-0024's single $100/month pool — the residual
 * risk ADR-0026 records is that "a large import can starve the verification gate" — and it needs the CRF
 * engine installed locally (`pip3 install --user 'ingredient-parser-nlp==2.3.0'`). It is off by default for
 * exactly that reason, and what it produces is an OBSERVATION: the recipes created are byte-identical either
 * way, because the field-level winner rule is observe-only until U23's oracle lands. See `runImport.ts`.
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
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { createBedrockConverseClient, createBedrockTransport } from '@kitchensink/bedrock-client';
import { NOVA_MICRO_MODEL_ID } from '@kitchensink/recipe-core/spend/spend-arithmetic';
import { NO_CACHE, NO_CORRECTIONS } from '@kitchensink/recipe-import-core';

import { COOKBOOKS } from '../src/cookbooks.js';
import { ImportLedger } from '../src/importLedger.js';
import { RecipeApiClient } from '../src/RecipeApiClient.js';
import { renderReport } from '../src/importReport.js';
import { createCrfEngine } from '../src/parsing/crfEngine.js';
import { createLlmEngine } from '../src/parsing/llmEngine.js';
import { runImport, type ParseObservation } from '../src/runImport.js';

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

/**
 * Wire the two-engine parse observation, when the operator asked for it.
 *
 * ⛔ `NO_CACHE` and `NO_CORRECTIONS` are DELIBERATE, not placeholders (ADR-0026 §6). This package has no `pg`
 * and no `drizzle-orm`, reaching the recipe service's DALs over HTTP would mean a new wire surface plus
 * everything ADR-0014 and GR-017 attach to one, and the correction tier is semantically inapplicable here
 * anyway: with no caller identity, `findInForce(key, undefined)` returns only `global` corrections and the
 * 1919 corpus has none. The price is both engines on every line, which is visible in the run's own spend
 * figure rather than hidden behind an omitted port.
 *
 * @param requested - Whether `--parse-pipeline` was passed.
 * @param region - The AWS region for Bedrock.
 * @returns The observation to run with.
 * @throws When the CRF engine is not installed for the local interpreter.
 * @sideEffect Spawns Python to read the installed engine version; constructs a Bedrock client.
 */
async function resolveParseObservation(requested: boolean, region: string): Promise<ParseObservation> {
    if (!requested) {
        return { kind: 'off' };
    }

    const crf = await createCrfEngine();
    const llm = createLlmEngine({
        client: createBedrockConverseClient(createBedrockTransport({ region }).send),
        modelId: NOVA_MICRO_MODEL_ID,
    });

    return {
        kind: 'on',
        deps: {
            corrections: NO_CORRECTIONS,
            cache: NO_CACHE,
            engines: { crf, llm },
            digest: (value) => createHash('sha256').update(value).digest('hex'),
        },
        spentMicros: () => llm.spentMicros(),
    };
}

const report = await runImport({
    book,
    plainText: readFileSync(required(args, 'file'), 'utf-8'),
    client: new RecipeApiClient({ baseUrl: required(args, 'recipe-url'), token }),
    ledger: ImportLedger.load(args.get('ledger') ?? '.cookbook-import-ledger.json'),
    limit: Number(args.get('limit') ?? 150),
    settleMs: Number(args.get('settle-ms') ?? 30_000),
    parseObservation: await resolveParseObservation(
        args.has('parse-pipeline'),
        args.get('region') ?? process.env['AWS_REGION'] ?? 'us-east-1',
    ),
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
