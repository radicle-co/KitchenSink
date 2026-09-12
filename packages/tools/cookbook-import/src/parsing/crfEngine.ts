/**
 * @module crfEngine — the local Python CRF, as a {@link ParseEnginePort} (plan U22, phase 5).
 *
 * DESIGN PATTERN: **Adapter**, in the strict sense: it translates one shape into another and adds no
 * behaviour. The process is `crfProcess.ts`'s (one Python process for a whole corpus, an asserted echo per
 * row, a surfaced exit status); the row's shape is `crfParse.ts`'s; the promotion to a `ParsedLine` is
 * `recipe-import-core`'s. What is left here is a version and a `map`.
 *
 * ## ⚠️ THIS IS THE LOCAL SIDECAR, NOT THE DEPLOYED ENGINE — and they are different transports
 *
 * `packages/services/ingredient-parser` is a Lambda whose contract carries `status: 'parsed' | 'failed'` PER
 * LINE and echoes its own `engineVersion`. The sidecar here carries neither: it prints six fields per row and
 * throws for the whole batch on any failure (`crfProcess.ts` surfaces the exit status and stderr, because "a
 * half-read stream would silently shrink the denominator of every agreement rate in the report"). Both are
 * legal under the port — a rejected batch is absence for every line in it — and this is exactly why the port
 * is defined by the domain rather than by either transport.
 *
 * ⛔ Do NOT "fix" that by catching the throw and returning per-line unavailability. The sidecar cannot tell
 * which line it died on, so a per-line answer here would be an invention, and a batch that half-succeeded
 * would report a denominator it did not earn.
 *
 * ## ⛔ THE VERSION IS READ FROM THE INTERPRETER, NEVER DECLARED
 *
 * `ingredient_parse_cache` is keyed on `(lineDigest, engine, engineVersion)` and its write is
 * `ON CONFLICT DO NOTHING`, so a row written under the wrong version is PERMANENT within its generation. The
 * pin already lives in three places by its own docstring's count — `requirements.txt`, `_ci.yml`, and the
 * measured report — and a fourth copy in TypeScript would be one nothing keeps in step. So this asks the
 * interpreter that is about to run the sidecar what it actually has installed, which is the same thing the
 * deployed engine does ("read from its installed metadata") and cannot drift by construction.
 *
 * ⚠️ It doubles as the installation check: a machine without the engine fails HERE, at wiring time, with the
 * pip command in the message — rather than 2,000 lines into an import run.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { promoteCrfReading, type EngineAnswer, type ParseEnginePort } from '@kitchensink/recipe-import-core';

import { parseLinesWithCrf, type CrfRunOptions } from '../parseComparison/crfProcess.js';

const run = promisify(execFile);

/** The distribution whose version identifies this engine. */
const DISTRIBUTION = 'ingredient-parser-nlp';

/**
 * What {@link createCrfEngine} needs beyond the defaults.
 *
 * ⚠️ An ALIAS rather than an empty extending interface: both jobs this adapter does — reading the installed
 * version and running the sidecar — take the SAME interpreter and the same script override, so there is
 * genuinely nothing to add. Restating the two fields would be a second representation of `CrfRunOptions`.
 */
export type CrfEngineOptions = CrfRunOptions;

/**
 * Ask the interpreter what it has installed.
 *
 * @param python - The interpreter the sidecar will run under.
 * @returns `{distribution}=={version}`, the same form `requirements.txt` pins.
 * @throws When the engine is not importable by that interpreter — which is the honest failure, and the one
 *   worth having at wiring time rather than mid-run.
 * @sideEffect Spawns a Python process.
 */
async function installedVersion(python: string): Promise<string> {
    try {
        const { stdout } = await run(python, [
            '-c',
            `import importlib.metadata as m; print(m.version("${DISTRIBUTION}"))`,
        ]);

        return `${DISTRIBUTION}==${stdout.trim()}`;
    } catch (error) {
        throw new Error(
            `crfEngine: ${python} cannot import ${DISTRIBUTION}. Install it with ` +
                `\`pip3 install --user '${DISTRIBUTION}==2.3.0'\` — the version CI pins.`,
            { cause: error },
        );
    }
}

/**
 * Build the CRF leg of the parse pipeline.
 *
 * @param options - Interpreter and sidecar overrides; both default to the real ones.
 * @returns A port that reads a whole batch in ONE Python process.
 * @throws When the engine is not installed for the chosen interpreter.
 * @sideEffect Spawns a Python process to read the installed version.
 */
export async function createCrfEngine(options: CrfEngineOptions = {}): Promise<ParseEnginePort<'crf'>> {
    const python = options.python ?? 'python3';
    const engineVersion = await installedVersion(python);

    return {
        engine: 'crf',
        engineVersion,
        async parse(lines): Promise<readonly EngineAnswer[]> {
            const rows = await parseLinesWithCrf(lines, options);

            // ⚠️ `CrfParse` is structurally a `CrfReading`, so this is a re-label rather than a conversion.
            // `raw` is the line WE submitted, never `row.sentence`: the two CRF schemas document that field
            // as opposite things ("echoed back" here, "the parser's NORMALISED sentence" in the Lambda), and
            // HAZ-041 needs the byte-identical input.
            return rows.map((row, index) => promoteCrfReading(row, lines[index] as string));
        },
    };
}
