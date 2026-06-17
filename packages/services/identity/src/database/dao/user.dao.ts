import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { users, accounts, profiles } from '../schema/index.js';
import type { NewUserRow, UserRow } from '../schema/index.js';
import { newUserId, type UserId } from '../../types/index.js';

/** @implements REQ-013 REQ-014 REQ-015 REQ-017 REQ-018 REQ-019 REQ-025 FR-013 FR-014 FR-015 FR-017 FR-018 FR-019 FR-025 ARCH-011 ARCH-012 MOD-011 MOD-012 */
export class UserDAO {
    constructor(private readonly db: PostgresJsDatabase<Record<string, never>>) {}

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
