/**
 * The shared identity-erasure primitive (CR-002 / U4b) — the ONE authoritative representation of the
 * "erase this identity row" transaction, so the 12-month tombstone-sweep and the `user.deleted`-webhook
 * full erasure cannot drift.
 *
 * It applies the erased field-scrub ({@link computeProfileScrub}('erasure') → `{id}` only: name/picture
 * destroyed, email → a ULID-keyed placeholder, `status='erased'`), purges the companion `accounts`/
 * `profiles` rows, and appends the append-only R8 `lifecycle_events` audit row — all in ONE transaction, so
 * a partial failure never leaves the row half-erased or the audit missing. The row itself is NEVER
 * hard-deleted (R1) and its `identityId` is left intact (so it stays resolvable).
 *
 * Setting `status='erased'` is also what makes the R10 anti-resurrection guard cover a webhook-erased user:
 * `provisionCompleteUser`'s conflict CASE and the nightly reconciliation both key on
 * `status IN ('tombstoned','erased')`, so an `active`+soft-deleted row (the OLD legacy purge) was NOT
 * protected — an erased one is.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { users, accounts, profiles, lifecycleEvents, type LifecycleTriggerSource } from '@kitchensink/identity-db';
import { computeProfileScrub } from '@kitchensink/identity-core';

/** The inputs to {@link eraseIdentityRow}. */
export interface EraseIdentityInput {
    /** The app-user ULID (identity `users.id`) to erase. */
    readonly userId: string;
    /** The R8 audit trigger source — `'sweep'` (12-month auto-erasure) or `'admin'` (webhook/dashboard). */
    readonly triggerSource: LifecycleTriggerSource;
    /** The R8 audit actor label (e.g. the webhook name), or `null` for an unattributed automated sweep. */
    readonly actor: string | null;
}

/**
 * Erase one identity row: erased field-scrub + companion-row purge + R8 audit, in a single transaction.
 * Idempotent — re-running it against an already-erased row re-writes the same terminal columns and (by
 * design of the append-only audit) appends another audit row; callers that must avoid a duplicate audit
 * entry should gate on the row's current `status` before calling.
 *
 * @param db - The Drizzle handle.
 * @param input - The target user, trigger source, and actor.
 * @param now - The transaction instant (stamped on `updatedAt` and `occurredAt`).
 * @sideEffect Updates the `users` row, deletes `accounts`/`profiles` rows, inserts a `lifecycle_events` row.
 */
export async function eraseIdentityRow(
    db: PostgresJsDatabase<Record<string, never>>,
    input: EraseIdentityInput,
    now: Date,
): Promise<void> {
    const directive = computeProfileScrub('erasure', input.userId);

    await db.transaction(async (tx) => {
        await tx
            .update(users)
            .set({ ...directive.userColumns, updatedAt: now })
            .where(eq(users.id, input.userId));

        if (directive.purgeCompanionRows) {
            await tx.delete(accounts).where(eq(accounts.userId, input.userId));
            await tx.delete(profiles).where(eq(profiles.userId, input.userId));
        }

        await tx.insert(lifecycleEvents).values({
            userId: input.userId,
            event: 'erasure',
            triggerSource: input.triggerSource,
            actor: input.actor,
            occurredAt: now,
        });
    });
}
