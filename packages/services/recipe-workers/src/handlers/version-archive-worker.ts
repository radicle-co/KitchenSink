import type { SQSHandler, SQSRecord } from 'aws-lambda';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { requireEnv } from '../common/config.js';
import { getRecipeDb } from '../common/db.js';
import { logger } from '../common/logger.js';

/**
 * SQS-triggered version-archive worker (FR-007b-i). Reads a recipe version from the shared RDS
 * `kitchensink_recipes` database and archives an immutable snapshot to S3. VPC-attached DB consumer.
 */

export interface RecipeVersionArchiveMessage {
    readonly recipeId: string;
    readonly versionId: string;
    /** App-user ULID of the recipe owner (no users table; owner identity is a string reference). */
    readonly ownerId: string;
    /** ISO 8601 timestamp of when the archive was requested. */
    readonly requestedAt: string;
}

export interface RecipeVersionSnapshot {
    readonly recipeId: string;
    readonly versionId: string;
    readonly ownerId: string;
    /** ISO 8601 timestamp of when the snapshot was captured. */
    readonly archivedAt: string;
}

const s3 = new S3Client({});

/** Parse and shape an SQS record body into a typed archive message. */
export const parseArchiveMessage = (record: SQSRecord): RecipeVersionArchiveMessage =>
    JSON.parse(record.body) as RecipeVersionArchiveMessage;

/** Deterministic S3 object key for a recipe version snapshot. */
export const snapshotObjectKey = (message: RecipeVersionArchiveMessage): string =>
    `recipes/${message.ownerId}/${message.recipeId}/versions/${message.versionId}.json`;

/**
 * Load the recipe version rows from `kitchensink_recipes` and serialize an immutable snapshot.
 *
 * @sideEffect reads from RDS.
 */
export const loadVersionSnapshot = async (
    _db: NodePgDatabase<Record<string, never>>,
    message: RecipeVersionArchiveMessage,
): Promise<RecipeVersionSnapshot> => {
    // TODO(Phase 4+): query the recipe, its version row, ingredients, and steps from
    // kitchensink_recipes and assemble the full serialized snapshot body.
    return {
        recipeId: message.recipeId,
        versionId: message.versionId,
        ownerId: message.ownerId,
        archivedAt: new Date().toISOString(),
    };
};

const processRecord = async (record: SQSRecord, archiveBucket: string): Promise<void> => {
    const message = parseArchiveMessage(record);
    const db = getRecipeDb();

    const snapshot = await loadVersionSnapshot(db, message);
    const key = snapshotObjectKey(message);

    await s3.send(
        new PutObjectCommand({
            Bucket: archiveBucket,
            Key: key,
            ContentType: 'application/json',
            Body: JSON.stringify(snapshot),
        }),
    );

    logger.info('recipe version archived', {
        recipeId: message.recipeId,
        versionId: message.versionId,
        bucket: archiveBucket,
        key,
    });
};

export const handler: SQSHandler = async (event) => {
    const archiveBucket = requireEnv('RECIPE_ARCHIVE_BUCKET');

    logger.info('version-archive-worker invoked', { recordCount: event.Records.length });

    for (const record of event.Records) {
        await processRecord(record, archiveBucket);
    }
};
