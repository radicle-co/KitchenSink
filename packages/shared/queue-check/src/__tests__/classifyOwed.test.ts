/**
 * U11 — the classifier (R28). Pure, over counts.
 *
 * ⛔ "SLOW IS NOT LOST" is the rule under test and the one a human gets wrong under pressure: a backlog of
 * owed rows looks identical whether the queue is draining steadily behind it or nothing is carrying the work
 * at all. Escalating a healthy backlog trains its reader to ignore the signal, which is worse than not
 * having one.
 */
import { describe, expect, it } from 'vitest';

import { classifyOwed, type OwedObservation } from '../classifyOwed.js';

/** Nothing owed, nothing moving — the quiet baseline every case perturbs by one dimension. */
const QUIET: OwedObservation = {
    owedPastDeadline: 0,
    neverReceived: 0,
    atAllowance: 0,
    claimedTooLong: 0,
    transportVisible: 0,
    transportInFlight: 0,
    transportDeadLettered: 0,
};

describe('classifyOwed', () => {
    it('says nothing when nothing is owed', () => {
        expect(classifyOwed(QUIET)).toBeUndefined();
    });

    it('⛔ a row past its deadline with a NON-EMPTY transport is DELAYED, not lost', () => {
        expect(classifyOwed({ ...QUIET, owedPastDeadline: 12, transportVisible: 12 })).toBe('delayed');
    });

    it('⛔ a row NEVER RECEIVED with an EMPTY transport is LOST — nobody is coming', () => {
        expect(classifyOwed({ ...QUIET, owedPastDeadline: 1, neverReceived: 1 })).toBe('lost');
    });

    /**
     * ⚠️ In-flight counts as carrying. A message a consumer is holding right now is the most alive a message
     * can be, and treating only `visible` as movement would report every actively-draining queue as lost.
     */
    it('a never-received row is DELAYED while something is in flight', () => {
        expect(classifyOwed({ ...QUIET, owedPastDeadline: 1, neverReceived: 1, transportInFlight: 1 })).toBe('delayed');
    });

    it('⛔ attempts at the allowance are EXHAUSTED regardless of the transport', () => {
        expect(classifyOwed({ ...QUIET, atAllowance: 3, transportVisible: 500 })).toBe('exhausted');
    });

    it('⛔ a DLQ above zero wins over everything — it is already out of the system', () => {
        expect(classifyOwed({ ...QUIET, atAllowance: 3, claimedTooLong: 2, transportDeadLettered: 1 })).toBe(
            'dead-lettered',
        );
    });

    /**
     * ⚠️ STUCK is distinct from LOST, and the distinction is what an operator does next. Something DID pick
     * this up and stopped; the lease will return it. Saying "lost" would send them looking for a producer
     * bug that is not there.
     */
    it('⛔ a claim outliving any plausible run is STUCK, never lost', () => {
        expect(classifyOwed({ ...QUIET, claimedTooLong: 1, neverReceived: 0 })).toBe('stuck');
    });

    it('exhausted outranks stuck — the consumer gave up by its own rule', () => {
        expect(classifyOwed({ ...QUIET, atAllowance: 1, claimedTooLong: 1 })).toBe('exhausted');
    });
});
