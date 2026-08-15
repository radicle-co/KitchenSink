/**
 * Pure CLI-argument handling for the bulk-seed task, split out of `main.ts` so it is testable without
 * importing a module whose side effect is "run an import against the database".
 *
 * Argument parsing uses Node's built-in `node:util` {@link parseArgs} rather than a hand-rolled `argv`
 * loop or a third-party dependency (library-first, zero added deps).
 */
import { parseArgs } from 'node:util';

import type { CanonicalCandidate } from '../../sources/foodSourceAdapter.js';

/** The validated CLI options for a bulk-seed run. */
export interface SeedCliOptions {
    /** Directory holding the extracted USDA bulk CSVs. */
    readonly dir: string;
    /** Optional cap on candidates processed — a bounded smoke run before committing to the full import. */
    readonly limit: number | undefined;
}

/**
 * Parse + validate the CLI options. `--dir` falls back to `USDA_BULK_DIR`. Validation is strict and
 * up-front: an operator who fat-fingers `--limit 1O` gets an immediate error rather than an import that
 * silently seeds nothing (`Number('1O')` is `NaN`).
 *
 * @param argv - The process arguments (excluding `node` and the script path).
 * @returns The validated options.
 * @throws {Error} when no directory is supplied, or `--limit` is not a positive integer.
 */
export function parseSeedArgs(argv: readonly string[]): SeedCliOptions {
    const { values } = parseArgs({
        args: [...argv],
        options: { dir: { type: 'string' }, limit: { type: 'string' } },
        allowPositionals: false,
    });

    const dir = values.dir ?? process.env['USDA_BULK_DIR'];

    if (!dir) {
        throw new Error('Missing --dir (or USDA_BULK_DIR): the directory holding the extracted USDA bulk CSVs.');
    }

    if (values.limit === undefined) {
        return { dir, limit: undefined };
    }

    const limit = Number(values.limit);

    if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error(`Invalid --limit "${values.limit}" — expected a positive integer.`);
    }

    return { dir, limit };
}

/**
 * Take at most `limit` candidates from a stream (the bounded smoke run). A pass-through when unbounded.
 *
 * @param source - The candidate stream.
 * @param limit - The cap, or `undefined` for no cap.
 * @returns The (possibly truncated) stream.
 */
export async function* take(
    source: AsyncIterable<CanonicalCandidate>,
    limit: number | undefined,
): AsyncGenerator<CanonicalCandidate> {
    if (limit === 0) {
        return;
    }

    let taken = 0;

    for await (const candidate of source) {
        taken += 1;
        yield candidate;

        if (limit !== undefined && taken >= limit) {
            return;
        }
    }
}
