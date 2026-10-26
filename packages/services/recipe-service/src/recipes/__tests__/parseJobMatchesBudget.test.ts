/**
 * The time budget of `POST /api/v1/recipe-parse-jobs/{id}/matches` (ADR-0071), asserted against the recipe client's own
 * per-attempt timeout, the way `loadConfig.test.ts` asserts the read and post-commit budgets.
 *
 * Before the handler runs, every request passes the global `ErasureLockGuard`, which reads the database. It may wait for a
 * pool connection, at most the pool's 5 s connection timeout: `READ_RESPONSE_HEADROOM_MS`, the read path's own posture.
 * It is the ONE wait this request does not bound, because it happens before the request's clock starts.
 *
 * From the handler on, EVERY leg is bounded by a deadline and none can wait on a pool without it:
 *
 *  1. The matcher, under `MATCH_PROPOSE_DEADLINE_MS`. Catalog searches, the refs read and the send take the deadline as
 *     an abort signal; every database call is awaited through `boundedBy`, so a pool wait ends at the deadline too. The
 *     one thing allowed past it is the release of a failed send's claim, which waits at most `MATCH_RELEASE_WAIT_MS`.
 *  2. The controller's own fresh job read and the job view's reads, which end at `MATCH_REQUEST_DEADLINE_MS` after the
 *     handler began (a signal). The job read falls back to the record the matcher already read; the view degrades to "no
 *     match shown", which the client's next poll repairs.
 *
 * So the handler answers within the larger of the two. On top of the guard's wait and that, `MATCH_RESPONSE_MARGIN_MS`
 * covers serialization and the network round trip.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_REQUEST_TIMEOUT_MS } from '@kitchensink/recipe-service-client';

import { READ_RESPONSE_HEADROOM_MS } from '../../config/config.types.js';
import {
    MATCH_MIN_START_WINDOW_MS,
    MATCH_PROPOSE_DEADLINE_MS,
    MATCH_RELEASE_WAIT_MS,
    MATCH_REQUEST_DEADLINE_MS,
    MATCH_RESPONSE_MARGIN_MS,
    MATCH_SEARCHES_PER_FOOD,
    MATCH_TAIL_MS,
    MAX_MATCH_SEARCH_TIMEOUT_MS,
    matchStartWindowMs,
} from '../../config/matchBudget.js';

/** What the shipped default of `FOOD_CATALOG_TYPEAHEAD_TIMEOUT_MS` is (`IngredientsModule`). */
const DEFAULT_SEARCH_TIMEOUT_MS = 600;

/** The slowest the handler can answer once it starts: every leg is bounded, so it is the larger of the two chains. */
const HANDLER_WORST_CASE_MS = Math.max(MATCH_PROPOSE_DEADLINE_MS + MATCH_RELEASE_WAIT_MS, MATCH_REQUEST_DEADLINE_MS);

/** The slowest the request can answer, before the response's margin: the guard's one pool wait, then the handler. */
const WORST_CASE_MS = READ_RESPONSE_HEADROOM_MS + HANDLER_WORST_CASE_MS;

describe('the matches request fits inside the recipe client’s timeout', () => {
    it('⛔ keeps the worst case plus the named margin STRICTLY inside the client’s 10 s', () => {
        expect(WORST_CASE_MS + MATCH_RESPONSE_MARGIN_MS).toBeLessThan(DEFAULT_REQUEST_TIMEOUT_MS);
    });

    it('leaves real spare time beyond that margin', () => {
        expect(DEFAULT_REQUEST_TIMEOUT_MS - (WORST_CASE_MS + MATCH_RESPONSE_MARGIN_MS)).toBeGreaterThanOrEqual(250);
    });

    it('⛔ leaves the job view real time after the matcher’s deadline and its release cap', () => {
        // Else a call that spends its whole matching budget would always answer with every match unread.
        expect(MATCH_REQUEST_DEADLINE_MS - (MATCH_PROPOSE_DEADLINE_MS + MATCH_RELEASE_WAIT_MS)).toBeGreaterThanOrEqual(
            400,
        );
    });
});

describe('the matcher can always start a wave', () => {
    it('⛔ derives the ceiling on the search timeout from the deadline, the tail and the searches per food', () => {
        expect(
            MATCH_PROPOSE_DEADLINE_MS - MATCH_TAIL_MS - MATCH_SEARCHES_PER_FOOD * MAX_MATCH_SEARCH_TIMEOUT_MS,
        ).toBeGreaterThanOrEqual(MATCH_MIN_START_WINDOW_MS);
        // One millisecond more and the window would be under the minimum: the ceiling is tight, not a round number.
        expect(matchStartWindowMs(MAX_MATCH_SEARCH_TIMEOUT_MS + 1)).toBeLessThan(MATCH_MIN_START_WINDOW_MS);
    });

    it('⛔ leaves a start window at the shipped default search timeout', () => {
        expect(matchStartWindowMs(DEFAULT_SEARCH_TIMEOUT_MS)).toBeGreaterThanOrEqual(MATCH_MIN_START_WINDOW_MS);
    });
});
