/**
 * The deletion queue's PRODUCER contract — what `SqsService.enqueueDeletion` serialises.
 *
 * Lives under `types/` (decorator-free, exported through the package index) rather than beside the NestJS
 * service that sends it, because the CONSUMER — `identity-webhooks`' `deletionQueue.schema.ts` — asserts at
 * the type level that this shape satisfies its zod schema, and importing a `@Injectable()` module into that
 * package's `tsc` program is not possible (its config has no decorator support, by design).
 *
 * This replaced an earlier `UserDeletionQueueMessage` (`requestedAt`/`correlationId`/`reason`/`source`) that
 * was exported here, referenced nowhere, and described a message no producer has ever sent.
 */

/**
 * The lifecycle event a deletion-queue message routes (CR-002):
 * - `closure` — the deletion-worker BANS the Clerk identity (recoverable tombstone).
 * - `reactivation` — the worker UNBANS the Clerk identity (admin-mediated recovery).
 * - `erasure` — the worker deletes the Clerk identity, then fans out the recipe/food erasure legs.
 */
export type DeletionEvent = 'closure' | 'reactivation' | 'erasure';

/** The deletion-queue message contract (extends the legacy `{ identityId, userId, enqueuedAt }` with `event`). */
export interface DeletionQueueMessage {
    /** The Clerk identity id (`sub`) the worker mutates via the Clerk admin SDK. */
    readonly identityId: string;
    /**
     * The app ULID. Correlation on `closure`/`reactivation`; on `erasure` it is the SUBJECT — the fan-out's
     * signed principal and both downstream services' erasure key — and the consumer schema REQUIRES it there.
     */
    readonly userId: string;
    /** The lifecycle transition this message routes. */
    readonly event: DeletionEvent;
    readonly enqueuedAt: string;
    readonly failureReason?: string;
}
