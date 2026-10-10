import { and, eq, sql } from 'drizzle-orm';
import type { IdentityWriter } from '../identityWriter.js';

import { settings } from '../schema/settings.js';
import type { SettingsRow } from '../schema/settings.js';
import { users } from '../schema/users.js';
import type { UserId } from '../ulid.js';

/**
 * The settings a caller may change. A key that is ABSENT is left as it is; there is no way to say "clear it", because
 * a setting that was never chosen reads back as its default.
 *
 * Add a setting by adding its optional key here, beside the column in `schema/settings.ts`.
 */
export interface SettingsPatch {
    /** Whether the web "/" key focuses search. */
    readonly searchShortcut?: boolean;
}

/**
 * Data Access Object over the `settings` table (ADR-0059): read one user's row, and write the columns a caller
 * supplied in ONE statement.
 *
 * @pattern Data Access Object
 */
export class SettingsDAO {
    constructor(private readonly db: IdentityWriter) {}

    /**
     * Read a user's row.
     *
     * @param userId - The app-user ULID.
     * @returns The row, or `undefined` when the user never chose a setting (no row exists until a first write).
     */
    async findByUserId(userId: UserId): Promise<SettingsRow | undefined> {
        const rows = await this.db.select().from(settings).where(eq(settings.userId, userId));

        return rows[0];
    }

    /**
     * Write the supplied columns for an ACTIVE user, creating the row on the first write.
     *
     * ONE statement: `INSERT … SELECT … FROM users WHERE id = $1 AND status = 'active' ON CONFLICT (user_id) DO
     * UPDATE SET <only the supplied columns>, updated_at = now() RETURNING *`. Two concurrent first writes leave one
     * row, because the conflict target is the primary key. A user who is not active matches no row in the `SELECT`,
     * so nothing is written and personal data is never recreated after an erasure. Last write wins, per column.
     *
     * The INSERT lists every column (drizzle requires it of an insert-select); a column the caller did not supply is
     * inserted as `NULL`, which is "never chosen", and is left alone by the conflict branch.
     *
     * @param userId - The app-user ULID.
     * @param patch - The columns to write.
     * @returns The row as stored, or `undefined` when the user is missing or not active.
     * @sideEffect Inserts or updates one `settings` row.
     */
    async upsertForActiveUser(userId: UserId, patch: SettingsPatch): Promise<SettingsRow | undefined> {
        const rows = await this.db
            .insert(settings)
            // The SQL overload of `select`: drizzle's typed insert-select builder rejects even the documented shape
            // under this package's strictness. The statement lists every table column in table order, which is
            // what drizzle emits as the INSERT column list.
            .select(
                sql`SELECT ${users.id}, ${patch.searchShortcut ?? null}::boolean, now() FROM ${users} WHERE ${and(
                    eq(users.id, userId),
                    eq(users.status, 'active'),
                )}`,
            )
            .onConflictDoUpdate({
                target: settings.userId,
                set: {
                    ...(patch.searchShortcut === undefined ? {} : { searchShortcut: patch.searchShortcut }),
                    updatedAt: sql`now()`,
                },
            })
            .returning();

        return rows[0];
    }
}
