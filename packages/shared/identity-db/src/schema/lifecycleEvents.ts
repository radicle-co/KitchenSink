import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

/**
 * `lifecycle_events` — the append-only Art. 30 audit trail for account lifecycle transitions (CR-002 R8).
 *
 * One immutable row per closure / erasure / reactivation, written in the SAME transaction as the state change
 * it records (so the audit can never drift from the mutable `users.status` column). Rows are NEVER updated or
 * deleted — the table has no update/delete DAO surface by design. `userId` is the durable app ULID (not an FK:
 * the referenced `users` row is scrubbed but never hard-deleted, and the audit must outlive any given state).
 */
export const lifecycleEvents = pgTable(
    'lifecycle_events',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        /** The app ULID whose account transitioned. Not an FK — the audit is independent of the mutable row. */
        userId: text('user_id').notNull(),
        /** The transition: `closure` | `erasure` | `reactivation`. Stored as text (decoupled from the enum). */
        event: text('event').notNull(),
        /** What initiated it: `user` (self-service), `admin`, `sweep` (12-month auto-erasure), or `system`. */
        triggerSource: text('trigger_source').notNull(),
        /** The acting principal's id (the admin's ULID for admin actions); null for user-self / automated sweeps. */
        actor: text('actor'),
        occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('lifecycle_events_user_id_idx').on(table.userId)],
);

/** A lifecycle transition kind. */
export type LifecycleEventType = 'closure' | 'erasure' | 'reactivation';

/** Who/what initiated a lifecycle transition. */
export type LifecycleTriggerSource = 'user' | 'admin' | 'sweep' | 'system';

export type LifecycleEventRow = InferSelectModel<typeof lifecycleEvents>;
export type NewLifecycleEventRow = InferInsertModel<typeof lifecycleEvents>;
