import { customType, index, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';

// citext — case-insensitive text (requires pg extension citext)
export const citext = customType<{ data: string; driverData: string }>({
    dataType() {
        return 'citext';
    },
});

/** @implements REQ-013 REQ-014 REQ-015 REQ-017 REQ-018 REQ-019 REQ-025 REQ-CN-003 FR-013 FR-014 FR-015 FR-017 FR-018 FR-019 FR-025 ARCH-011 ARCH-012 ARCH-015 MOD-011 MOD-012 MOD-015 */
// `tombstoned`/`erased` are the CR-002 lifecycle states (account closure vs. right-to-erasure), added via
// `ALTER TYPE ... ADD VALUE` in migration 0010. They are NEW values — distinct from `suspended`, which is an
// admin moderation hold that RETAINS all PII; tombstoned/erased both scrub PII (see ProfileScrubPolicy).
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'tombstoned', 'erased']);

/** @implements REQ-013 REQ-014 REQ-015 REQ-017 REQ-018 REQ-019 REQ-025 REQ-CN-003 FR-013 FR-014 FR-015 FR-017 FR-018 FR-019 FR-025 ARCH-011 ARCH-012 ARCH-015 MOD-011 MOD-012 MOD-015 */
export const users = pgTable(
    'users',
    {
        id: text('id').primaryKey(),
        identityId: text('identity_id').unique().notNull(),
        email: citext('email').notNull(),
        name: text('name'),
        picture: text('picture'),
        status: userStatusEnum('status').notNull().default('active'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        deletedAt: timestamp('deleted_at', { withTimezone: true }),
        externalIdSyncedAt: timestamp('external_id_synced_at', { withTimezone: true }),
    },
    (table) => [
        // Partial: email is unique only among ACTIVE users. A soft-deleted user (deleted_at set)
        // keeps its row but no longer reserves the email, so the same person can delete then
        // re-register with the same address — a NEW Clerk identity then inserts cleanly instead of
        // colliding on a dead row (which 502'd the user.created webhook). See migration 0009.
        uniqueIndex('users_email_unique')
            .on(table.email)
            .where(sql`${table.deletedAt} is null`),
        uniqueIndex('users_identity_id_unique').on(table.identityId),
        index('users_email_idx').on(table.email),
        index('users_identity_id_idx').on(table.identityId),
    ],
);

/** @implements REQ-013 REQ-014 REQ-015 FR-013 FR-014 FR-015 ARCH-011 MOD-011 */
export type UserRow = InferSelectModel<typeof users>;

/** @implements REQ-013 REQ-014 REQ-015 FR-013 FR-014 FR-015 ARCH-011 MOD-011 */
export type NewUserRow = InferInsertModel<typeof users>;
