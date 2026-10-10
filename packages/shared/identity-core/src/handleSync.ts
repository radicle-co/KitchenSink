/**
 * The handle-sync message contract (W8-a.2 / decision 6) — the payload BOTH producer routes (identity's
 * `PATCH /api/v1/users/me` and the Clerk `user.updated` webhook) publish to the global handle-sync SNS topic,
 * and the recipe-workers consumer applies. Defined once here in `identity-core` (dependency-light) so the
 * producers and the consumer can never disagree on the shape.
 *
 * @module
 */
import { isValid as isValidUlid } from 'ulidx';
import { z } from 'zod';

/**
 * The consumer's own bound on a display name. It is written to `author_handles.display_name` and denormalized
 * into `recipes.author_handle` and `recipe_versions.editor_handle` — three unbounded `text` columns — so the
 * bound has to exist somewhere, and it belongs beside the contract rather than in one of the two services.
 */
export const MAX_DISPLAY_NAME_LENGTH = 100;

/**
 * The contract, as the CONSUMER enforces it.
 *
 * ⛔ This module's opening paragraph has always claimed the shape is "defined once here … so the producers and
 * the consumer can never disagree". It was half true: the TYPE lived here while the recipe-workers consumer
 * kept its own zod schema, so the only thing stopping a drift was that nobody had changed either. The schema
 * now lives here too, the consumer imports it, and the producers validate against it before publishing.
 */
export const handleSyncMessageSchema = z.object({
    userId: z.string().refine(isValidUlid, { error: 'must be a valid ULID' }),
    displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH),
    sourceTimestamp: z.iso.datetime(),
});

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

/**
 * Why a handle-sync publish failed, recorded on `profiles.handle_sync_failure_code` (plan U9, R25).
 *
 * ⛔ A CLOSED vocabulary shared by both producers and by the backstop that reads it, and a CODE rather than
 * an exception message — an error text can carry the display name, and the marker exists to make a failure
 * visible without copying the user's words anywhere new. Two producers write this column (the service's
 * rename and the webhook's), so a literal in each would be the drift DRY governs.
 */
export const HANDLE_SYNC_PUBLISH_FAILED = 'publish_failed';
