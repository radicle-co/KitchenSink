import { eq, type InferInsertModel } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { webhookEvents } from '@kitchensink/identity-service/database/schema';

/**
 * Dedup pre-check: has this svix-id already been processed? Webhook handling is confirm-after-process
 * (the svix-id is recorded only once its handler succeeds — see `recordOnce`), so a delivery whose
 * id is already present is a duplicate of a prior success and can be short-circuited.
 */
export async function hasProcessedWebhookEvent(
    db: PostgresJsDatabase<Record<string, never>>,
    svixId: string,
): Promise<boolean> {
    const rows = await db
        .select({ svixId: webhookEvents.svixId })
        .from(webhookEvents)
        .where(eq(webhookEvents.svixId, svixId))
        .limit(1);

    return rows.length === 1;
}

/**
 * Record an svix-id as processed AFTER its handler succeeds (confirm-after-process). Keyed on the
 * `svix_id` primary key — svix guarantees a unique id per delivery, so it is the natural idempotency
 * anchor. Idempotent via `onConflictDoNothing` on the PK: a concurrent duplicate that already
 * recorded the id is a harmless no-op. `identity_id`/`event_type` are stored for observability only
 * (no uniqueness — migration 0008 dropped the bad `(identity_id, event_type)` constraint).
 */
export async function recordOnce(
    db: PostgresJsDatabase<Record<string, never>>,
    svixId: string,
    identityId: string,
    eventType: string,
): Promise<void> {
    await db
        .insert(webhookEvents)
        .values({ svixId, identityId, eventType } satisfies InferInsertModel<typeof webhookEvents>)
        .onConflictDoNothing({ target: webhookEvents.svixId });
}
