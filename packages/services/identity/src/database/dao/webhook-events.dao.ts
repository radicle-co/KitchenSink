import { type InferInsertModel } from 'drizzle-orm';
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
