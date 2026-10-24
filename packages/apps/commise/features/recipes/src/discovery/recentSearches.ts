/**
 * @module @commise/features-recipes/discovery/recentSearches — the recent-search history model + its
 * persistence PORT (U7 "recent searches / live suggestions").
 *
 * Pure, platform-agnostic: no React, no DOM, no `AsyncStorage`. Every rule the feature promises lives here
 * — newest-first ordering, case-insensitive de-duplication, the retention cap, blank rejection, and
 * defensive parsing of whatever is actually on disk — so the two platform adapters stay three lines each
 * and can never drift on the semantics.
 *
 * Patterns: a normalizing VALUE-LIST transform ({@link mergeRecentSearches} is the single authoritative
 * normalizer; {@link addRecentSearch} and {@link parseRecentSearches} are thin specializations of it) behind
 * a PORT/ADAPTER seam ({@link RecentSearchStore}). The port is deliberately shaped as the
 * `getItem`/`setItem` pair both platform stores already speak, so the native adapter IS
 * `@react-native-async-storage/async-storage` and the web adapter is a thin `localStorage` wrapper — and a
 * test injects a fake without touching a real global.
 */

/**
 * How many recent searches are retained. Small on purpose: the panel is a shortcut shown in the idle state,
 * not a history log, and it must not push the browse rails off a phone screen.
 */
export const MAX_RECENT_SEARCHES = 6;

/**
 * The key one user's history is stored under, so a device shared by two people holds two histories and each sees only
 * their own. `subject` is the signed-in user's opaque identity-provider id (Clerk `userId`, never an email) — the same one
 * the editor's device keys use, and the one the sign-out command still holds after the session ends, which is what lets it
 * remove exactly this key. VERSIONED (`.v2`): the earlier `.v1` key was shared by everyone on the device, and is never
 * read again. Owner ruling 2026-10-17, recorded in `docs/design/uiOverhaul/ownerDecisions.md`.
 *
 * @param subject - The signed-in user's id.
 * @returns The storage key for that user's history.
 */
export function recentSearchesKeyFor(subject: string): string {
    return `commise.recipes.recentSearches.v2.${subject}`;
}

/**
 * The persistence port the recent-search history is read/written through — an injectable seam, so nothing
 * in the shared layer or in a test touches a real platform global.
 *
 * Async in both directions because native storage is (web `localStorage` is synchronous, which the promise
 * subsumes). Implementations MUST NOT reject: a history that cannot be read, written or removed is a missing
 * convenience, never a broken search — each adapter swallows its own platform failures (quota, private
 * mode, a missing native module) and reports "nothing stored".
 */
export interface RecentSearchStore {
    /**
     * Read the raw payload previously stored under `key`, or `null` when there is none.
     *
     * @sideEffect Reads platform storage.
     */
    readonly getItem: (key: string) => Promise<string | null>;
    /**
     * Persist `value` under `key`.
     *
     * @sideEffect Writes platform storage.
     */
    readonly setItem: (key: string, value: string) => Promise<void>;
    /**
     * Remove whatever is stored under `key`. Used when the user's session ends.
     *
     * @sideEffect Writes platform storage.
     */
    readonly removeItem: (key: string) => Promise<void>;
}

/** Case-insensitive identity of a query — the de-duplication key (searches are not case-significant). */
const dedupeKey = (query: string): string => query.trim().toLowerCase();

/**
 * Normalize a newest-first sequence of queries into the canonical stored form: trimmed, blank-free,
 * de-duplicated case-insensitively (the FIRST — i.e. newest — occurrence wins, keeping its own casing), and
 * capped at {@link MAX_RECENT_SEARCHES}.
 *
 * @param newer - Queries that are newer than `older`, themselves newest-first.
 * @param older - Queries that are older, newest-first.
 * @returns The merged, canonical history, newest-first.
 */
export function mergeRecentSearches(newer: readonly string[], older: readonly string[]): readonly string[] {
    const seen = new Set<string>();
    const merged: string[] = [];

    for (const candidate of [...newer, ...older]) {
        const query = candidate.trim();
        const key = dedupeKey(query);

        if (query.length === 0 || seen.has(key)) {
            continue;
        }

        seen.add(key);
        merged.push(query);

        if (merged.length === MAX_RECENT_SEARCHES) {
            break;
        }
    }

    return merged;
}

/**
 * How a query relates to the one recorded before it, ignoring case and surrounding whitespace. Equal queries are
 * `unrelated` here: the de-duplication already folds them.
 *
 * @param previous - The query recorded before.
 * @param query - The query being recorded.
 * @returns `extends` when letters were typed onto `previous`, `shortens` when letters were deleted from it.
 */
function relationTo(previous: string, query: string): 'extends' | 'shortens' | 'unrelated' {
    const before = dedupeKey(previous);
    const after = dedupeKey(query);

    if (before === after) {
        return 'unrelated';
    }

    if (after.startsWith(before)) {
        return 'extends';
    }

    return before.startsWith(after) ? 'shortens' : 'unrelated';
}

/**
 * Record a query that actually ran, at the front of the history.
 *
 * A pause in typing commits a PARTIAL query ("r" while typing "rice"), and that is not a search the cook meant to keep.
 * So when this query EXTENDS the one the SAME session recorded just before, it takes that one's place (A-027). Only
 * that one entry: an older entry that shares the prefix was a search of its own, and a search stored by an earlier
 * session is never `previous`, because the caller passes only what it recorded itself.
 *
 * Deleting letters never rewrites a search the cook ran (owner ruling 2026-10-18): a query that SHORTENS the previous
 * one is a partial on the way to something else, so nothing is recorded and the previous search stays.
 *
 * @param existing - The current history, newest-first.
 * @param query - The query that ran; blank/whitespace-only is ignored.
 * @param previous - The query this session recorded just before, if it recorded one.
 * @returns The updated history — or `existing` ITSELF (same reference) when there is nothing to record, so
 *   callers can treat an unchanged reference as "no write needed".
 */
export function addRecentSearch(existing: readonly string[], query: string, previous?: string): readonly string[] {
    if (query.trim().length === 0) {
        return existing;
    }

    const relation = previous === undefined ? 'unrelated' : relationTo(previous, query);

    if (relation === 'shortens') {
        return existing;
    }

    if (previous === undefined || relation === 'unrelated') {
        return mergeRecentSearches([query], existing);
    }

    const replaced = dedupeKey(previous);

    return mergeRecentSearches(
        [query],
        existing.filter((entry) => dedupeKey(entry) !== replaced),
    );
}

/**
 * Parse a stored payload into a history, tolerating anything at all on disk (an older shape, a truncated
 * write, another product's key collision, hand-edited storage). Never throws.
 *
 * @param raw - The raw stored payload, or `null` when nothing is stored.
 * @returns The canonical history, or an empty list when the payload is unusable.
 */
export function parseRecentSearches(raw: string | null): readonly string[] {
    if (raw === null) {
        return [];
    }

    let decoded: unknown;

    try {
        decoded = JSON.parse(raw);
    } catch {
        return [];
    }

    if (!Array.isArray(decoded)) {
        return [];
    }

    return mergeRecentSearches(
        decoded.filter((entry): entry is string => typeof entry === 'string'),
        [],
    );
}

/**
 * Serialize a history for storage.
 *
 * @param queries - The history to store, newest-first.
 * @returns The payload to hand {@link RecentSearchStore.setItem}.
 */
export function serializeRecentSearches(queries: readonly string[]): string {
    return JSON.stringify(queries);
}
