/**
 * The per-minute request budget each rate-limit category allows when its `RATE_LIMIT_*` env var is unset.
 *
 * ⛔ THE ONE AUTHORITATIVE REPRESENTATION. `config/config.types.ts` reads it for each zod field's
 * `.default(...)` and `throttle.config.ts` reads it for each `throttleLimitFromEnv` fallback. Both used to
 * carry their own copy of every number with nothing comparing them;
 * `__tests__/throttleDefaults.test.ts` now asserts set equality across the whole record, in both
 * directions, so a category added to one layer and not the other cannot pass.
 *
 * ## Where these numbers come from
 *
 * ⚠️ THE PREVIOUS SET CAME FROM NOWHERE. `git log -S` traces read 120 / write 30 / photo 10 / search 60 to
 * `c0a43800 feat(001): Phase 1 scaffolding` — placeholders written during initial project setup and never
 * revisited against a real flow. One of them was actively broken (see PHOTO_UPLOAD). Each number below is
 * derived from the peak a legitimate caller can reach, times headroom, and the derivation is stated so the
 * next person is not left guessing the way this audit was.
 *
 * A per-user limit does NOT cap the service's throughput: with N active users the aggregate budget is N
 * times these figures. What it bounds is the blast radius of ONE caller — a runaway retry loop, a scraper,
 * a stuck client. So the right shape is a number far above any legitimate peak and far below abuse, and
 * when in doubt the generous side is correct: the cost of being too tight is a blocked customer, the cost
 * of being loose-but-bounded is nearly nothing.
 */
export const RATE_LIMIT_DEFAULTS = {
    /**
     * Reads — list/detail/versions/candidates/status, the Home widget's fan-out.
     *
     * No flow was measured breaching the old 120, but the per-screen fan-out was not measured either, so
     * this is raised proportionally rather than left as the tightest unexamined guess in the set.
     */
    RATE_LIMIT_READ: 600,

    /**
     * Writes — create/update/delete/clone/visibility, ratings, collections, ingredients, parse jobs.
     *
     * Observed legitimate peak is under 10/min: auto-save is a five-minute INTERVAL (~0.2/min, see
     * `useRecipeAutoSave`), and manual editing is single digits. 300 is 30x that headroom while still
     * stopping a runaway loop within seconds. The old 30 broke nothing measurable, but ~6x a plausible
     * human peak is a thin margin for a control whose false positive blocks a paying customer's work.
     */
    RATE_LIMIT_WRITE: 300,

    /**
     * Search — recipe search plus ingredient suggest/live.
     *
     * The client debounces at 250ms (`DISCOVERY_SEARCH_DEBOUNCE_MS`), so a burst-typed query costs roughly
     * ten requests rather than one per keystroke. 120 covers a dozen searches a minute; the old 60 was
     * about five, which a determined searcher could reach.
     */
    RATE_LIMIT_SEARCH: 120,

    /**
     * Photo upload — presign + confirm, BOTH on this budget, so every photo costs TWO.
     *
     * ⛔ THE OLD VALUE OF 10 WAS A REAL DEFECT, not a tight guess. `MAX_RECIPE_PHOTOS` is 10 and the web
     * UI offers multi-select, so a cook filling a recipe to the capacity the product itself advertises
     * issues 20 requests — it was impossible to complete in under two minutes, and the throttle landed
     * exactly halfway. 60 fits three full recipes per minute. Asserted against `MAX_RECIPE_PHOTOS` by this
     * module's test, so shrinking it below the product's own cap fails the build.
     */
    RATE_LIMIT_PHOTO_UPLOAD: 60,

    /**
     * GDPR data export. Genuinely rare and genuinely expensive; a human needs one, not sixty. Unchanged.
     */
    RATE_LIMIT_EXPORT: 10,

    /**
     * Analytics ingest. Unchanged: the client batches `MAX_EVENTS_PER_BATCH` (8) events per POST, so 60
     * POSTs a minute already carries 480 events.
     */
    RATE_LIMIT_ANALYTICS: 60,
} as const;
