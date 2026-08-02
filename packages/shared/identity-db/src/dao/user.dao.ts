import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { users, accounts, profiles } from '../schema/index.js';
import type { NewUserRow, ProfileRow, UserRow } from '../schema/index.js';
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

/** @implements REQ-013 REQ-014 REQ-015 REQ-017 REQ-018 REQ-019 REQ-025 FR-013 FR-014 FR-015 FR-017 FR-018 FR-019 FR-025 ARCH-011 ARCH-012 MOD-011 MOD-012 */
export class UserDAO {
    constructor(
        private readonly db: PostgresJsDatabase<Record<string, never>>,
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
     * Coherent `users`/`profiles` sync for `user.updated` (S-I3, corrected). `users.name`/
     * `users.picture` are the Clerk MIRROR — the last-synced Clerk value — and are the gate.
     * `profiles.displayName`/`avatarUrl` is the EFFECTIVE value the app renders, which a user can
     * override independent of Clerk via self-service `PATCH /api/v1/users/me`.
     *
     * The ORIGINAL bug gated on `users.name`, which this webhook path never wrote — the baseline never
     * moved, so an A→B→A Clerk rename froze `profiles.displayName` at B (the B→A revert compared
     * against the stale, never-moved `users.name` and saw no difference).
     *
     * Gating on `profiles` instead (the first attempted fix) traded that bug for a WORSE one: after a
     * self-service rename set `profiles.displayName` to X while Clerk's name stayed Y, ANY subsequent
     * `user.updated` (an avatar-only change, an email change, a svix redelivery) recomputed Clerk's
     * unchanged Y, compared it to X, saw a "difference", and REVERTED the self-service edit — data loss
     * on every unrelated webhook delivery.
     *
     * Gating on `users.name`/`users.picture` (the Clerk mirror) — and moving the mirror on every real
     * Clerk-side change — fixes both at once:
     *   - A genuine Clerk change (mirror ≠ incoming) moves the mirror AND syncs `profiles` (Clerk wins
     *     on a real change — decision 6), so the mirror never goes stale and A→B→A still round-trips.
     *   - A non-name Clerk event (mirror name == incoming name, e.g. avatar-only or a redelivery)
     *     leaves `profiles.displayName` untouched, preserving a self-service override. The two fields
     *     are gated INDEPENDENTLY — an avatar-only event still moves `profiles.avatarUrl` (and the
     *     mirror), it just never touches `displayName`.
     *
     * Both tables are written together in one transaction so they can never drift into a stale
     * duplicate baseline. Returns whether `displayName` (specifically) changed, so the caller can gate
     * the handle-sync publish on a genuine Clerk-driven name change only.
     *
     * @sideEffect updates `users.name`/`users.picture` and, per-field, `profiles.displayName`/
     * `avatarUrl` — only for the field(s) that genuinely changed on Clerk's side.
     */
    async syncNameAndPicture(
        userId: UserId,
        data: { name: string; picture: string | null; now: Date },
    ): Promise<{ displayNameChanged: boolean }> {
        return this.db.transaction(async (tx) => {
            const [user] = await tx.select().from(users).where(eq(users.id, userId));

            if (!user) {
                return { displayNameChanged: false };
            }

            const nameChanged = data.name !== user.name;
            const pictureChanged = data.picture !== user.picture;

            if (!nameChanged && !pictureChanged) {
                return { displayNameChanged: false };
            }

            const [profile] = await tx.select().from(profiles).where(eq(profiles.userId, userId));

            if (!profile) {
                this.logger.warn(
                    'UserDAO.syncNameAndPicture: users row exists but profiles row is missing (invariant violation)',
                    { userId },
                );

                return { displayNameChanged: false };
            }

            await tx
                .update(users)
                .set({ name: data.name, picture: data.picture, updatedAt: data.now })
                .where(eq(users.id, userId));

            const profilePatch: Partial<Pick<ProfileRow, 'displayName' | 'avatarUrl'>> = {};

            if (nameChanged) {
                profilePatch.displayName = data.name;
            }

            if (pictureChanged) {
                profilePatch.avatarUrl = data.picture;
            }

            await tx
                .update(profiles)
                .set({ ...profilePatch, updatedAt: data.now })
                .where(eq(profiles.userId, userId));

            return { displayNameChanged: nameChanged };
        });
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
