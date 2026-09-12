/**
 * Drizzle mirror of the verification-gate ATTEMPT substrate (plan U7, migration 0047).
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0047_verification_attempts.sql` is the SOURCE OF
 * TRUTH (repo convention); its header carries the design — why the counter cannot live on the verdict row
 * (a placeholder verdict would be read as a judgement, and an absent verdict is the only thing that
 * publishes), and why the key carries the model id (the verdict store's supersede-on-newer-model rule).
 */
import { pgTable, primaryKey, integer, text, timestamp } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

export const verificationAttempts = pgTable(
    'recipe_verification_attempts',
    {
        /** `{version}:{sha256hex}` over the canonical judgement — the same key the verdict lands under. */
        verificationKey: text('verification_key').notNull(),
        /** The model the attempts were made against; a newer model starts its own cycle. */
        modelId: text('model_id').notNull(),
        /** Deliveries CLAIMED for this line under this model — not failures. */
        attempts: integer('attempts').notNull().default(0),
        /** The claim lease: a duplicate delivered while the first attempt is still running is refused. */
        lastReceivedAt: timestamp('last_received_at', { withTimezone: true }).notNull().defaultNow(),
        /** Why the gate stopped trying; the line then publishes unverified. */
        failureCode: text('failure_code'),
    },
    (table) => [primaryKey({ columns: [table.verificationKey, table.modelId] })],
);

export type VerificationAttemptRow = InferSelectModel<typeof verificationAttempts>;
export type NewVerificationAttemptRow = InferInsertModel<typeof verificationAttempts>;
