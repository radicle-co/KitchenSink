/**
 * ProfileScrubPolicy — the single authoritative field-scrub rule (Specification A of CR-002; see
 * `docs/plans/2026-07-18-002-feat-account-closure-anonymization-plan.md` §"Field-scrub policy").
 *
 * Two lifecycle events reduce the never-hard-deleted identity row (R1) to different surviving field sets:
 *   - **closure** (tombstone, recoverable) keeps `{ id, name }`; scrubs email → a ULID-keyed placeholder,
 *     nulls the avatar (DB column + S3 object), keeps the companion `accounts`/`profiles` rows so an
 *     admin-mediated recovery restores the display name.
 *   - **erasure** (irreversible) keeps `{ id }` only; destroys name, email (→ placeholder), avatar, and the
 *     companion rows.
 *
 * This module is a **pure Specification** consumed by BOTH the closure path (identity service `deleteUserMe`)
 * and the erasure path (identity-webhooks tombstone sweep), so neither open-codes a divergent scrub. It emits
 * no clock and performs no I/O — the caller supplies `now` and applies the returned directive inside its own
 * transaction, and performs the S3 delete where it holds that capability.
 */

/** The two lifecycle scrub events. */
export type LifecycleScrubEvent = 'closure' | 'erasure';

/** The resulting persisted lifecycle state on the `users.status` enum. */
export type LifecycleState = 'tombstoned' | 'erased';

/**
 * Column values to SET on the (never-deleted, R1) `users` row.
 *
 * `name` is present (as `null`) ONLY for erasure, where the name is destroyed; on closure the key is absent so
 * a spread leaves the column untouched (the name is kept for recovery).
 */
export interface ScrubbedUserColumns {
    /** ULID-keyed, never-deliverable placeholder — satisfies the NOT NULL `email` column. */
    readonly email: string;
    /** The Clerk/uploaded avatar mirror is always cleared. */
    readonly picture: null;
    /** The lifecycle state written by this scrub. */
    readonly status: LifecycleState;
    /** Present (`null`) only on erasure — the name is destroyed. Absent on closure (name kept). */
    readonly name?: null;
}

/** One authoritative scrub directive, applied by the caller inside its own transaction. */
export interface ProfileScrubDirective {
    /** The `users`-row column mutations (the row is UPDATEd, never DELETEd — R1). */
    readonly userColumns: ScrubbedUserColumns;
    /**
     * Erasure destroys the companion `accounts` + `profiles` rows (taking displayName/avatarUrl/bio with them);
     * closure keeps them and scrubs only the avatar (see {@link ProfileScrubDirective.profileScrub}).
     */
    readonly purgeCompanionRows: boolean;
    /** Profile columns to scrub when companion rows are KEPT (closure); `null` when they are purged (erasure). */
    readonly profileScrub: { readonly avatarUrl: null } | null;
    /** Both events delete the avatar S3 object; the caller performs it where it holds S3 capability. */
    readonly removeAvatarObject: true;
    /** The persisted lifecycle state — mirrors `userColumns.status`, surfaced for audit/logging. */
    readonly state: LifecycleState;
}

/**
 * The scrubbed placeholder email. Keyed on the app **ULID** (never the Clerk `sub`, which erasure destroys) so
 * it is unique per user, and in the RFC 2606 reserved `.invalid` TLD so it can never be delivered.
 */
export function scrubbedEmail(userId: string, event: LifecycleScrubEvent): string {
    return `${userId}@${event === 'closure' ? 'closed' : 'erased'}.invalid`;
}

/**
 * Compute the field-scrub directive for a lifecycle event. Pure — no clock, no I/O.
 *
 * @param event - `closure` (tombstone, recoverable) or `erasure` (irreversible).
 * @param userId - the app ULID, used to key the placeholder email.
 * @returns the authoritative scrub directive for the event.
 */
export function computeProfileScrub(event: LifecycleScrubEvent, userId: string): ProfileScrubDirective {
    if (event === 'closure') {
        return {
            // name is deliberately OMITTED — closure keeps it (R2).
            userColumns: { email: scrubbedEmail(userId, 'closure'), picture: null, status: 'tombstoned' },
            purgeCompanionRows: false,
            profileScrub: { avatarUrl: null },
            removeAvatarObject: true,
            state: 'tombstoned',
        };
    }

    return {
        userColumns: { email: scrubbedEmail(userId, 'erasure'), picture: null, name: null, status: 'erased' },
        purgeCompanionRows: true,
        profileScrub: null,
        removeAvatarObject: true,
        state: 'erased',
    };
}
