/**
 * The time budget of `POST /api/v1/recipe-parse-jobs/{id}/matches` (ADR-0071), asserted against the recipe client's own
 * per-attempt timeout, the way `loadConfig.test.ts` asserts the read and post-commit budgets.
 *
 * The request runs in three parts, and the worst case is the larger of the first two chains plus the response's margin:
 *
 *  1. The matcher, under `MATCH_PROPOSE_DEADLINE_MS`. Every leg ends with it: catalog searches and the refs read and
 *     the send take the deadline as an abort signal, and every database call is awaited through `boundedBy`, so a pool
 *     wait ends at the deadline too. The one thing allowed past it is the release of a failed send's claim, which waits
 *     at most `MATCH_RELEASE_WAIT_MS`.
 *  2. The controller's own job read, which must have an answer and so cannot be abandoned. It may wait for a pool
 *     connection, as every read does: `READ_RESPONSE_HEADROOM_MS`, the pool's 5 s connection timeout. This is the ONE
 *     unbounded-by-deadline pool wait the request accepts, the read path's own posture.
 *  3. The job view, whose reads end at `MATCH_REQUEST_DEADLINE_MS` after the request began (a signal), or not at all when
 *     that has passed. It degrades to "no matches shown", which the client's next poll repairs.
 *
 * On top of the worse of those, `MATCH_RESPONSE_MARGIN_MS` covers serialization and the network round trip.
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

/** The slowest the request can answer, before the response's margin. */
const WORST_CASE_MS = Math.max(
    MATCH_PROPOSE_DEADLINE_MS + MATCH_RELEASE_WAIT_MS + READ_RESPONSE_HEADROOM_MS,
    MATCH_REQUEST_DEADLINE_MS,
);

describe('the matches request fits inside the recipe client’s timeout', () => {
    it('⛔ keeps the worst case plus the named margin STRICTLY inside the client’s 10 s', () => {
        expect(WORST_CASE_MS + MATCH_RESPONSE_MARGIN_MS).toBeLessThan(DEFAULT_REQUEST_TIMEOUT_MS);
    });

    it('leaves real spare time beyond that margin', () => {
        expect(DEFAULT_REQUEST_TIMEOUT_MS - (WORST_CASE_MS + MATCH_RESPONSE_MARGIN_MS)).toBeGreaterThanOrEqual(250);
    });

    it('ends the matcher before the view’s reads must end', () => {
        expect(MATCH_PROPOSE_DEADLINE_MS).toBeLessThan(MATCH_REQUEST_DEADLINE_MS);
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
