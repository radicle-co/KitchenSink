/**
 * A cited table's pins (plan U23, KTD-20): the published files its extract was read from, one per role, and the
 * committed extract. The published files are not committed, so only the hand-run rebuild reads them; the seed reads
 * the extract, after its bytes match `extractSha256`.
 *
 * A role names what a file is to its extractor (`table`, `foods`, `composition`), never the edition's file name, so
 * a new edition changes the pins and not the extractor.
 *
 * A mirror source (plan U28, KTD-26) also pins its committed snapshots, by role: the publisher's file, the SHA-256 of
 * its published bytes, and the compressed copy committed beside the extract. A preview fills its mirror from that copy
 * and calls no publisher. The pin is of the published bytes, as every upstream pin is, so the copy's compression
 * never decides whether it is the publisher's file.
 *
 * @module
 */
import { z } from 'zod';

import { committedNameSchema, parsePinsText, sha256Schema, upstreamPinSchema } from './pinSchemas.js';

const roleSchema = z.string().regex(/^[a-z][A-Za-z]*$/u, 'a role is one camelCase word');

/** A committed snapshot: the publisher's file and its pin, and the compressed copy committed beside the extract. */
const snapshotPinSchema = upstreamPinSchema.extend({ committed: committedNameSchema });

/** The shape of a cited table's pins. */
export const tableExtractPinsSchema = z.strictObject({
    upstreams: z
        .record(roleSchema, upstreamPinSchema)
        .refine((upstreams) => Object.keys(upstreams).length > 0, 'names no upstream file'),
    extract: committedNameSchema,
    extractSha256: sha256Schema,
    snapshots: z
        .record(roleSchema, snapshotPinSchema)
        .refine((snapshots) => Object.keys(snapshots).length > 0, 'an empty snapshot list is left out, not written')
        .optional(),
});

/** A cited table's pins. */
export type TableExtractPins = z.output<typeof tableExtractPinsSchema>;

/**
 * Parse a cited table's `sourcePins.json`. Pure.
 *
 * @param json - The file's text.
 * @returns The pins.
 * @throws {SourcePinsFormatError} when the text is not JSON or not the shape.
 */
export function parseTableExtractPins(json: string): TableExtractPins {
    return parsePinsText(json, tableExtractPinsSchema);
}
