/**
 * Unit tests for the lease-fence primitives (U5/R16).
 *
 * The fence's real behaviour is SQL and is proved against Postgres in
 * `tests/fetchQueue.dao.integration.test.ts` — a unit test cannot observe whether a `WHERE` clause matched.
 * What lives here is the part that is ordinary code and has its own failure mode: the custom-error
 * convention. `isLeaseLostError` is what every settle site branches on, and an `instanceof` that stops
 * working is the failure that turns a contained refusal back into an exception escaping `drain` and
 * aborting every sibling claim loop — silently, because the code still compiles and the happy path is
 * unaffected.
 */
import { describe, expect, it } from 'vitest';

import { isLeaseLostError, LeaseLostError, leaseFenceFrom } from '../leaseFence.js';

describe('LeaseLostError', () => {
    it('carries the food and the settle that was refused, so a log line names both', () => {
        const error = new LeaseLostError('01JFOOD000000000000000000', 'tombstone');

        expect(error.foodId).toBe('01JFOOD000000000000000000');
        expect(error.operation).toBe('tombstone');
        expect(error.name).toBe('LeaseLostError');
        expect(error.message).toContain('01JFOOD000000000000000000');
        expect(error.message).toContain('tombstone');
    });

    /**
     * `isLeaseLostError` is the ONLY thing every settle site branches on: a guard that answered `false` for
     * a real refusal would let `processNext` rethrow it, reject `drain`'s `Promise.all`, and stop the whole
     * drain over one lost lease.
     *
     * ⚠️ Stated precisely, because the obvious claim is not true here: deleting the constructor's
     * `Object.setPrototypeOf` does NOT red this case — checked, and it still passed. Under this package's
     * target, `extends Error` keeps the prototype chain on its own; that call is the house convention
     * (`docs/CODING_STANDARDS.md`) and insurance against a downlevel target, not what makes this pass
     * today. What this case does prove is that the guard the branches use agrees with the type they
     * believe they are catching, in both directions — see the negative cases below.
     */
    it('⛔ survives instanceof, which is the ONLY thing every settle site branches on', () => {
        const error = new LeaseLostError('food', 'resolve');

        expect(error).toBeInstanceOf(LeaseLostError);
        expect(error).toBeInstanceOf(Error);
        expect(isLeaseLostError(error)).toBe(true);
    });

    it('does not claim anything else as a lost lease', () => {
        expect(isLeaseLostError(new Error('lease lost for food x: resolve refused'))).toBe(false);
        expect(isLeaseLostError(new TypeError('boom'))).toBe(false);
        expect(isLeaseLostError('lease lost')).toBe(false);
        expect(isLeaseLostError(undefined)).toBe(false);
    });
});

describe('leaseFenceFrom', () => {
    /**
     * ⚠️ It brands, and that is ALL it may do. The stamp goes into the settle statement verbatim, so any
     * normalisation here — trimming, re-parsing, rendering through a `Date` — truncates Postgres's
     * microseconds to milliseconds and the fence stops matching the row it came from. Measured: a `Date`
     * parameter matched 0 rows where the `::text` rendering matched 1.
     */
    it('⛔ returns the stamp BYTE-FOR-BYTE — a fence is a token, never a time', () => {
        const stamp = '2026-09-16 02:00:18.936103+00';

        expect(leaseFenceFrom(stamp)).toBe(stamp);
        expect(String(leaseFenceFrom(stamp))).toHaveLength(stamp.length);
    });
});
