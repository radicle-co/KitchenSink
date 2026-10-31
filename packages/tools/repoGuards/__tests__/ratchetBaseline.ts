/**
 * The mechanics of a per-file ratchet over a committed JSON baseline, shared by `nativeStylingRatchet` and
 * `themeColourReadsRatchet` (ADR-0080). The rules live here once:
 *
 * - {@link over}: no file above its recorded count, and no unrecorded file with any.
 * - {@link stale}: no file recorded above its true count, so a drop is written down in the same change.
 * - {@link referenceBaseline} and {@link raisedAgainst}: the baseline itself only falls, measured against a REFERENCE:
 *   the baseline on `origin/main`, the merge target, or until it reaches main, the baseline as first committed in this
 *   history. Neither depends on one commit staying reachable, so a squash, a rebase or a deleted branch does not break
 *   the rule. A shallow clone, or one without `origin/main`, throws with the command to fetch, never a silent pass.
 * - One rise is allowed: a RECOUNT. When the current detector finds the higher count in the file as it stood at the
 *   reference, the detector learned a shape, and no styling was added. That is how a detector change re-records the
 *   code it now sees, with no override to write, review or expire.
 */
import { execFileSync } from 'node:child_process';

import { repoRoot } from './serviceSources.js';

/** A count per repo-relative file. */
export type FileCounts = Readonly<Record<string, number>>;

/**
 * Every file whose count is above its recorded one (an unrecorded file counts as recorded 0). Pure.
 *
 * @param actual - The counts now.
 * @param recorded - The counts recorded.
 * @returns One line per file over.
 */
export function over(actual: FileCounts, recorded: FileCounts): string[] {
    return Object.entries(actual)
        .filter(([file, count]) => count > (recorded[file] ?? 0))
        .map(([file, count]) => `${file}: ${count} > ${recorded[file] ?? 0}`);
}

/**
 * Every recorded file whose count now is below its recorded one. Pure.
 *
 * @param actual - The counts now.
 * @param recorded - The counts recorded.
 * @returns One line per stale entry.
 */
export function stale(actual: FileCounts, recorded: FileCounts): string[] {
    return Object.entries(recorded)
        .filter(([file, count]) => (actual[file] ?? 0) < count)
        .map(([file, count]) => `${file}: recorded ${count}, now ${actual[file] ?? 0}`);
}

function git(args: readonly string[]): string | undefined {
    try {
        return execFileSync('git', args, {
            cwd: repoRoot,
            encoding: 'utf8',
            maxBuffer: 1 << 26,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return undefined;
    }
}

/** The baseline a committed one may only fall from, and where it was read. */
export interface Reference<T> {
    readonly source: string;
    readonly baseline: T;
}

/**
 * The reference for a committed baseline. `undefined` only when no commit in this history adds the baseline, which a
 * ratchet refuses.
 *
 * @param baselinePath - The baseline's repo-relative path.
 * @returns The reference and where it came from.
 * @sideEffect Reads git history.
 * @throws Error when the clone is shallow or has no `origin/main`, which would make the rule pass on nothing.
 */
export function referenceBaseline<T>(baselinePath: string): Reference<T> | undefined {
    if (git(['rev-parse', '--is-shallow-repository'])?.trim() === 'true') {
        throw new Error('This clone is shallow, so the baseline history cannot be read: run git fetch --unshallow.');
    }

    if (git(['rev-parse', '--verify', '--quiet', 'origin/main']) === undefined) {
        throw new Error(
            'origin/main is not in this clone, so the baseline has no reference: run git fetch origin main.',
        );
    }

    const onMain = git(['show', `origin/main:${baselinePath}`]);

    if (onMain !== undefined) {
        return { source: 'origin/main', baseline: JSON.parse(onMain) as T };
    }

    const [introduced] = (git(['log', '--diff-filter=A', '--reverse', '--format=%H', '--', baselinePath]) ?? '')
        .split('\n')
        .filter((line) => line.length > 0);
    const first = introduced === undefined ? undefined : git(['show', `${introduced}:${baselinePath}`]);

    return first === undefined || introduced === undefined
        ? undefined
        : { source: introduced, baseline: JSON.parse(first) as T };
}

/** The current detector's count for one file, given that file's source. */
export type Recount = (file: string, source: string) => number;

/** One file's source at a git revision, or `undefined` when it did not exist there. */
export type SourceAt = (revision: string, file: string) => string | undefined;

/** {@link SourceAt} over this repository's history. */
export const gitSourceAt: SourceAt = (revision, file) => git(['show', `${revision}:${file}`]);

/**
 * Every count a committed baseline raised against its reference, each tagged with where the reference was read. A rise
 * the current detector finds in the file AS IT STOOD AT THE REFERENCE is a recount, not new styling, and is allowed:
 * that is how a detector that learns a new shape re-records the code it now sees, with no override to write or expire.
 * A path the reference did not have, or a rise beyond what its old source holds, is refused. Pure, given `sourceAt`.
 *
 * @param reference - The reference baseline and the revision it was read at.
 * @param pairs - Each committed map, the reference's matching map, and optionally the detector that recounts it.
 * @param sourceAt - Reads a file at a revision. Defaults to git.
 * @returns One line per refused count.
 */
export function raisedAgainst<T>(
    reference: Reference<T>,
    pairs: readonly (readonly [committed: FileCounts, pick: (baseline: T) => FileCounts, recount?: Recount])[],
    sourceAt: SourceAt = gitSourceAt,
): string[] {
    return pairs.flatMap(([committed, pick, recount]) => {
        const recorded = pick(reference.baseline);

        return Object.entries(committed)
            .filter(([file, count]) => count > (recorded[file] ?? 0))
            .flatMap(([file, count]) => {
                const head = `${file}: ${count} > ${recorded[file] ?? 0} (the reference is ${reference.source}`;

                if (recount === undefined) {
                    return [`${head})`];
                }

                const before = sourceAt(reference.source, file);

                if (before === undefined) {
                    return [`${head}, where the file did not exist)`];
                }

                const then = recount(file, before);

                return count > then ? [`${head}, where the current detector counts ${then})`] : [];
            });
    });
}
