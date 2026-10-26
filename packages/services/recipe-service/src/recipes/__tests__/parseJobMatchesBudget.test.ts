/**
 * The time budget of `POST /api/v1/recipe-parse-jobs/{id}/matches` (ADR-0071 review, item 13), asserted against the
 * recipe client's own per-attempt timeout, the way `loadConfig.test.ts` asserts the read and post-commit budgets.
 *
 * The request runs two bounded halves: the matcher, under {@link MATCH_PROPOSE_DEADLINE_MS} (its waves start only while
 * they can finish, and its refs read and its send carry the deadline as an abort signal), then the job view's names
 * read, under the read deadline whose ceiling is `MAX_READ_NUTRITION_DEADLINE_MS`. The sum plus a margin for the
 * response's own database reads, serialization and the network must fit inside the client's 10 s, or a call that did its
 * work is reported to the cook as a timeout and retried.
 *
 * ⚠️ What is NOT inside the bound, stated rather than hidden: a database wait on a saturated pool (its connection
 * timeout is 5 s, `READ_RESPONSE_HEADROOM_MS`). The read path accepts the same residual once.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_REQUEST_TIMEOUT_MS } from '@kitchensink/recipe-service-client';

import { MAX_READ_NUTRITION_DEADLINE_MS } from '../../config/config.types.js';
import { MATCH_PROPOSE_DEADLINE_MS } from '../matchProposal.service.js';

/** What the response needs beyond its two bounded halves: its own reads, serialization and the round trip. */
const MATCH_RESPONSE_MARGIN_MS = 1_000;

describe('the matches request fits inside the recipe client’s timeout', () => {
    it('keeps the matcher’s deadline plus the names read’s ceiling, with margin, inside the client’s 10 s', () => {
        expect(MATCH_PROPOSE_DEADLINE_MS + MAX_READ_NUTRITION_DEADLINE_MS + MATCH_RESPONSE_MARGIN_MS).toBeLessThanOrEqual(
            DEFAULT_REQUEST_TIMEOUT_MS,
        );
    });
});
