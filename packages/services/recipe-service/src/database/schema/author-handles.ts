/**
 * `author_handles` — the recipe-DB read model for user display-names (W8-a.2 / owner decision 6).
 *
 * The recipe write path reads the CURRENT handle for a user LOCALLY from this table (no cross-service call
 * — the rejected read-time-lookup alternative), falling back to the token claim only when no row exists yet.
 * The handle-sync consumer maintains it MONOTONICALLY on `source_timestamp` (apply only a strictly-newer
 * rename), then fans the denormalized name out to `recipes.author_handle` + `recipe_versions.editor_handle`.
 *
 * `user_id` is the app-user ULID — a user-keyed table, so it is the FOURTH GDPR erasure root (W8-a.10),
 * swept by the erasure worker. `source_timestamp` is `profiles.updatedAt` written in the SAME transaction
 * as the displayName change (a single clock), so the monotonic guard is race-correct across both producer
 * routes (the Clerk `user.updated` webhook and identity's `PATCH /v1/users/me`).
 */
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const authorHandles = pgTable('author_handles', {
    /** App-user ULID (identity's `users.id`) — no FK, no local users table (D2). GDPR erasure root. */
    userId: varchar('user_id', { length: 255 }).primaryKey(),
    /** The user's current display name (identity's `profiles.displayName`). */
    displayName: text('display_name').notNull(),
    /** `profiles.updatedAt` at the rename (the single clock the monotonic guard compares). */
    sourceTimestamp: timestamp('source_timestamp', { withTimezone: true }).notNull(),
});

/** An `author_handles` row as selected. */
export type AuthorHandleRow = InferSelectModel<typeof authorHandles>;
/** An `author_handles` row for insert. */
export type AuthorHandleInsert = InferInsertModel<typeof authorHandles>;
