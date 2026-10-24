/**
 * The base a CI seed diff plans against (curated catalog plan U5, KTD-11).
 *
 * A base with no seed directory, or one whose seed does not compose, is an empty catalog, and the diff's note says
 * which. A base whose directory exists but cannot be read (a pinned file missing, any other failure) is an error: an
 * empty base would show every root as added, for a reason no note states.
 */
import { EMPTY_SNAPSHOT, type CatalogSnapshot } from './catalogSnapshot.js';
import { isSeedRefusedError } from './curatedSeedFormat.errors.js';

/** The base to plan against, and why it is empty when it is. */
export interface DiffBase {
    readonly snapshot: CatalogSnapshot;
    readonly note?: string;
}

/** How the base is read. */
export interface DiffBaseReader {
    /** Whether the base seed data directory exists. */
    readonly exists: (dir: string) => Promise<boolean>;
    /** The base seed, composed and projected; throws `SeedRefusedError` when it does not compose. */
    readonly project: (dir: string) => Promise<CatalogSnapshot>;
}

/**
 * Read the base seed as a snapshot, or an empty catalog when it holds no seed or does not compose.
 *
 * @sideEffect Reads the base directory through `reader`.
 * @param dir - The base seed data directory.
 * @param reader - How the base is read.
 * @returns The base.
 * @throws Anything but a seed refusal, including a missing file inside a base directory that exists.
 */
export async function readDiffBase(dir: string, reader: DiffBaseReader): Promise<DiffBase> {
    if (!(await reader.exists(dir))) {
        return {
            snapshot: EMPTY_SNAPSHOT,
            note: 'The base holds no seed yet, so the head is diffed against an empty catalog.',
        };
    }

    try {
        return { snapshot: await reader.project(dir) };
    } catch (error) {
        if (isSeedRefusedError(error)) {
            return {
                snapshot: EMPTY_SNAPSHOT,
                note: `The base seed does not compose (${String(error.issues.length)} issue(s)), so the head is diffed against an empty catalog.`,
            };
        }

        throw error;
    }
}
