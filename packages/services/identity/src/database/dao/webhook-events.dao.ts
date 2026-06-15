import { eq, type InferInsertModel } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { webhookEvents } from '@kitchensink/identity-service/database/schema';

export async function recordOnce(db: PostgresJsDatabase<Record<string, never>>, svixId: string): Promise<boolean> {
    const rows = await db
        .insert(webhookEvents)
        .values({ svixId, identityId: 'unknown', eventType: 'unknown' } satisfies InferInsertModel<
            typeof webhookEvents
        >)
        .onConflictDoNothing()
        .returning({ svixId: webhookEvents.svixId });

    return rows.length === 1;
}

/**
 * Release a dedup claim made by `recordOnce`. `recordOnce` marks an svix-id processed BEFORE the
 * handler runs (to serialize concurrent deliveries); if the handler then fails, the claim must be
 * released so svix's retry re-processes the event instead of being silently deduped away.
 */
export async function releaseWebhookEvent(
    db: PostgresJsDatabase<Record<string, never>>,
    svixId: string,
): Promise<void> {
    await db.delete(webhookEvents).where(eq(webhookEvents.svixId, svixId));
}
