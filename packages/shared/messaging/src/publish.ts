/**
 * The `publish` PORT — the seam every producer depends on, with no storage technology visible through it
 * (R1.1, R1.4, R1.9; plan U4).
 *
 * ## The contract, and why each half of it is load-bearing
 *
 * **Fire-and-forget.** `publish` resolves without awaiting any consumer, and an adapter that throws does not
 * propagate. A progress message is a side channel: a food resolution that succeeded must not be reported as
 * failed because the message store was briefly unavailable. The failure is handed to `onError` so it is
 * observable, and swallowing it without that sink would be the actual defect.
 *
 * **Validated at the boundary, inside the port.** `publish` parses before handing to the adapter, so every
 * producer gets the same guarantee whether or not it remembered to ask for one. See `OutboundMessage.ts`
 * for why a producer cannot be trusted to notice its own malformed message.
 *
 * ## What must NOT leak through this port
 *
 * ⛔ **Producer-specific policy.** `FoodEventEmitter` publishes `FetchFailed` only on a `FAILED` tombstone
 * and never on `NOT_FOUND` (DSN-9). That rule is food's, it is the reason food's alarms are not permanently
 * lit, and it stays in the food emitter. A port that grew a "should this be published?" hook would be
 * inviting every producer to move its policy into shared code where no producer's tests cover it.
 *
 * ⛔ **Storage vocabulary.** No table name, no partition key, no SDK type. Swapping the adapter must require
 * no producer change — that is the property this port exists to hold, and the one a `tableName` parameter
 * would quietly destroy.
 *
 * Follows the `cdnInvalidation.ts` precedent: the contract is shared, the adapters stay local to each
 * runtime. Ports & Adapters, with `InMemoryPublisher`/`ConsolePublisher` as the in-repo adapters and the
 * DynamoDB one arriving with plan U6.
 *
 * @module
 */

import { parseOutboundMessage, type OutboundMessage } from './OutboundMessage.js';

/**
 * A storage adapter the port publishes through. One method, so a new backend is one class.
 *
 * Implementations MAY throw: {@link publish} contains the failure. They must not, however, block on a
 * consumer — the substrate is a store, not a queue with a waiting reader.
 */
export interface MessagePublisher {
    /**
     * Write one message to the backing store.
     *
     * @param message - The already-validated message.
     * @sideEffect Persists the message (or captures/logs it, for the in-repo adapters).
     */
    send(message: OutboundMessage): Promise<void>;
}

/** Optional collaborators for {@link publish}. */
export interface PublishOptions {
    /**
     * Where a swallowed adapter failure is reported.
     *
     * Not optional in spirit — a producer that passes nothing here has chosen for the failure to be
     * invisible. It is typed optional only because the in-repo adapters cannot fail.
     */
    readonly onError?: (error: unknown, message: OutboundMessage) => void;
}

/**
 * Publish one message, fire-and-forget. Validates, then delegates to the adapter, then contains any failure.
 *
 * @param publisher - The storage adapter.
 * @param message - The message to publish; parsed before it reaches the adapter.
 * @param options - Optional error sink.
 * @throws {import('zod').ZodError} When the MESSAGE is malformed — a caller bug, surfaced at the call site.
 *   An adapter failure is NOT thrown; it goes to `onError`.
 * @sideEffect Delegates to the adapter, which persists (or captures) the message.
 */
export async function publish(
    publisher: MessagePublisher,
    message: OutboundMessage,
    options?: PublishOptions,
): Promise<void> {
    // Parse FIRST, and outside the try: a malformed message is the caller's bug and must be loud, while an
    // adapter failure is an infrastructure event and must not be. Collapsing both into one catch would make
    // a typo'd field indistinguishable from DynamoDB being down.
    const parsed = parseOutboundMessage(message);

    try {
        await publisher.send(parsed);
    } catch (error) {
        options?.onError?.(error, parsed);
    }
}
