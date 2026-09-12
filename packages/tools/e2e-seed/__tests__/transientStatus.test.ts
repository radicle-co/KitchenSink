/**
 * The ONE status rule both of this package's service ports retry on: the recipe purge poll (`testReset.ts`) and the
 * food authored-food purge (`resetPool.ts`). Each port keeps its own transport-failure branch and its own client's
 * error guard; what they share is only which HTTP statuses mean "the stage will recover on its own".
 *
 * ⚠️ `408` and `425` are asserted NOT transient on purpose. `shouldRetryRecipeServiceFailure` retries both, and it is
 * the obvious thing to fold in here; doing so would silently widen what a reset retries.
 */
import { describe, expect, it } from 'vitest';

import { isTransientStatus } from '../src/transientStatus.js';

describe('isTransientStatus', () => {
    it.each([429, 500, 502, 503, 504, 599])('treats %i as a stage that recovers on its own', (status) => {
        expect(isTransientStatus(status)).toBe(true);
    });

    it.each([200, 202, 400, 401, 403, 404, 408, 409, 422, 425, 428, 499])('treats %i as final', (status) => {
        expect(isTransientStatus(status)).toBe(false);
    });
});
