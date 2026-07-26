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
 * The key the history is stored under. VERSIONED (`.v1`): if the persisted shape ever changes, the new key
 * simply reads as "no history" instead of mis-parsing an older payload.
 */
export const RECENT_SEARCHES_STORAGE_KEY = 'commise.recipes.recentSearches.v1';

/**
 * The persistence port the recent-search history is read/written through — an injectable seam, so nothing
 * in the shared layer or in a test touches a real platform global.
 *
 * Async in both directions because native storage is (web `localStorage` is synchronous, which the promise
 * subsumes). Implementations MUST NOT reject: a history that cannot be read or written is a missing
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
 * Record a query that actually ran, at the front of the history.
 *
 * @param existing - The current history, newest-first.
 * @param query - The query that ran; blank/whitespace-only is ignored.
 * @returns The updated history — or `existing` ITSELF (same reference) when there is nothing to record, so
 *   callers can treat an unchanged reference as "no write needed".
 */
export function addRecentSearch(existing: readonly string[], query: string): readonly string[] {
    return query.trim().length === 0 ? existing : mergeRecentSearches([query], existing);
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
