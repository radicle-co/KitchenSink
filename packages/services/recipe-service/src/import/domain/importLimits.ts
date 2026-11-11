/**
 * The bounds of the bulk import's work, in one place (ADR-0072 §2, §7). Pure constants.
 *
 * Every number here is the answer to a question the ADR left to the builder, so each carries its reasoning; `importAdvanceBudget`
 * (the test) holds the request-budget ones against the recipe client's timeout.
 */

/** Items shown when a request names no page size. */
export const IMPORT_DEFAULT_PAGE_SIZE = 100;

/** Imports shown in the list when a request names no page size. */
export const IMPORT_LIST_DEFAULT_PAGE_SIZE = 20;

/** Lines shown in a flagged or to-check page when a request names no page size. */
export const IMPORT_LINES_DEFAULT_PAGE_SIZE = 50;

/**
 * How many flaggable rows one scan of the flagged list reads. A flagged page is filtered in memory (a `clear` line is not
 * listed), so a page may need several scans; this bounds each.
 */
export const IMPORT_FLAGGED_SCAN_SIZE = 100;

/**
 * The most scans one flagged page may make. A page that hits this returns what it has with a `nextAfter`, so a short page is
 * never the end unless `nextAfter` is `null`, and one request never walks a whole library of agreeing lines.
 */
export const IMPORT_FLAGGED_MAX_SCANS = 5;

/**
 * How long a `keepAsWritten` item waits for a line whose review is still in flight before it is saved with that line as
 * written (ADR-0072 §7 left the number to the builder). Twenty seconds: the gate answers a line in a few seconds when it is
 * going to, a client polling every few seconds sees it through, and a gate that has stopped answering costs one wait, after
 * which the line is simply flagged. The review is not wasted: it still lands, and the saved line is judged under its own key.
 */
const IMPORT_CHECKING_WAIT_MS = 20_000;

/**
 * The bounds of ONE `advance` call (ADR-0072 §2: "the batch size is a constant; the builder sizes it so one call fits the
 * request budget"). The counts are CEILINGS: the deadline is the real bound, because a bound-line save costs one by-food
 * admission as the cook per line and that time varies with food.
 */
export interface ImportAdvanceLimits {
    /** The most items paid for and sent for parsing in one call. */
    readonly payBatch: number;
    /**
     * The most parse jobs examined in one call. They share one deadline (`MATCH_PROPOSE_DEADLINE_MS`) and the work is bounded
     * by its waves, so this is generous: a job with no parsed line yet costs one cheap read, and a small number would let a
     * few stuck jobs at the front hold every job behind them.
     */
    readonly matchJobs: number;
    /** The most items saved in one call. */
    readonly saveBatch: number;
    /** The most matched items looked at to find those to save (the others are deferred to the back of the line). */
    readonly saveExamine: number;
    /** The whole call's budget from its first statement, in milliseconds. Strictly inside the client's 10 s. */
    readonly deadlineMs: number;
    /** The time an item's save needs at least, so a save is not started when it cannot finish. */
    readonly saveMinMs: number;
    /** `keepAsWritten`'s wait for a checking line. */
    readonly checkingWaitMs: number;
    /** Milliseconds since the epoch; injected so the budget is tested without wall time. */
    readonly now: () => number;
}

/** Production's bounds. */
export const DEFAULT_IMPORT_ADVANCE_LIMITS: ImportAdvanceLimits = {
    payBatch: 10,
    matchJobs: 25,
    saveBatch: 5,
    saveExamine: 10,
    deadlineMs: 8_000,
    saveMinMs: 1_500,
    checkingWaitMs: IMPORT_CHECKING_WAIT_MS,
    now: () => Date.now(),
};
