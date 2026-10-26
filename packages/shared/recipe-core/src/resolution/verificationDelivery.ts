/**
 * HOW THE VERIFICATION QUEUE DELIVERS ONE REQUEST — one authority for two deployables (ADR-0071).
 *
 * `recipe-workers`' stack builds the verification queue's visibility timeout and its `maxReceiveCount` from these
 * numbers, and recipe-service's paste matcher reads {@link verificationDeliveryBoundSeconds} to decide when a request it
 * CLAIMED and sent, which left no verdict and no attempt behind, was lost. Only after the queue itself would have
 * parked the message may a second request be sent, or one line is paid for twice. Both sides import this module, so
 * a change moves the queue and the reading of it in one commit (the `PARSE_LINE_DELIVERY` precedent).
 *
 * ⚠️ `maxReceiveCount` is the stack's own derivation (`receivesBeforeParking`: ride out a nine-hour database outage,
 * plus one) stated as its value; `RecipeWorkersStack.test.ts` asserts the two still agree.
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

/** The verification queue's delivery timing. */
export const VERIFICATION_DELIVERY: VerificationDelivery = Object.freeze({
    visibilityTimeoutSeconds: 90,
    maxReceiveCount: 361,
});

/**
 * The longest one request can stay in flight: every receive the queue may spend, each a full visibility timeout.
 *
 * @returns Seconds. Pure.
 */
export function verificationDeliveryBoundSeconds(): number {
    return VERIFICATION_DELIVERY.visibilityTimeoutSeconds * VERIFICATION_DELIVERY.maxReceiveCount;
}
