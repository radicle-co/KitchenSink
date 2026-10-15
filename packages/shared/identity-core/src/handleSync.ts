/**
 * The handle-sync message contract (W8-a.2 / decision 6) — the BYLINE SNAPSHOT every producer route (identity's
 * `PATCH /api/v1/users/me`, the Clerk `user.created` / `user.updated` webhook, the read-through create) publishes
 * to the global handle-sync SNS topic, and the recipe-workers consumer applies. Defined once here in
 * `identity-core` (dependency-light) so the producers and the consumer can never disagree on the shape.
 *
 * ⛔ A SNAPSHOT, never a delta (plan 2026-10-15-010 D6). It carries BOTH halves of the byline — the display name and
 * the Clerk username — every time either changes, and the consumer applies it monotonically on one timestamp. A
 * delta that carried only the half that changed would be lost the moment a newer delta about the other half won the
 * timestamp comparison. The contract's other half is the clock: `sourceTimestamp` is the profile's `updated_at` as
 * the database stamped it in the statement that changed the profile (`profileClock`, `@kitchensink/identity-db`),
 * so the last writer always carries the highest key AND the whole state.
 *
 * @pattern Event-Carried State Transfer — the message is the whole byline, so the consumer needs no read back
 * @module
 */
import { isValid as isValidUlid } from 'ulidx';
import { z } from 'zod';

import { usernameSchema } from './username.js';

/**
 * The consumer's own bound on a display name. It is written to `author_handles.display_name` and denormalized
 * into `recipes.author_handle` and `recipe_versions.editor_handle` — three unbounded `text` columns — so the
 * bound has to exist somewhere, and it belongs beside the contract rather than in one of the two services.
 */
export const MAX_DISPLAY_NAME_LENGTH = 100;

/**
 * The contract, as the CONSUMER enforces it. The producers validate against it before publishing.
 *
 * `username` is a REQUIRED key whose value may be `null`: null says "this cook has no username", which an absent
 * key would conflate with "the producer did not say".
 */
export const handleSyncMessageSchema = z.object({
    userId: z.string().refine(isValidUlid, { error: 'must be a valid ULID' }),
    displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH),
    username: usernameSchema.nullable(),
    sourceTimestamp: z.iso.datetime(),
});

/** A byline snapshot event. `sourceTimestamp` is the SINGLE monotonic clock the consumer orders on. */
export interface HandleSyncMessage {
    /** The app-user ULID whose byline changed. */
    readonly userId: string;
    /** The user's display name (identity's `profiles.displayName`). */
    readonly displayName: string;
    /** The user's Clerk username (identity's `profiles.username`), or `null` when they have none. */
    readonly username: string | null;
    /**
     * `profiles.updated_at` as stamped by the statement that changed the profile (ISO-8601). Every route MUST use
     * this database clock — never a producer-local `new Date()` — or two writers' clocks could order the
     * snapshots differently from the order the database applied them.
     */
    readonly sourceTimestamp: string;
}

/** The two halves of a public byline, as identity holds them. */
export interface BylineSnapshot {
    /** The display name — public, filled from first + last name, editable in Profile (D22). */
    readonly displayName: string;
    /** The Clerk username — the public "@handle" — or `null` when the cook has none. */
    readonly username: string | null;
}

/**
 * Build a {@link HandleSyncMessage} from a byline snapshot. Pure — the caller supplies `sourceTimestamp` from the
 * same statement as the write (this does not stamp `Date.now()`, deliberately).
 */
export function buildHandleSyncMessage(
    userId: string,
    byline: BylineSnapshot,
    sourceTimestamp: string,
): HandleSyncMessage {
    return { userId, displayName: byline.displayName, username: byline.username, sourceTimestamp };
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
