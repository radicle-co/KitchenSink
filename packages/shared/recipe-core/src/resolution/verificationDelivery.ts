/**
 * HOW THE VERIFICATION QUEUE DELIVERS ONE REQUEST — one authority for two deployables (ADR-0071).
 *
 * `recipe-workers`' stack builds the verification queue's visibility timeout and its `maxReceiveCount` from these
 * numbers, and recipe-service's paste matcher reads {@link verificationDeliveryBoundSeconds} to decide when a request it
 * CLAIMED and sent, which left no verdict and no attempt behind, was lost. Only after the queue itself would have
 * parked the message may a second request be sent, or one line is paid for twice. Both sides import this module, so
 * a change moves the queue and the reading of it in one commit (the `PARSE_LINE_DELIVERY` precedent).
 *
 * ⚠️ `maxReceiveCount` is DERIVED here by {@link receivesBeforeParking} (ride out a nine-hour database outage, plus one),
 * and the stack builds its queues through the same function, so the outage rule has one home and a change to it moves
 * the queue and the reading of it together.
 *
 * Reachable ONLY as `@kitchensink/recipe-core/resolution/verification-delivery`, never from the barrel.
 *
 * @pattern Shared Kernel — the delivery numbers the worker's infrastructure and the service's lost-request rule share
 */

/** The verification queue's delivery timing. */
export interface VerificationDelivery {
    /** When SQS offers an unfinished message again. Above the worker's 60 s timeout, so a live call is never re-offered. */
    readonly visibilityTimeoutSeconds: number;
    /** Receives the queue spends on one message before it parks it in the dead-letter queue. */
    readonly maxReceiveCount: number;
}

/**
 * How long a queue tuned for a stopped database lets a message survive it before parking the message: a brief outage
 * (a restart, the sandbox stop landing on an in-flight message) must not park healthy work, and the dead-letter depth
 * ADR-0024 layer 4 alarms on should hold work that is really stuck.
 */
export const DATABASE_OUTAGE_BEFORE_PARKING_SECONDS = 9 * 60 * 60;

/**
 * Receives a queue spends on one message before it parks it, given the outage it must ride out.
 *
 * @param outageSeconds - The outage the queue rides out ({@link DATABASE_OUTAGE_BEFORE_PARKING_SECONDS}).
 * @param visibilityTimeoutSeconds - The queue's visibility timeout.
 * @returns The smallest `maxReceiveCount` that covers the outage, with one receive to spare. Pure.
 */
export function receivesBeforeParking(outageSeconds: number, visibilityTimeoutSeconds: number): number {
    return Math.ceil(outageSeconds / visibilityTimeoutSeconds) + 1;
}

const VERIFICATION_VISIBILITY_TIMEOUT_SECONDS = 90;

/** The verification queue's delivery timing. */
export const VERIFICATION_DELIVERY: VerificationDelivery = Object.freeze({
    visibilityTimeoutSeconds: VERIFICATION_VISIBILITY_TIMEOUT_SECONDS,
    maxReceiveCount: receivesBeforeParking(
        DATABASE_OUTAGE_BEFORE_PARKING_SECONDS,
        VERIFICATION_VISIBILITY_TIMEOUT_SECONDS,
    ),
});

/**
 * The longest one request can stay in flight: every receive the queue may spend, each a full visibility timeout.
 *
 * @returns Seconds. Pure.
 */
export function verificationDeliveryBoundSeconds(): number {
    return VERIFICATION_DELIVERY.visibilityTimeoutSeconds * VERIFICATION_DELIVERY.maxReceiveCount;
}
