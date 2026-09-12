/**
 * @module localCrfEngine — the CRF leg's LOCAL transport, for `npm run local:up` (ADR-0025, ADR-0026).
 *
 * DESIGN PATTERN: **Adapter over the seam the shipped adapter already declares.** `crfInvoke.ts` takes its
 * `client` injected — "so the unit tier drives every outcome" — and that same seam is what a local run
 * needs: locally there is no `AWS::Lambda::Function` (`up.ts` creates queues, buckets, tables and
 * parameters; it does not deploy Lambdas), so nothing answers an `InvokeCommand`. This module puts the
 * DEPLOYED handler behind that seam as a subprocess.
 *
 * ## ⛔ IT RUNS `packages/services/ingredient-parser/src/handler.py` — THE DEPLOYED ENGINE, VERBATIM
 *
 * `packages/tools/cookbook-import` also has a working local CRF (`scripts/crfParse.py` + `crfProcess.ts`),
 * and it was the obvious thing to reuse. It is the wrong one HERE, on the criterion that decides every other
 * choice in this directory — parity — and its own docstring says so: *"THIS IS THE LOCAL SIDECAR, NOT THE
 * DEPLOYED ENGINE — and they are different transports."* It prints six fields per row, throws for a whole
 * batch on any failure, and reports no `engineVersion` at all, so a local run over it would exercise none of
 * `crfInvoke.ts`: not `engineResponseSchema`, not the per-line `status`, not the version refusal, not the
 * chunking. Running `handler.py` instead invents no Python and puts the real contract on the local path.
 *
 * ⚠️ It is also not importable: `@kitchensink/cookbook-import` declares no `exports` and no `main`, so a
 * deployable could not depend on it without editing a tools package to open one — the coupling ADR-0026 §6
 * refuses in the mirror direction.
 *
 * ## ⚠️ ONE PROCESS PER INVOCATION, DELIBERATELY
 *
 * `ingredient_parser` loads a CRF model at import, which is why the comparison harness keeps one process for
 * a whole corpus. That does not apply here: the parse queue is consumed at `batchSize: 1`, so one invocation
 * IS one line, and a per-invocation process mirrors a cold Lambda exactly. Measured at ~1.0s wall for a
 * two-line batch on this repo's engine pin — acceptable for a developer's sandbox, and honest about what the
 * deployed function pays.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import type { LambdaClient } from '@aws-sdk/client-lambda';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The parser package, relative to this module — `packages/services/{recipe-workers,ingredient-parser}`. */
const ENGINE_PACKAGE_DIR = path.resolve(MODULE_DIR, '..', '..', '..', 'ingredient-parser');

/** The directory `handler.py` lives in, which is what must be on `sys.path`. */
export const ENGINE_HANDLER_DIR = path.join(ENGINE_PACKAGE_DIR, 'src');

/** The distribution whose version the engine reports. */
/** Mirrors `packaging.ts`'s `NLTK_DATA_DIRECTORY`; the deployed asset stages the corpus here. */
const NLTK_DATA_DIRECTORY = 'nltk_data';

const DISTRIBUTION = 'ingredient-parser-nlp';

/** `ingredient-parser-nlp==2.3.0` in the pin file. */
const PINNED = /^\s*ingredient-parser-nlp\s*==\s*([^\s#]+)\s*$/mu;

/**
 * A driver that hands one request document to the engine and returns its answer document.
 *
 * ⚠️ Strings in and out, not objects: the deployed transport is a Lambda invoke carrying JSON bytes, so the
 * local one crosses the same boundary. A runner typed in parsed objects would let the local path skip the
 * serialisation the deployed path cannot.
 */
export type LocalCrfEngineRunner = (
    requestJson: string,
) => Promise<{ readonly ok: true; readonly payload: string } | { readonly ok: false; readonly reason: string }>;

/** What {@link pinnedCrfEngineVersion} reads, injectable so the pin's parsing is testable without the file. */
export interface PinnedVersionOptions {
    /** The contents of `requirements.txt`. Read from the parser package when omitted. */
    readonly requirements?: string;
}

/**
 * The engine version the local adapter declares.
 *
 * ⛔ DERIVED FROM `requirements.txt`, NOT FROM THE INTERPRETER. `crfInvoke.ts` refuses an answer whose
 * reported version differs from the declared one, and that check is only worth having if the two sides are
 * independent — asking the same interpreter that is about to answer would make it agree with itself by
 * construction. The pin file is already the source of truth `assetContents.ts` derives the packaged asset's
 * manifest directory from, so this is not a new copy of the number.
 *
 * ⚠️ The BARE version, without the `ingredient-parser-nlp==` prefix, because that is what `handler.py`
 * reports: `ENGINE_VERSION = metadata.version("ingredient-parser-nlp")`.
 *
 * ⛔ Returns the FULL PIN (`ingredient-parser-nlp==2.3.0`), not the bare version — this is what
 * `createCrfInvokeEngine` takes as `declaredEngineVersion`, and it is byte-identical to the
 * `CRF_ENGINE_VERSION` the deployed stack injects. It was the bare form until 2026-09-02, when the adapter
 * began parsing its pin at construction (`parseEnginePin`) and normalizing the engine's bare report UP to
 * this spelling, so that both CRF adapters key `ingredient_parse_cache` with ONE identity. A bare value here
 * now fails loudly at construction, which is the intended behaviour for a mis-wired pin — but it would fail
 * the LOCAL runner for a reason that has nothing to do with the developer's machine, so the parity is the
 * point. The distribution half comes from `DISTRIBUTION`, so the name is still stated once.
 *
 * @param options - The pin file's contents, for tests.
 * @returns The full pin, e.g. `ingredient-parser-nlp==2.3.0`.
 * @throws When the pin is missing or unpinned — never a guess, because a wrong version silently poisons
 *   `ingredient_parse_cache`, whose write is `ON CONFLICT DO NOTHING` and therefore permanent.
 * @sideEffect Reads `requirements.txt` when `options.requirements` is omitted.
 */
export function pinnedCrfEngineVersion(options: PinnedVersionOptions = {}): string {
    const requirements =
        options.requirements ?? readFileSync(path.join(ENGINE_PACKAGE_DIR, 'requirements.txt'), 'utf8');
    const version = PINNED.exec(requirements)?.[1];

    if (version === undefined) {
        throw new Error(
            `localCrfEngine: requirements.txt carries no exact pin for ${DISTRIBUTION}; refusing to guess a version.`,
        );
    }

    return `${DISTRIBUTION}==${version}`;
}

/** What {@link createPythonEngineRunner} needs. */
export interface PythonEngineRunnerOptions {
    /** The interpreter. Defaults to `python3`. */
    readonly python?: string;
    /** The directory holding `handler.py`. Defaults to the parser package's `src`. */
    readonly handlerDir?: string;
}

/**
 * The driver program, kept to the smallest thing that can call the deployed handler.
 *
 * ⛔ It parses nothing and shapes nothing: it puts `handler.py` on the path, hands it the request it was
 * given, and prints what it answered. Every rule about what a CRF answer means stays in `handler.py` and in
 * `crfInvoke.ts` — a driver that did more would be a third opinion about the engine's contract.
 */
const DRIVER = [
    'import json,sys',
    'sys.path.insert(0, sys.argv[1])',
    'import handler',
    'print(json.dumps(handler.handle(json.loads(sys.stdin.read()))))',
].join('\n');

/**
 * Run the deployed handler under a local interpreter.
 *
 * @param options - Interpreter and handler directory overrides.
 * @returns A runner. A missing interpreter, a missing engine or a handler exception all answer `ok: false`.
 * @sideEffect Spawns a Python process per call.
 */
export function createPythonEngineRunner(options: PythonEngineRunnerOptions = {}): LocalCrfEngineRunner {
    const python = options.python ?? 'python3';
    const handlerDir = options.handlerDir ?? ENGINE_HANDLER_DIR;

    return async (requestJson) =>
        new Promise((resolve) => {
            // ⚠️ `spawn` with a piped stdin rather than `execFile`: the request goes in on STDIN, never in
            // argv. A recipe line is user text of arbitrary length and content, and an argv-carried request
            // would hit the platform argument limit on a full batch and would put user text in a process
            // listing.
            // ⛔ NLTK_DATA, or this silently DOWNLOADS. The engine asks `nltk.data.find` for a POS tagger
            // at import and, missing it, fetches it into `$HOME/nltk_data` — which is what killed the first
            // deployed invocation (ADR-0025: Lambda's filesystem is read-only outside `/tmp`). The deployed
            // path is fixed by staging the corpus into the asset; this local path inherited the old
            // behaviour, so a machine without `~/nltk_data` reaches the network on first use and a machine
            // WITH it silently uses a copy nobody pinned. Pointing at the staged corpus when it exists makes
            // the two paths read the same bytes; when it does not, the previous behaviour is unchanged.
            const stagedCorpus = path.join(ENGINE_PACKAGE_DIR, 'dist-asset', NLTK_DATA_DIRECTORY);
            const child = spawn(python, ['-c', DRIVER, handlerDir], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: existsSync(stagedCorpus) ? { ...process.env, NLTK_DATA: stagedCorpus } : process.env,
            });
            let stdout = '';
            let stderr = '';

            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');
            child.stdout.on('data', (chunk: string) => {
                stdout += chunk;
            });
            child.stderr.on('data', (chunk: string) => {
                stderr += chunk;
            });
            // A missing interpreter arrives as an `error` event, not as an exit code.
            child.on('error', (error) => {
                resolve({ ok: false, reason: error.message });
            });
            child.on('close', (code) => {
                resolve(
                    code === 0
                        ? { ok: true, payload: stdout }
                        : // ⚠️ The engine's own stderr, TRIMMED TO ITS LAST LINES. `handler.py` raises
                          // `InvalidRequest` with the offending index but never the line's text, so this
                          // carries a cause without carrying user recipe text into a log.
                          {
                              ok: false,
                              reason: `${python} exited ${String(code)}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`,
                          },
                );
            });

            child.stdin.on('error', () => undefined);
            child.stdin.end(requestJson, 'utf8');
        });
}

/**
 * The local stand-in for `LambdaClient`, as `createCrfInvokeEngine` takes it.
 *
 * ⛔ A failed run answers with `FunctionError` rather than throwing. That is the shape the shipped adapter
 * reads, and it is what keeps ADR-0026 §3's rule true locally: an engine that could not answer is ABSENCE
 * for every line in the chunk — the pipeline's `single-engine`, never dissent and never a crash that takes
 * the other engine's good answer with it.
 *
 * @param runner - The driver that actually reaches the engine.
 * @returns Something with a `send` the CRF adapter accepts.
 */
export function createLocalCrfLambdaClient(runner: LocalCrfEngineRunner): Pick<LambdaClient, 'send'> {
    return {
        send: (async (command: { input?: { Payload?: Uint8Array } }) => {
            const payload = command.input?.Payload;
            const request = payload === undefined ? '' : Buffer.from(payload).toString('utf8');
            const answer = await runner(request);

            if (!answer.ok) {
                return { FunctionError: `LocalEngineFailure: ${answer.reason}` };
            }

            return { Payload: Buffer.from(answer.payload, 'utf8') };
        }) as unknown as LambdaClient['send'],
    };
}
