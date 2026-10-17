/**
 * @module @kitchensink/sync — the optimistic projection.
 *
 * Offline is a PAUSE (owner ruling), so optimistic display is the NORMAL write path — online and offline, web
 * and mobile alike. Offline only lengthens the delay.
 *
 * @pattern Read model — a pure projection of "what the cook just did" over "what the server last said",
 *     computed at read time and never written into the cache as if it were server truth.
 */

/** The server's last known state of the thing being written, when there is one. */
export interface ServerFacts {
    readonly currentVersion: number;
    readonly visibility: string;
    readonly sourceType: string;
    readonly nutrition?: unknown;
}

/** Fields the SERVER decides, which a client must never guess. */
const SERVER_DECIDED = ['visibility', 'sourceType', 'nutrition'] as const;

/** An optimistic view, with the fields it cannot know named rather than invented. */
export interface LocalProjection {
    readonly value: Record<string, unknown>;
    readonly pending: true;
    /** Field names the server decides and this projection deliberately does not supply. */
    readonly unknown: readonly string[];
}

/**
 * Project a write optimistically.
 *
 * ⛔ IT NEVER ADVANCES `currentVersion`. That number is the CAS token the next sync attempt sends as
 * `expectedVersion`; advancing it would make the attempt claim a version the server never issued, and the 409
 * that protects the cook's work would stop firing. This is what makes optimism structurally incapable of
 * masking a conflict — the defect `useUpdateRecipe`'s docstring was written against.
 *
 * ⛔ AND IT NEVER GUESSES A SERVER-DECIDED FIELD. `visibility` is settled by C-004 and `sourceType` by the
 * provenance policy, both server-side and both refusable. Guessing "private" would promise a free-tier cook
 * something the server is about to decline.
 *
 * @param cached - The server's last known state, or `undefined` for something it has never seen.
 * @param edits - What the cook just entered.
 * @returns The optimistic view. Pure.
 */
export function projectOptimistic(cached: ServerFacts | undefined, edits: Record<string, unknown>): LocalProjection {
    if (cached === undefined) {
        return { value: { ...edits }, pending: true, unknown: [...SERVER_DECIDED] };
    }

    return {
        value: { ...cached, ...edits, currentVersion: cached.currentVersion },
        pending: true,
        unknown: [],
    };
}
