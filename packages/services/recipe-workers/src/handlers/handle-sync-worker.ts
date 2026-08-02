/**
 * W8-a.2 — the handle-sync CONSUMER Lambda (recipe-workers). Subscribed (via a per-stack SQS queue) to the
 * global `handle-sync` SNS topic, it applies each `{ userId, displayName, sourceTimestamp }` rename to the
 * recipe DB's `author_handles` read model MONOTONICALLY and fans the new name out to the owner's recipes +
 * versions — the same semantics as `recipe-service`'s `AuthorHandlesDal.applyRename`, expressed here in the
 * raw-SQL idiom the recipe-workers Lambdas use over their schema-less handle (mirroring account-erasure).
 *
 * Idempotent + out-of-order safe: an older-or-equal `source_timestamp` is a no-op, so SQS redelivery and
 * cross-route races (the Clerk `user.updated` webhook AND identity's `PATCH /api/v1/users/me` both publish)
 * converge to the actual latest name. A record that fails is reported via `batchItemFailures` so SQS retries
 * ONLY it, never the whole batch.
 *
 * @sideEffect Upserts `author_handles` and updates `recipes` + `recipe_versions` in RDS.
 */
import type { SQSBatchResponse, SQSHandler, SQSRecord } from 'aws-lambda';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { getRecipeDb } from '../common/db.js';
import { logger } from '../common/logger.js';

/** The rename payload both producer routes publish. */
export interface HandleSyncMessage {
    readonly userId: string;
    readonly displayName: string;
    /** ISO-8601 `profiles.updatedAt` written in the same tx as the displayName change (the single clock). */
    readonly sourceTimestamp: string;
}

/**
 * Parse an SQS record body into a {@link HandleSyncMessage}, unwrapping the SNS envelope when the
 * subscription is NOT raw-message-delivery (the default: the payload sits in `.Message` as a JSON string).
 * Returns `undefined` for a structurally-invalid message (dropped, not retried — a retry can't fix bad JSON).
 */
export function parseHandleSyncMessage(record: SQSRecord): HandleSyncMessage | undefined {
    try {
        const outer = JSON.parse(record.body) as { Type?: string; Message?: string } & Partial<HandleSyncMessage>;
        const payload =
            typeof outer.Message === 'string' ? (JSON.parse(outer.Message) as Partial<HandleSyncMessage>) : outer;

        if (
            typeof payload.userId !== 'string' ||
            payload.userId.trim() === '' ||
            typeof payload.displayName !== 'string' ||
            typeof payload.sourceTimestamp !== 'string' ||
            Number.isNaN(Date.parse(payload.sourceTimestamp))
        ) {
            return undefined;
        }

        return { userId: payload.userId, displayName: payload.displayName, sourceTimestamp: payload.sourceTimestamp };
    } catch {
        return undefined;
    }
}

/**
 * Apply one rename to `author_handles` monotonically and fan it out — all in ONE transaction. Returns
 * whether it was applied (`false` when a stale/older event was ignored by the monotonic guard).
 *
 * @sideEffect Upserts `author_handles`, updates `recipes` + `recipe_versions`.
 */
export const applyHandleRename = async (
    db: NodePgDatabase<Record<string, never>>,
    message: HandleSyncMessage,
): Promise<boolean> => {
    return db.transaction(async (tx) => {
        // Monotonic upsert: the ON CONFLICT guard applies a rename ONLY when strictly newer than the stored
        // source_timestamp, so an older or redelivered event can never clobber a newer name.
        const upserted = await tx.execute(sql`
            INSERT INTO author_handles (user_id, display_name, source_timestamp)
            VALUES (${message.userId}, ${message.displayName}, ${message.sourceTimestamp})
            ON CONFLICT (user_id) DO UPDATE
                SET display_name = EXCLUDED.display_name, source_timestamp = EXCLUDED.source_timestamp
                WHERE author_handles.source_timestamp < EXCLUDED.source_timestamp
            RETURNING user_id
        `);

        if (upserted.rows.length === 0) {
            return false;
        }

        await tx.execute(sql`
            UPDATE recipes SET author_handle = ${message.displayName}
            WHERE owner_id = ${message.userId} AND author_handle IS DISTINCT FROM ${message.displayName}
        `);
        await tx.execute(sql`
            UPDATE recipe_versions SET editor_handle = ${message.displayName}
            WHERE created_by = ${message.userId} AND editor_handle IS DISTINCT FROM ${message.displayName}
        `);

        return true;
    });
};

/**
 * SQS handler: apply each rename, reporting per-record failures so SQS retries only the failed message.
 * A message that fails to PARSE is dropped (not a batch failure) — redelivery cannot repair malformed JSON.
 */
export const handler: SQSHandler = async (event): Promise<SQSBatchResponse> => {
    const db = getRecipeDb();
    const batchItemFailures: { itemIdentifier: string }[] = [];

    logger.info('handle-sync-worker invoked', { recordCount: event.Records.length });

    for (const record of event.Records) {
        const message = parseHandleSyncMessage(record);

        if (message === undefined) {
            logger.warn('handle-sync-worker: dropping unparseable message', { messageId: record.messageId });
            continue;
        }

        try {
            const applied = await applyHandleRename(db, message);
            logger.info('handle-sync-worker: rename processed', { userId: message.userId, applied });
        } catch (error) {
            logger.error('handle-sync-worker: rename failed, will retry', { messageId: record.messageId, error });
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }

    return { batchItemFailures };
};
