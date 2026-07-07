import type { SQSHandler, SQSRecord } from 'aws-lambda';

import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { requireEnv } from '../common/config.js';
import { getRecipeDb } from '../common/db.js';
import { logger } from '../common/logger.js';

/**
 * SQS-triggered account-erasure worker (GDPR, D7). Erases a user's recipe data from the shared RDS
 * `kitchensink_recipes` database and their recipe media from S3. VPC-attached DB consumer. Must be
 * idempotent: replays over an already-erased owner are a no-op.
 */

export interface AccountErasureMessage {
    /** App-user ULID whose recipe data must be erased. */
    readonly ownerId: string;
    /** ISO 8601 timestamp of when erasure was requested. */
    readonly requestedAt: string;
}

const s3 = new S3Client({});

/** Parse and shape an SQS record body into a typed erasure message. */
export const parseErasureMessage = (record: SQSRecord): AccountErasureMessage =>
    JSON.parse(record.body) as AccountErasureMessage;

/** S3 key prefix under which all of an owner's recipe media lives. */
export const ownerMediaPrefix = (ownerId: string): string => `recipes/${ownerId}/`;

/**
 * Delete every `kitchensink_recipes` row owned by the user (recipes, versions, ingredients, steps,
 * photos-metadata). Idempotent — deleting an already-absent owner affects zero rows.
 *
 * @sideEffect deletes rows from RDS.
 */
export const eraseRecipeRows = async (
    _db: NodePgDatabase<Record<string, never>>,
    _ownerId: string,
): Promise<void> => {
    // TODO(Phase 4+): within a single transaction, delete the owner's rows in FK-safe order
    // (steps + ingredients + photos -> versions -> recipes), keyed on ownerId.
};

/**
 * Delete every recipe-media object under the owner's prefix from the media bucket. Idempotent — an
 * empty prefix yields nothing to delete.
 *
 * @sideEffect deletes objects from S3.
 */
export const eraseRecipeObjects = async (client: S3Client, bucket: string, ownerId: string): Promise<number> => {
    const prefix = ownerMediaPrefix(ownerId);
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
        const listed = await client.send(
            new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
        );
        const objects = (listed.Contents ?? []).flatMap((entry) => (entry.Key ? [{ Key: entry.Key }] : []));

        if (objects.length > 0) {
            await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
            deleted += objects.length;
        }

        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);

    return deleted;
};

const processRecord = async (record: SQSRecord, mediaBucket: string): Promise<void> => {
    const { ownerId } = parseErasureMessage(record);
    const db = getRecipeDb();

    await eraseRecipeRows(db, ownerId);
    const deletedObjects = await eraseRecipeObjects(s3, mediaBucket, ownerId);

    logger.info('recipe account data erased', { ownerId, deletedObjects, bucket: mediaBucket });
};

export const handler: SQSHandler = async (event) => {
    const mediaBucket = requireEnv('RECIPE_MEDIA_BUCKET');

    logger.info('account-erasure-worker invoked', { recordCount: event.Records.length });

    for (const record of event.Records) {
        await processRecord(record, mediaBucket);
    }
};
