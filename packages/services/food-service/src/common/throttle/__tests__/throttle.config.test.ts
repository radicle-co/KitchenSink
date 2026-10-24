/**
 * The arithmetic behind the per-requester source budget (plan 002, the cap owed before S6), held as tests so the
 * number the owner confirms cannot drift away from the reasons it was chosen for.
 *
 * Every cook and the worker share one window per source: ⌊0.9 × declared limit⌋ calls (`sourceCeiling.ts`), 900 an hour
 * for USDA. The budget's window is fixed from a requester's first charge, so across a window boundary one requester
 * can spend twice the budget inside one trailing source window. That doubled figure is what must stay below the
 * shared ceiling.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';

import { MAX_RESOLVE_CANDIDATE_IDS } from '../../../foods/foods.schema.js';
import { WIRED_SOURCE_IDS } from '../../../sources/foodSourceAdapter.js';
import { apiAccessOf } from '../../../sources/sourceRegister.js';
import { sourceCeiling } from '../../../sources/transport/sourceCeiling.js';
import { REQUESTER_SOURCE_BUDGET_PER_HOUR, REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS } from '../throttle.config.js';

describe('the per-requester source budget', () => {
    it('admits the largest single resolve on a fresh window', () => {
        expect(REQUESTER_SOURCE_BUDGET_PER_HOUR).toBeGreaterThanOrEqual(MAX_RESOLVE_CANDIDATE_IDS);
    });

    it.each(WIRED_SOURCE_IDS)('counts over the same window %s declares, so the two figures compare', (source) => {
        expect(REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS).toBe(apiAccessOf(source).rateLimit.windowSeconds);
    });

    it.each(WIRED_SOURCE_IDS)(
        'leaves one requester unable to fill the shared %s window, even across a boundary',
        (source) => {
            expect(2 * REQUESTER_SOURCE_BUDGET_PER_HOUR).toBeLessThan(
                sourceCeiling(apiAccessOf(source).rateLimit.requests),
            );
        },
    );
});
