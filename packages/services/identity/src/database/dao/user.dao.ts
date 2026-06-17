import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { users } from '../schema/index.js';
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

    async hardDeleteByIdentityId(identityId: string): Promise<UserRow | undefined> {
        // A `user.deleted` event requires erasing ALL personal data — a hard delete, not a soft flag.
        // Deleting the user row cascades to its `accounts` and `profiles` rows via their
        // `ON DELETE CASCADE` FKs (migration 0005), so no email / name / picture / display name /
        // avatar / bio is left anywhere in the database.
        const rows = await this.db.delete(users).where(eq(users.identityId, identityId)).returning();

        return rows[0];
    }
}
