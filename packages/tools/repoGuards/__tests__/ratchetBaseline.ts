/**
 * The mechanics of a per-file ratchet over a committed JSON baseline, shared by `nativeStylingRatchet` and
 * `themeColourReadsRatchet` (ADR-0080). The rules live here once:
 *
 * - {@link over}: no file above its recorded count, and no unrecorded file with any.
 * - {@link stale}: no file recorded above its true count, so a drop is written down in the same change.
 * - {@link baselineHistory} and {@link raisedAgainst}: the baseline itself only falls. No file's count is ever above
 *   the LOWEST count any version of the baseline in this history recorded for it, the copy on `origin/main` included.
 *   A file absent from a version counts 0 there, so a file the first version did not list can never appear, and a file
 *   that fell to zero can never come back. Comparing with one version only (the first, or main's) let a count that fell
 *   be raised back on a long-lived branch. Nothing depends on one commit staying reachable, so a squash, a rebase or a
 *   deleted branch does not break the rule. A shallow clone, or one without `origin/main`, throws with the command to
 *   fetch, never a silent pass.
 * - One rise is allowed: a RECOUNT. When the current detector finds the higher count in the file as it stood at the
 *   version that holds the lowest count, the detector learned a shape, and no styling was added. That is how a detector
 *   change re-records the code it now sees, with no override to write, review or expire.
 */
import { execFileSync } from 'node:child_process';

import { repoRoot } from './serviceSources.js';

/** A count per repo-relative file. */
export type FileCounts = Readonly<Record<string, number>>;

/**
 * Every file whose count is above its recorded one, with both counts (an unrecorded file counts as recorded 0). Pure.
 *
 * @param actual - The counts now.
 * @param recorded - The counts recorded.
 */
function risesOf(actual: FileCounts, recorded: FileCounts): readonly (readonly [string, number, number])[] {
    return Object.entries(actual)
        .filter(([file, count]) => count > (recorded[file] ?? 0))
        .map(([file, count]) => [file, count, recorded[file] ?? 0] as const);
}

/**
 * Every file whose count is above its recorded one (an unrecorded file counts as recorded 0). Pure.
 *
 * @param actual - The counts now.
 * @param recorded - The counts recorded.
 * @returns One line per file over.
 */
export function over(actual: FileCounts, recorded: FileCounts): string[] {
    return risesOf(actual, recorded).map(([file, count, before]) => `${file}: ${count} > ${before}`);
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

/** One committed version of a baseline: the revision it was read at, and what it recorded. */
export interface BaselineVersion<T> {
    readonly revision: string;
    readonly baseline: T;
}

/**
 * Every committed version of a baseline reachable from HEAD, newest first, plus the copy on `origin/main` when it has
 * one. Empty only when no commit in this history holds the baseline, which a ratchet refuses.
 *
 * @param baselinePath - The baseline's repo-relative path.
 * @returns The versions.
 * @sideEffect Reads git history.
 * @throws Error when the clone is shallow or has no `origin/main`, which would make the rule pass on nothing.
 */
export function baselineHistory<T>(baselinePath: string): readonly BaselineVersion<T>[] {
    if (git(['rev-parse', '--is-shallow-repository'])?.trim() === 'true') {
        throw new Error('This clone is shallow, so the baseline history cannot be read: run git fetch --unshallow.');
    }

    if (git(['rev-parse', '--verify', '--quiet', 'origin/main']) === undefined) {
        throw new Error(
            'origin/main is not in this clone, so the baseline has no reference: run git fetch origin main.',
        );
    }

    const revisions = (git(['log', '--format=%H', '--', baselinePath]) ?? '')
        .split('\n')
        .filter((line) => line.length > 0);

    return [...revisions, 'origin/main'].flatMap((revision) => {
        const text = git(['show', `${revision}:${baselinePath}`]);

        return text === undefined ? [] : [{ revision, baseline: JSON.parse(text) as T }];
    });
}

/** The current detector's count for one file, given that file's source. */
export type Recount = (file: string, source: string) => number;

/** One file's source at a git revision, or `undefined` when it did not exist there. */
export type SourceAt = (revision: string, file: string) => string | undefined;

/** {@link SourceAt} over this repository's history. */
export const gitSourceAt: SourceAt = (revision, file) => git(['show', `${revision}:${file}`]);

/** A file's lowest recorded count, and the newest version that recorded it. */
interface Lowest {
    readonly count: number;
    readonly revision: string;
}

/**
 * Each file's lowest count across the versions (a file absent from a version counts 0 there), and the newest version
 * that holds it. Pure.
 */
function lowestCounts<T>(
    history: readonly BaselineVersion<T>[],
    pick: (baseline: T) => FileCounts,
    files: readonly string[],
): ReadonlyMap<string, Lowest> {
    return new Map(
        files.map((file) => {
            const lowest = history.reduce<Lowest | undefined>((found, { revision, baseline }) => {
                const count = pick(baseline)[file] ?? 0;

                return found === undefined || count < found.count ? { count, revision } : found;
            }, undefined);

            return [file, lowest ?? { count: 0, revision: 'no committed baseline' }];
        }),
    );
}

/**
 * Every count a committed baseline raised above the lowest count its history recorded, except a recount. Pure, given
 * `sourceAt`.
 *
 * @param history - The baseline's committed versions, newest first ({@link baselineHistory}).
 * @param pairs - Each committed map, the matching map of a version, and optionally the detector that recounts it.
 * @param sourceAt - Reads a file at a revision. Defaults to git.
 * @returns One line per refused count.
 */
export function raisedAgainst<T>(
    history: readonly BaselineVersion<T>[],
    pairs: readonly (readonly [committed: FileCounts, pick: (baseline: T) => FileCounts, recount?: Recount])[],
    sourceAt: SourceAt = gitSourceAt,
): string[] {
    return pairs.flatMap(([committed, pick, recount]) => {
        const lowest = lowestCounts(history, pick, Object.keys(committed));
        const recorded = Object.fromEntries([...lowest].map(([file, { count }]) => [file, count]));

        return risesOf(committed, recorded).flatMap(([file, count, before]) => {
            const { revision } = lowest.get(file) ?? { revision: 'no committed baseline' };
            const head = `${file}: ${count} > ${before} (lowest at ${revision}`;

            if (recount === undefined) {
                return [`${head})`];
            }

            const source = sourceAt(revision, file);

            if (source === undefined) {
                return [`${head}, where the file did not exist)`];
            }

            const then = recount(file, source);

            return count > then ? [`${head}, where the current detector counts ${then})`] : [];
        });
    });
}
