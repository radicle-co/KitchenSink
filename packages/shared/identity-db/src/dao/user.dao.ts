import type { BylineSnapshot } from '@kitchensink/identity-core';
import { and, eq, isNull } from 'drizzle-orm';
import type { IdentityWriter } from '../identityWriter.js';

import { profileClock } from '../profileClock.js';

import { accounts } from '../schema/accounts.js';
import { profiles } from '../schema/profiles.js';
import { users } from '../schema/users.js';
import type { NewUserRow, UserRow } from '../schema/users.js';
import { newUserId, type UserId } from '../ulid.js';

/**
 * Minimal structural logging contract. `UserDAO` is shared between the NestJS identity service
 * (Sentry via `@sentry/nestjs`, `createServiceLogger`) and the identity-webhooks Lambda bundle (Sentry
 * via `@sentry/aws-serverless`, its own `common/observability.js` logger) — two incompatible concrete
 * Sentry integrations. Depending on either concretely from this shared DAO would either fail to
 * resolve in the other package or bundle an unrelated Sentry SDK into the Lambda. Callers pass their
 * own package's logger; a silent no-op is the safe default so existing `new UserDAO(db)` call sites
 * that never hit the warning path are unaffected.
 */
export interface UserDaoLogger {
    warn: (message: string, extra?: Record<string, unknown>) => void;
}

const noopLogger: UserDaoLogger = { warn: () => {} };

/** A byline snapshot with the `profileClock` stamp the statement that wrote it returned. */
export interface StampedByline extends BylineSnapshot {
    /** `profiles.updated_at` (= `handle_sync_owed_at`) as that statement stamped it — the snapshot's key. */
    readonly stampedAt: Date;
}

/** @implements REQ-013 REQ-014 REQ-015 REQ-017 REQ-018 REQ-019 REQ-025 FR-013 FR-014 FR-015 FR-017 FR-018 FR-019 FR-025 ARCH-011 ARCH-012 MOD-011 MOD-012 */
export class UserDAO {
    constructor(
        private readonly db: IdentityWriter,
        private readonly logger: UserDaoLogger = noopLogger,
    ) {}

    async findById(id: UserId): Promise<UserRow | undefined> {
        const rows = await this.db.select().from(users).where(eq(users.id, id));

        return rows[0];
    }

    async findByIdentityId(identityId: string): Promise<UserRow | undefined> {
        const rows = await this.db.select().from(users).where(eq(users.identityId, identityId));

        return rows[0];
    }

    async upsertByIdentityId(data: {
        identityId: string;
        email: string;
        name?: string;
        picture?: string;
    }): Promise<UserRow> {
        const values: NewUserRow = {
            id: newUserId(),
            identityId: data.identityId,
            email: data.email,
            name: data.name ?? null,
            picture: data.picture ?? null,
        };

        const rows = await this.db
            .insert(users)
            .values(values)
            .onConflictDoUpdate({
                target: users.identityId,
                set: {
                    email: data.email,
                    name: data.name ?? null,
                    picture: data.picture ?? null,
                    deletedAt: null,
                    updatedAt: new Date(),
                },
            })
            .returning();

        return rows[0]!;
    }

    async updateProfile(id: UserId, patch: Partial<Pick<UserRow, 'name' | 'picture'>>): Promise<UserRow | undefined> {
        const rows = await this.db
            .update(users)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(users.id, id))
            .returning();

        return rows[0];
    }

    /**
     * Coherent `users`/`profiles` sync for `user.updated` (S-I3, corrected; plan 2026-10-15-010 D5). `users.name`/
     * `users.picture` are the Clerk MIRROR — the last-synced Clerk value — and are the gate for the name and the
     * avatar. `profiles.displayName`/`avatarUrl` is the EFFECTIVE value the app renders, which a user can override
     * independent of Clerk via self-service `PATCH /api/v1/users/me`.
     *
     * Gating on the mirror is what makes both of these hold at once:
     *   - A genuine Clerk change (mirror ≠ incoming) moves the mirror AND syncs `profiles` (Clerk wins on a real
     *     change — decision 6), so the mirror never goes stale and A→B→A still round-trips.
     *   - A non-name Clerk event (avatar-only, a redelivery) leaves `profiles.displayName` untouched, preserving a
     *     self-service override. Each field is gated INDEPENDENTLY.
     *
     * The USERNAME needs no mirror: Clerk is its only authority and the app has no rename, so the incoming value is
     * compared to `profiles.username` directly.
     *
     * ⛔ Returns the BYLINE SNAPSHOT — present only when the display name OR the username changed — read back from the
     * `RETURNING` of the statement that wrote it. So a username-only change publishes the PROFILE's display name (a
     * cook's own override), never Clerk's, and the snapshot's stamp is the row's `profileClock`, which the same
     * statement writes to `handle_sync_owed_at` as the debt the publish must settle.
     *
     * Both tables are written in one transaction, the user row locked first (`FOR UPDATE`) and then the profile.
     *
     * @sideEffect Updates `users.name`/`users.picture` and, per field, `profiles.displayName`/`avatarUrl`/`username`.
     */
    async syncProviderFields(
        userId: UserId,
        data: { name: string; picture: string | null; username?: string | null | undefined; now: Date },
    ): Promise<{ readonly byline?: StampedByline }> {
        return this.db.transaction(async (tx) => {
            const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');

            if (!user) {
                return {};
            }

            const [profile] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).for('update');

            if (!profile) {
                this.logger.warn(
                    'UserDAO.syncProviderFields: users row exists but profiles row is missing (invariant violation)',
                    { userId },
                );

                return {};
            }

            const nameChanged = data.name !== user.name;
            const pictureChanged = data.picture !== user.picture;
            // `undefined` — an event that does not carry the username — leaves it alone; `null` clears it.
            const usernameChanged = data.username !== undefined && data.username !== profile.username;
            const bylineChanged = nameChanged || usernameChanged;

            if (!nameChanged && !pictureChanged && !usernameChanged) {
                return {};
            }

            if (nameChanged || pictureChanged) {
                await tx
                    .update(users)
                    .set({ name: data.name, picture: data.picture, updatedAt: data.now })
                    .where(eq(users.id, userId));
            }

            const [written] = await tx
                .update(profiles)
                .set({
                    ...(nameChanged ? { displayName: data.name } : {}),
                    ...(pictureChanged ? { avatarUrl: data.picture } : {}),
                    ...(usernameChanged ? { username: data.username ?? null } : {}),
                    // ⛔ U9/R21: the OWED MARKER moves with the byline, inside this statement and on the same clock.
                    // The publish happens after the commit and is best-effort, so without the marker a failed
                    // fan-out left nothing behind. Both columns, because a new debt must not inherit the previous
                    // attempt's failure code.
                    ...(bylineChanged ? { handleSyncOwedAt: profileClock, handleSyncFailureCode: null } : {}),
                    updatedAt: profileClock,
                })
                .where(eq(profiles.userId, userId))
                .returning({
                    displayName: profiles.displayName,
                    username: profiles.username,
                    stampedAt: profiles.updatedAt,
                });

            return bylineChanged && written !== undefined ? { byline: written } : {};
        });
    }

    /**
     * Settle the handle-sync debt this rename recorded (plan U9, R21/R25).
     *
     * ⛔ CONDITIONAL on the stamp the caller wrote, which is the whole safety of it. A second rename can land
     * between a publish starting and finishing; settling unconditionally would erase the NEWER debt and leave
     * that name un-synced with nothing recording it — the exact silence the marker exists to end,
     * reintroduced by the successful path.
     *
     * @param userId - The renamed user.
     * @param owedAt - The stamp the rename wrote; only a row still carrying it is settled.
     * @param failureCode - `null` clears the debt (published); a code leaves it, saying why it is still owed.
     * @sideEffect Updates `profiles`.
     */
    async settleHandleSync(userId: UserId, owedAt: Date, failureCode: string | null): Promise<void> {
        await this.db
            .update(profiles)
            .set(
                failureCode === null
                    ? { handleSyncOwedAt: null, handleSyncFailureCode: null }
                    : { handleSyncFailureCode: failureCode },
            )
            .where(and(eq(profiles.userId, userId), eq(profiles.handleSyncOwedAt, owedAt)));
    }

    /**
     * Record that the provider was brought to `version` — CONDITIONALLY on the intent not having moved (U10).
     *
     * ⛔ The condition is the whole guarantee. A newer status change committed while the provider call was in
     * flight means this result is already stale; settling anyway would mark the account converged at a state
     * it is no longer in, and nothing downstream could tell. Zero rows matched IS that signal.
     *
     * @param id - The user.
     * @param version - The `status_version` the caller read before calling the provider.
     * @returns Whether the settle landed. `false` means the intent moved; the caller must not acknowledge.
     * @sideEffect Updates `users.status_applied_version`.
     */
    async settleStatusVersion(id: UserId, version: number): Promise<boolean> {
        const settled = await this.db
            .update(users)
            .set({ statusAppliedVersion: version })
            .where(and(eq(users.id, id), eq(users.statusVersion, version)))
            .returning({ id: users.id });

        return settled.length > 0;
    }

    /**
     * Record that the identity provider confirmed an erased account no longer exists (P1 #5).
     *
     * Idempotent and monotone: it stamps only an `erased` row whose confirmation is still NULL, so a duplicate
     * delivery, a webhook echo or a reconciliation re-run can neither move the first instant nor stamp a row that
     * is not erased (the CHECK would reject it). It leaves `updated_at` alone — this is bookkeeping about the
     * provider, not a change to the identity, and `updated_at` is the reconciliation grace clock.
     *
     * @param id - The erased user.
     * @param at - The instant the provider confirmed the deletion.
     * @sideEffect Updates `users.provider_deleted_at`.
     */
    async confirmProviderDeleted(id: UserId, at: Date): Promise<void> {
        await this.db
            .update(users)
            .set({ providerDeletedAt: at })
            .where(and(eq(users.id, id), eq(users.status, 'erased'), isNull(users.providerDeletedAt)));
    }

    async softDelete(id: UserId): Promise<UserRow | undefined> {
        const rows = await this.db
            .update(users)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(users.id, id))
            .returning();

        return rows[0];
    }

    async purgePrivateDataByIdentityId(identityId: string): Promise<UserRow | undefined> {
        // On a `user.deleted` event we retain only the PUBLIC attribution data the user provided — the
        // user id, email, and name — so recipes in the public database still show who created them
        // after the account is gone. Everything private (EU law) is purged: the avatar (picture) is
        // cleared on the user row, and the account + profile rows (subscription tier, display name,
        // avatar URL, bio) are deleted outright. The user row is soft-deleted (deleted_at) so it's no
        // longer an active account but remains as an attribution tombstone — the partial
        // users_email_unique index (migration 0009) frees the email for re-registration.
        //
        // Lock the users row FIRST (the UPDATE), then delete the children — the same lock order as
        // provisionCompleteUser (users -> accounts -> profiles), so a delete racing a concurrent
        // provision of the same identity can't deadlock (the d59e11c 40P01 class).
        return this.db.transaction(async (tx) => {
            const updated = await tx
                .update(users)
                .set({ deletedAt: new Date(), picture: null, updatedAt: new Date() })
                .where(eq(users.identityId, identityId))
                .returning();

            const user = updated[0];

            if (!user) {
                return undefined;
            }

            await tx.delete(accounts).where(eq(accounts.userId, user.id));
            await tx.delete(profiles).where(eq(profiles.userId, user.id));

            return user;
        });
    }
}
