/**
 * @module infra/smoke/deployedSmoke — post-deploy verification of the RUNNING CRF engine.
 *
 * `cdk deploy` succeeding means the stack converged. For this function that is unusually far from "it
 * works": ADR-0025 records, as a standing residual risk, that the asset's **arm64 / CPython 3.13 wheels have
 * never been loaded by a Python 3.13 interpreter on ARM**, and that "the first real proof is a deploy". A
 * Lambda whose code package cannot import deploys CLEAN and dies on its first cold start.
 *
 * ## Why the deploy is the only place this can be caught
 *
 * Nothing downstream reports it. `crfInvoke.ts` maps a failed invoke to `unavailable` PER LINE, and
 * ADR-0026 §3 has the pipeline read that as `single-engine llm` — absence, not dissent — precisely so a
 * transient outage does not become a permanent fact about an ingredient. That is the right behaviour and it
 * is also why a permanently broken engine is invisible: the two-engine parse quietly becomes a one-engine
 * parse, and the only symptom is slowly-degrading ingredient quality in production.
 *
 * So this is the earliest possible signal, and the only one that fires at ZERO traffic.
 *
 * ## What it asserts, and why each one
 *
 * | check | catches |
 * |---|---|
 * | {@link classifyInvocation} | the function is absent, throttled past a retry, or threw (`FunctionError`) |
 * | {@link classifyPayload} | the invoke returned nothing — a transport success carrying no answer |
 * | `parseEngineResponse` | the engine answered a shape its own contract does not allow |
 * | {@link classifyEngineVersion} | the deployed engine is not the pinned one, so every cached parse keyed by the version is about a different model |
 * | {@link classifyReading} | the interpreter loaded and the MODEL ran — a `failed` row for a line this simple is a broken engine, not a hard sentence |
 *
 * ⛔ The response is validated with THIS PACKAGE'S OWN zod (`parseEngineResponse`), never with a `jq` probe
 * in YAML. A shell probe would be a SECOND bearer of the engine's wire contract, free to drift from the zod
 * every other consumer parses through — which is the exact defect ADR-0014 and ADR-0025 are both written
 * around. There is one contract; this module borrows it rather than restating it.
 *
 * ⚠️ RECORDED TRADE-OFF — the invoke shells out to the AWS CLI rather than using `@aws-sdk/client-lambda`.
 * The SDK is the better form and should replace this the moment a lockfile update is convenient; it is not
 * used today because this package declares no AWS SDK dependency, and adding one desynchronises
 * `package-lock.json` (making `npm ci` fail) for a change whose whole subject is deploy reliability. The CLI
 * is a guaranteed part of every runner these workflows use and is already how they talk to Lambda. What
 * matters — the retry, the `FunctionError` read, the payload read, the schema and the version comparison —
 * all lives HERE, in one module, behind pure classifiers.
 *
 * The classifiers are pure so they are unit-tested directly; {@link main} owns all I/O.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { parseEngineResponse } from '../../src/index.js';
import { readRequirements } from '../lib/assetInspection.js';

/**
 * The line the engine is asked to read.
 *
 * Deliberately the plainest ingredient phrase there is. This smoke is asking "did the interpreter load and
 * did the model run", not "how good is the parse" — the parser's accuracy is measured against a 2,502-line
 * corpus (`docs/reports/2026-08-23-002-…`), not against one probe. A line the CRF could plausibly refuse
 * would make this check fail for reasons that have nothing to do with the deploy, and the fix people reach
 * for when that happens is deleting the check.
 */
const PROBE_LINE = '2 cups flour';

/** The engine distribution whose pinned version the answer must carry. */
const ENGINE_DISTRIBUTION = 'ingredient-parser-nlp';

/** The AWS error a throttled invoke reports. The one condition worth a second attempt. */
const THROTTLE = 'TooManyRequestsException';

/** The outcome of one smoke assertion. `reason` is written to be actionable in a CI log. */
export interface SmokeVerdict {
    readonly ok: boolean;
    readonly reason: string;
}

/**
 * The engine's pinned version, read from `requirements.txt`.
 *
 * DERIVED, never restated: `requirements.txt` is the pin ADR-0025 calls load-bearing three times over, and
 * a copy of the number here would be a fourth place for it to drift. `assetInspection.ts` already owns
 * reading that file.
 *
 * @param requirementsFile - Path to the package's `requirements.txt`.
 * @returns The pinned version, e.g. `2.3.0`.
 * @throws {Error} when the engine is not pinned exactly — an unpinned engine has no version to assert.
 * @sideEffect Reads the file.
 */
export function pinnedEngineVersion(requirementsFile: string): string {
    const pin = readRequirements(requirementsFile).find((line) => line.startsWith(`${ENGINE_DISTRIBUTION}==`));

    if (pin === undefined) {
        throw new Error(
            `ingredient-parser smoke: ${requirementsFile} does not pin ${ENGINE_DISTRIBUTION} with '==', so ` +
                'there is no version for the deployed engine to be checked against.',
        );
    }

    return pin.slice(`${ENGINE_DISTRIBUTION}==`.length);
}

/**
 * The invocation reached the function and the function did not throw. Pure.
 *
 * ⛔ `aws lambda invoke` exits 0 when the FUNCTION threw — the failure is in the response, not in the exit
 * status — so BOTH inputs are consulted. A `Failed` state, an unloadable code package, or anything the
 * import path raises all arrive as a `FunctionError`.
 *
 * ⚠️ The reason names the cold-start failures that have ACTUALLY happened, and refuses to pick one. It used
 * to assert that a `FunctionError` on a first deploy was "almost certainly the ADR-0025 residual: the arm64
 * / CPython 3.13 wheels … failing to import". The first real deploy then threw for an entirely different
 * reason — the engine looked up an NLTK tagger the asset had not staged and tried to DOWNLOAD it, onto a
 * read-only filesystem — while the arm64 wheels imported perfectly. A confident wrong diagnosis in a CI log
 * is worse than none: it sends the next reader to the wrong file. The classifier cannot know which it is,
 * so it names both and points at the log that does know.
 *
 * @param exitStatus - The CLI's exit status; non-zero is a transport or permission failure.
 * @param functionError - `--query FunctionError --output text`, which prints `None` when nothing threw.
 * @param diagnostics - The CLI's stderr, so an actionable reason survives.
 */
export function classifyInvocation(exitStatus: number, functionError: string, diagnostics: string): SmokeVerdict {
    if (exitStatus !== 0) {
        return {
            ok: false,
            reason:
                `the CRF engine could not be invoked (aws exited ${exitStatus}): ${diagnostics.trim() || 'no diagnostics'}. ` +
                'The function is absent, unreachable, or this role may not invoke it.',
        };
    }

    const trimmed = functionError.trim();

    if (trimmed !== '' && trimmed !== 'None' && trimmed !== 'null') {
        return {
            ok: false,
            reason:
                `the CRF engine threw on invocation (FunctionError=${trimmed}). The stack converged, so this ` +
                'is the import path, not the deploy — read the function’s CloudWatch log, which names the ' +
                'exception. Two causes have really happened here: an ImportError from the arm64 / CPython ' +
                '3.13 wheels, and an OSError on the read-only filesystem when the engine looks for data the ' +
                'asset did not stage (ADR-0025). Do not assume either without the log.',
        };
    }

    return { ok: true, reason: 'the engine answered without throwing' };
}

/**
 * The invocation produced an answer at all. Pure.
 *
 * An empty payload is a transport success carrying nothing, which must never read as a healthy engine.
 *
 * @param payload - The response body the CLI wrote.
 */
export function classifyPayload(payload: string): SmokeVerdict {
    return payload.trim() === ''
        ? { ok: false, reason: 'the invocation returned no payload at all, so nothing about the engine was proved' }
        : { ok: true, reason: 'the invocation returned a payload' };
}

/**
 * The DEPLOYED engine is the PINNED engine. Pure.
 *
 * ⛔ Not cosmetic. The engine version participates in the parse cache key precisely because "a CRF version
 * bump re-partitions the CRF rows and must not silently reuse the previous model's answers"
 * (`engine.schema.ts`). A deployed engine that differs from the pin means the corpus measurements, the
 * cached parses and the shipped model are three different things.
 *
 * @param declared - The version pinned in `requirements.txt`.
 * @param reported - The `engineVersion` the deployed function answered with.
 */
export function classifyEngineVersion(declared: string, reported: string): SmokeVerdict {
    return declared === reported
        ? { ok: true, reason: `the deployed engine is ${reported}, as pinned` }
        : {
              ok: false,
              reason:
                  `the deployed engine reports ${reported} but requirements.txt pins ${declared}. Every parse ` +
                  'cached under the pinned key would be a different model’s answer.',
          };
}

/**
 * The engine actually READ the line, rather than merely answering. Pure.
 *
 * This is the assertion that proves the Python interpreter loaded, the 90 MB of wheels imported and the
 * 1.6 MB CRF model was found and run — none of which a converged stack, a healthy `State`, or a
 * well-shaped envelope can tell you.
 *
 * @param statuses - The `status` of each result the engine returned, in order.
 */
export function classifyReading(statuses: readonly string[]): SmokeVerdict {
    if (statuses.length !== 1) {
        return {
            ok: false,
            reason: `the engine returned ${statuses.length} results for 1 submitted line — it is not echoing the batch`,
        };
    }

    return statuses[0] === 'parsed'
        ? { ok: true, reason: `the engine read "${PROBE_LINE}"` }
        : {
              ok: false,
              reason:
                  `the engine REFUSED "${PROBE_LINE}" (status=${statuses[0] ?? 'unknown'}). The function ran, so ` +
                  'this is the model or its data, not the packaging.',
          };
}

/** What {@link main} was asked to check. */
interface Options {
    readonly functionName: string;
    readonly region: string;
}

/**
 * Invoke the deployed engine once, retrying only a throttle.
 *
 * @param options - The function and region to invoke.
 * @param payloadFile - Where the CLI should write the response body.
 * @returns The CLI's exit status, its `FunctionError`, and its stderr.
 * @sideEffect Spawns the AWS CLI.
 */
function invokeOnce(
    options: Options,
    payloadFile: string,
): { readonly status: number; readonly functionError: string; readonly diagnostics: string } {
    const result = spawnSync(
        'aws',
        [
            'lambda',
            'invoke',
            '--region',
            options.region,
            '--function-name',
            options.functionName,
            '--payload',
            JSON.stringify({ lines: [PROBE_LINE] }),
            '--cli-binary-format',
            'raw-in-base64-out',
            '--query',
            'FunctionError',
            '--output',
            'text',
            payloadFile,
        ],
        { encoding: 'utf8' },
    );

    return {
        status: result.status ?? -1,
        functionError: result.stdout ?? '',
        diagnostics: result.stderr ?? '',
    };
}

/**
 * Run every check, printing one line each, and exit non-zero on the first failure.
 *
 * @sideEffect Invokes the deployed Lambda, reads the repository's `requirements.txt`, writes to stdout, and
 *   sets the process exit code.
 */
export async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            'function-name': { type: 'string' },
            region: { type: 'string' },
        },
    });

    const functionName = values['function-name'];
    const region = values.region ?? process.env['AWS_REGION'] ?? process.env['DEFAULT_AWS_REGION'];

    if (functionName === undefined || functionName === '' || region === undefined || region === '') {
        console.error('usage: deployedSmoke.ts --function-name <name> [--region <region>]');
        process.exitCode = 2;

        return;
    }

    const here = dirname(fileURLToPath(import.meta.url));
    const declared = pinnedEngineVersion(join(here, '../../requirements.txt'));
    const workdir = mkdtempSync(join(tmpdir(), 'crf-smoke-'));
    const payloadFile = join(workdir, 'response.json');
    const verdicts: SmokeVerdict[] = [];

    try {
        let invocation = invokeOnce({ functionName, region }, payloadFile);

        // ONE retry, and only for a throttle. Anything else is a real answer about the deploy, and retrying
        // it would just delay the report.
        if (invocation.diagnostics.includes(THROTTLE)) {
            console.log(`the engine was throttled (${THROTTLE}); retrying once`);
            invocation = invokeOnce({ functionName, region }, payloadFile);
        }

        verdicts.push(classifyInvocation(invocation.status, invocation.functionError, invocation.diagnostics));

        const payload = verdicts[0]?.ok === true ? readFileSync(payloadFile, 'utf8') : '';

        if (verdicts[0]?.ok === true) {
            verdicts.push(classifyPayload(payload));
        }

        if (verdicts.every((verdict) => verdict.ok)) {
            // Parse, don't validate — through the engine's OWN contract, so this smoke can never be a second
            // bearer of it. A shape the contract disallows throws here with the failing paths named.
            const response = parseEngineResponse(JSON.parse(payload));

            verdicts.push(classifyEngineVersion(declared, response.engineVersion));
            verdicts.push(classifyReading(response.results.map((result) => result.status)));
        }
    } catch (error) {
        verdicts.push({ ok: false, reason: error instanceof Error ? error.message : String(error) });
    } finally {
        rmSync(workdir, { recursive: true, force: true });
    }

    for (const verdict of verdicts) {
        console.log(`${verdict.ok ? '✅' : '❌'} ${verdict.reason}`);
    }

    const failures = verdicts.filter((verdict) => !verdict.ok);

    if (failures.length > 0) {
        console.error(
            `::error::the DEPLOYED CRF engine (${functionName}) failed post-deploy verification: ${failures
                .map((verdict) => verdict.reason)
                .join(' | ')}`,
        );
        process.exitCode = 1;
    }
}

// Executed directly by the deploy workflows; importable by its unit suite without running.
//
// ⛔ The guard compares this module's URL to the entry path, and must NEVER test for a `.ts` suffix. It
// did, and the deploy workflows now run this file COMPILED (`dist/infra/smoke/deployedSmoke.js`, under
// plain `node`, because `tsx` does not survive their dev-dependency prune) — under which
// `endsWith('deployedSmoke.ts')` is FALSE, so `main()` never ran, the step exited 0 in silence, and the
// only check that proves the CRF engine actually loads reported success without invoking anything. That
// is the success-returning no-op this repository has already paid four weeks of production for.
// `postPruneToolchain.test.ts` asserts that no entry guard behind a `node` invocation is
// extension-locked. `pathToFileURL`, not a `file://` template, so a path containing a space or a `#`
// still matches.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
