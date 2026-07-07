import type { S3EventRecord, S3Handler } from 'aws-lambda';

import sharp from 'sharp';

import { logger } from '../common/logger.js';

/**
 * S3-event-triggered photo processor. Resizes uploaded recipe photos into a fixed set of derived
 * variants with Sharp. This handler is S3-only and is NOT VPC-attached — it touches no database.
 */

export interface ResizeVariant {
    readonly name: string;
    readonly width: number;
}

/** Derived-image variants generated for every uploaded recipe photo. */
export const RECIPE_PHOTO_VARIANTS: readonly ResizeVariant[] = [
    { name: 'thumb', width: 320 },
    { name: 'card', width: 768 },
    { name: 'hero', width: 1600 },
];

export interface ParsedS3Object {
    readonly bucket: string;
    readonly key: string;
    readonly size: number;
}

/** Extract and URL-decode the bucket/key/size from an S3 event record. */
export const parseS3Record = (record: S3EventRecord): ParsedS3Object => ({
    bucket: record.s3.bucket.name,
    key: decodeURIComponent(record.s3.object.key.replace(/\+/g, ' ')),
    size: record.s3.object.size,
});

/**
 * Resize a source image buffer to a variant's target width, preserving aspect ratio and never
 * upscaling past the original.
 *
 * @sideEffect none — pure transform over the in-memory buffer.
 */
export const resizeRecipePhoto = (source: Buffer, variant: ResizeVariant): Promise<Buffer> =>
    sharp(source).resize({ width: variant.width, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();

const processRecord = async (record: S3EventRecord): Promise<void> => {
    const object = parseS3Record(record);

    logger.info('recipe photo received', { bucket: object.bucket, key: object.key, size: object.size });

    // TODO(Phase 4+): download the source object from S3, generate each RECIPE_PHOTO_VARIANTS
    // derivative via resizeRecipePhoto, and write them to the derived-images prefix. Skip objects
    // already under that prefix so re-uploaded derivatives don't re-trigger this handler.
};

export const handler: S3Handler = async (event) => {
    logger.info('photo-processor invoked', { recordCount: event.Records.length });

    for (const record of event.Records) {
        await processRecord(record);
    }
};
