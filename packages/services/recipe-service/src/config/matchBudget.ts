/**
 * The time budget of the paste matcher's request (ADR-0071), in one place both the matcher and the env schema read.
 *
 * It is a pure module with no imports, so `config.types.ts` can derive a ceiling from it without importing the recipes
 * domain, and the matcher can import it without importing the config schema.
 * `parseJobMatchesBudget.test.ts` asserts the whole request against the recipe client's own timeout.
 */

/** The deadline the matcher keeps, from its first statement; every one of its legs ends with it. */
export const MATCH_PROPOSE_DEADLINE_MS = 3_500;

/** Time kept back from the matcher's deadline, after the last wave, for the refs read, the saves, the claim and the send. */
export const MATCH_TAIL_MS = 1_500;

/** The most a release of a failed send's claim is waited for once the deadline has passed; the write still finishes. */
export const MATCH_RELEASE_WAIT_MS = 250;

/** When the job view's reads must end, measured from the start of the request. */
export const MATCH_REQUEST_DEADLINE_MS = 7_000;

/** What the response needs beyond its bounded parts: serialization and the round trip. */
export const MATCH_RESPONSE_MARGIN_MS = 1_000;

/** The catalog searches one food can cost at most: the lexical pass and its one synonym reformulation. */
export const MATCH_SEARCHES_PER_FOOD = 2;

/**
 * The least time the first wave may start within, after the job and match reads that come before it. Below this a call
 * would match nothing in practice.
 */
export const MATCH_MIN_START_WINDOW_MS = 500;

/**
 * How long after the matcher began a wave may still start, given the catalog's per-search timeout: its searches, at
 * that timeout, must end before the tail. Pure.
 *
 * @param searchTimeoutMs - The catalog's per-search transport timeout.
 * @returns Milliseconds; zero or less means no wave can ever start.
 */
export function matchStartWindowMs(searchTimeoutMs: number): number {
    return MATCH_PROPOSE_DEADLINE_MS - MATCH_TAIL_MS - MATCH_SEARCHES_PER_FOOD * searchTimeoutMs;
}

/**
 * The most `FOOD_CATALOG_TYPEAHEAD_TIMEOUT_MS` may be, derived so the matcher keeps a start window of at least
 * {@link MATCH_MIN_START_WINDOW_MS}. Above it a paste would silently match nothing.
 */
export const MAX_MATCH_SEARCH_TIMEOUT_MS = Math.floor(
    (MATCH_PROPOSE_DEADLINE_MS - MATCH_TAIL_MS - MATCH_MIN_START_WINDOW_MS) / MATCH_SEARCHES_PER_FOOD,
);
