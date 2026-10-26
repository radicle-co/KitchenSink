/**
 * The relations `VERIFICATION_DELIVERY` must hold (ADR-0071).
 *
 * `recipe-workers`' stack builds the verification queue from these numbers, and recipe-service's paste matcher reads
 * {@link verificationDeliveryBoundSeconds} to decide when a claimed request that left no trace was lost: only once the
 * queue itself has given up on it may a second request be sent, or one line is paid for twice.
 */
import { describe, expect, it } from 'vitest';

import { VERIFICATION_DELIVERY, verificationDeliveryBoundSeconds } from '../verificationDelivery.js';

describe('VERIFICATION_DELIVERY', () => {
    it('is the queue the stack ships today: a 90 s visibility timeout and 361 receives', () => {
        expect(VERIFICATION_DELIVERY).toStrictEqual({ visibilityTimeoutSeconds: 90, maxReceiveCount: 361 });
    });

    it('bounds a delivery at every receive the queue may spend, each a full visibility timeout', () => {
        expect(verificationDeliveryBoundSeconds()).toBe(90 * 361);
    });

    it('cannot be changed at run time', () => {
        expect(Object.isFrozen(VERIFICATION_DELIVERY)).toBe(true);
    });
});
