import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

export const webhookEvents = pgTable('webhook_events', {
    svixId: text('svix_id').primaryKey(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    identityId: text('identity_id').notNull(),
    eventType: text('event_type').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
});

export type WebhookEventRow = InferSelectModel<typeof webhookEvents>;
export type NewWebhookEventRow = InferInsertModel<typeof webhookEvents>;
