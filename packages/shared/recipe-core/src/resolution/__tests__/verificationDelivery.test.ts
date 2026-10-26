/**
 * The relations `VERIFICATION_DELIVERY` must hold (ADR-0071).
 *
 * `recipe-workers`' stack builds the verification queue from these numbers, and recipe-service's paste matcher reads
 * {@link verificationDeliveryBoundSeconds} to decide when a claimed request that left no trace was lost: only once the
 * queue itself has given up on it may a second request be sent, or one line is paid for twice.
 */
import { describe, expect, it } from 'vitest';

import {
    DATABASE_OUTAGE_BEFORE_PARKING_SECONDS,
    receivesBeforeParking,
    VERIFICATION_DELIVERY,
    verificationDeliveryBoundSeconds,
} from '../verificationDelivery.js';

describe('VERIFICATION_DELIVERY', () => {
    it('is the queue the stack ships today: a 90 s visibility timeout and 361 receives', () => {
        expect(VERIFICATION_DELIVERY).toStrictEqual({ visibilityTimeoutSeconds: 90, maxReceiveCount: 361 });
    });

    it('bounds a delivery at every receive the queue may spend, each a full visibility timeout', () => {
        expect(verificationDeliveryBoundSeconds()).toBe(90 * 361);
    });

    it('⛔ derives the receive count from the outage rule, so the two cannot drift apart', () => {
        expect(VERIFICATION_DELIVERY.maxReceiveCount).toBe(
            receivesBeforeParking(
                DATABASE_OUTAGE_BEFORE_PARKING_SECONDS,
                VERIFICATION_DELIVERY.visibilityTimeoutSeconds,
            ),
        );
    });

    it('cannot be changed at run time', () => {
        expect(Object.isFrozen(VERIFICATION_DELIVERY)).toBe(true);
    });
});

describe('receivesBeforeParking — ride out a database outage, with one receive to spare', () => {
    it.each([
        [9 * 3600, 90, 361],
        [9 * 3600, 120, 271],
        [3600, 90, 41],
        [100, 30, 5],
    ])('an outage of %i s at a %i s visibility timeout spends %i receives', (outage, visibility, receives) => {
        expect(receivesBeforeParking(outage, visibility)).toBe(receives);
    });

    it('rounds a partial receive UP, never down: the outage is always covered', () => {
        expect(receivesBeforeParking(101, 100)).toBe(3);
    });

    it('states the outage the queues ride out as nine hours', () => {
        expect(DATABASE_OUTAGE_BEFORE_PARKING_SECONDS).toBe(9 * 3600);
    });
});
