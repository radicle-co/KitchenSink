/**
 * The worker lease window, DERIVED from what one claim may legitimately spend at a source (U5/R16).
 *
 * ⛔ FR-018 fixed the lease at **30 seconds**, and that number was wrong in a way nothing could see. One
 * food's fan-out may issue a name search, a batch chunk, and — when the chunk fails adapter validation
 * as a whole — one recovery request PER KEY, each with a ten-second client timeout
 * ({@link USDA_REQUEST_TIMEOUT_MS}). Twenty-two requests that each hang for ten seconds is the ordinary
 * slow path, not a pathological one, and it outlives a 30-second lease seven times over. The reaper then
 * reverts the row mid-work, a second claim loop takes it, and USDA is asked for the same food twice while
 * the first loop is still running — the duplicate R16 forbids.
 *
 * So the floor is COMPUTED from the same facts `foodConsumer.service.ts` is built from rather than
 * asserted as a literal. {@link worstCaseClaimSeconds} is pure; {@link FOOD_LEASE_FLOOR_SECONDS} applies
 * it to the wired configuration and is the default of `FOOD_LEASE_TIMEOUT_SECONDS`.
 *
 * ⚠️ The derivation is a FLOOR, not a guarantee, and the difference is stated rather than hidden. It
 * bounds the number of REQUESTS a claim may issue; it cannot bound a food whose backing crosswalk set has
 * grown past {@link PRODUCTION_BUDGET}'s `backingItemsPerAdapter` (nothing prunes `food_sources`, so a food
 * re-resolved under several different names accumulates rows). Such a claim is reaped mid-refresh — but
 * since U5 the reap is SAFE rather than corrupting: the stale claim's settle is refused by its lease
 * fence, the row returns to `pending`, and the `FoodLeaseLost` metric makes the over-run visible. Losing
 * a lease is wasted work with a signal on it, never a duplicate result.
 *
 * ⛔ NOTHING IN `src/**` IMPORTS THIS, BY DESIGN — do not "clean it up". It is a SPECIFICATION module: the
 * number it derives reaches production as `FOOD_LEASE_TIMEOUT_SECONDS`'s literal default in
 * `config/env.schema.ts`, which deliberately does not import it (see below), and as the stack's own copy of
 * the same figure. Its consumers are the two suites that BIND those literals to it —
 * `config/__tests__/env.schema.test.ts` and `__tests__/leaseWindow.test.ts`.
 *
 * A zero-importer export is what `knip` reports as dead code, and the failure path is specific: deleting
 * this module forces deleting the import in the env-schema suite, and deleting THAT import is what makes
 * the suite compile again — leaving `250` a bare unbound literal with the derivation gone. That is the
 * "edit a test just enough to COMPILE" outcome `CLAUDE.md` calls the worst available.
 *
 * ⚠️ Why the schema does not import it, stated as the real reason rather than the one first written down:
 * it is DEPENDENCY DIRECTION. `src/config/` is the most stable module in the service — every DAO and
 * composition root reads it — while `@kitchensink/usda-client` is a volatile external adapter, and config
 * depending on an adapter inverts that gradient. (The source-agnostic rule the schema states is about its
 * output KEYS, which `env.schema.test.ts` asserts over `Object.keys(env)`; that rule alone would not
 * forbid the import.)
 *
 * @implements FR-018
 */
import { USDA_MAX_BATCH_SIZE, USDA_REQUEST_TIMEOUT_MS, USDA_SEARCH_PAGE_SIZE } from '@kitchensink/usda-client';

/** The four facts that bound how many source requests ONE claim may issue, and how long each may hang. */
export interface ClaimBudget {
    /** Wired source adapters. The fan-out walks them SEQUENTIALLY, so their costs add. */
    readonly adapters: number;
    /** Keys one name search may yield — the recovery fan-out's width (`fetchCandidates`). */
    readonly keysPerSearch: number;
    /** Keys per batch request — how many chunks those keys are pulled in (`batchFetch`). */
    readonly batchSize: number;
    /**
     * Backing crosswalk rows a RESOLVED food may hold PER ADAPTER — the change-refresh leg's width.
     *
     * ⚠️ Per adapter, not a total, and the name says so because nothing else could: at `adapters: 1` the
     * two readings give the same answer, so a contract that meant one and computed the other would be
     * indistinguishable until the day a second source was wired.
     */
    readonly backingItemsPerAdapter: number;
    /** Per-request client timeout: the longest a single source call may hang before it aborts. */
    readonly requestTimeoutMs: number;
}

/**
 * Seconds allowed BEYOND the source calls for the work either leg does around them — the merge/persist
 * transaction, the completion event, and the settle itself. Deliberately generous relative to the
 * millisecond-scale database work it covers: the cost of an over-long lease is recovery latency after a
 * hard kill, and the cost of a short one is the duplicate this module exists to prevent.
 */
export const SETTLE_ALLOWANCE_SECONDS = 30;

/**
 * The wired configuration: one adapter (USDA), whose page size, batch cap and request timeout are
 * imported from the client that enforces them rather than restated here.
 */
export const PRODUCTION_BUDGET: ClaimBudget = {
    // ⛔ THE MULTIPLIER, and the one term that cannot be imported from the thing that enforces it: the
    // adapter count lives in `createUsdaSourceRegistry`, a composition root that reads `process.env`, and
    // a pure derivation module must not depend on one. So it is stated here and BOUND by
    // `leaseWindow.test.ts`, which counts the registry's own registrations. Wire a second source without
    // that binding and the derived floor is half the real worst case — the silent shortening this whole
    // module exists to prevent, one term over, with nothing going red.
    adapters: 1,
    keysPerSearch: USDA_SEARCH_PAGE_SIZE,
    batchSize: USDA_MAX_BATCH_SIZE,
    // A RESOLVED food's crosswalks come from the survivor group of one fan-out, so it can hold at most
    // one per key that search returned, per adapter (`mergeEngine.blendCandidates`).
    backingItemsPerAdapter: USDA_SEARCH_PAGE_SIZE,
    requestTimeoutMs: USDA_REQUEST_TIMEOUT_MS,
};

/**
 * The longest one claim may legitimately hold its row, in seconds.
 *
 * A claim takes ONE of two shapes, so the answer is the larger of the two, never their sum:
 *
 * - **fan-out** (a new food, `fanOut` → `batchFetch`): per adapter, one name search, one request per
 *   batch chunk, and — on a chunk that fails validation as a whole — one recovery request per key.
 * - **change-refresh** (a RESOLVED food, `refreshResolvedFood`): per adapter, one re-fetch per backing
 *   crosswalk row, which is driven by a DIFFERENT number than the fan-out's. Deriving from the fan-out
 *   alone would leave this leg uncovered the moment a food accumulated more backing items than a fan-out
 *   issues requests.
 *
 * @param budget - The request-count and timeout facts to derive from.
 * @returns Whole seconds of source calls in the worst case.
 */
export function worstCaseClaimSeconds(budget: ClaimBudget): number {
    const chunks = Math.ceil(budget.keysPerSearch / budget.batchSize);
    const fanOutRequests = 1 + chunks + budget.keysPerSearch;
    const refreshRequests = budget.backingItemsPerAdapter;
    const requests = budget.adapters * Math.max(fanOutRequests, refreshRequests);

    return Math.ceil((requests * budget.requestTimeoutMs) / 1_000);
}

/**
 * The lease window the worker ships with: every source call one claim may make, plus the allowance for
 * the work around them. This is the DEFAULT of `FOOD_LEASE_TIMEOUT_SECONDS` — an operator may still
 * raise it, and `leaseWindowCoversTheWork` in the env-schema suite is what refuses a lower one silently
 * reintroducing the 30-second defect.
 */
export const FOOD_LEASE_FLOOR_SECONDS = worstCaseClaimSeconds(PRODUCTION_BUDGET) + SETTLE_ALLOWANCE_SECONDS;
