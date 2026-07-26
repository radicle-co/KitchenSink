import { customType, index, pgEnum, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { type InferInsertModel, type InferSelectModel } from 'drizzle-orm';

// COLLATE "C" custom type — standard varchar() doesn't expose collation
export const varcharCollateC = customType<{ data: string; driverData: string }>({
    dataType() {
        return 'VARCHAR(255) COLLATE "C"';
    },
});

/** @implements REQ-013 REQ-014 REQ-015 REQ-017 REQ-018 REQ-019 REQ-025 REQ-CN-003 FR-013 FR-014 FR-015 FR-017 FR-018 FR-019 FR-025 ARCH-011 ARCH-012 ARCH-015 MOD-011 MOD-012 MOD-015 */
// `tombstoned`/`erased` are the CR-002 lifecycle states (account closure vs. right-to-erasure), added via
// `ALTER TYPE ... ADD VALUE` in migration 0010. They are NEW values — distinct from `suspended`, which is an
// admin moderation hold that RETAINS all PII; tombstoned/erased both scrub PII (see ProfileScrubPolicy).
// NOTE: the identity service's runtime schema is `@kitchensink/identity-db`; this duplicate is kept in lockstep.
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'tombstoned', 'erased']);

/** @implements REQ-013 REQ-014 REQ-015 REQ-017 REQ-018 REQ-019 REQ-025 REQ-CN-003 FR-013 FR-014 FR-015 FR-017 FR-018 FR-019 FR-025 ARCH-011 ARCH-012 ARCH-015 MOD-011 MOD-012 MOD-015 */
export const users = pgTable(
    'users',
    {
        id: varcharCollateC('id').primaryKey(),
        email: varchar('email', { length: 320 }).notNull(),
        name: text('name'),
        picture: text('picture'),
        status: userStatusEnum('status').notNull().default('active'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        deletedAt: timestamp('deleted_at', { withTimezone: true }),
    },
    (table) => [uniqueIndex('users_email_unique').on(table.email), index('users_email_idx').on(table.email)],
);

/** @implements REQ-013 REQ-014 REQ-015 FR-013 FR-014 FR-015 ARCH-011 MOD-011 */
export type UserRow = InferSelectModel<typeof users>;

/** @implements REQ-013 REQ-014 REQ-015 FR-013 FR-014 FR-015 ARCH-011 MOD-011 */
export type NewUserRow = InferInsertModel<typeof users>;
