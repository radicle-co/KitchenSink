/**
 * The handle-sync message contract (W8-a.2 / decision 6) — the payload BOTH producer routes (identity's
 * `PATCH /v1/users/me` and the Clerk `user.updated` webhook) publish to the global handle-sync SNS topic,
 * and the recipe-workers consumer applies. Defined once here in `identity-core` (dependency-light) so the
 * producers and the consumer can never disagree on the shape.
 *
 * @module
 */

/** A display-name rename event. `sourceTimestamp` is the SINGLE monotonic clock the consumer orders on. */
export interface HandleSyncMessage {
    /** The app-user ULID whose display name changed. */
    readonly userId: string;
    /** The user's new display name (identity's `profiles.displayName`). */
    readonly displayName: string;
    /**
     * `profiles.updatedAt` written in the SAME transaction as the displayName change (ISO-8601). Both routes
     * MUST use this single clock — never a producer-local `new Date()` — or cross-route skew would let the
     * consumer's monotonic guard wrongly reject a genuinely newer rename.
     */
    readonly sourceTimestamp: string;
}

/**
 * Build a {@link HandleSyncMessage} from a rename. Pure — the caller supplies `sourceTimestamp` from the
 * same transaction as the write (this does not stamp `Date.now()`, deliberately: the clock must be the
 * persisted `profiles.updatedAt`, shared across both producer routes).
 */
export function buildHandleSyncMessage(
    userId: string,
    displayName: string,
    sourceTimestamp: string,
): HandleSyncMessage {
    return { userId, displayName, sourceTimestamp };
}
