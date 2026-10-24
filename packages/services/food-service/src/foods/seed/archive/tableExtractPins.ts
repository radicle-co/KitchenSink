/**
 * A cited table's pins (plan U23, KTD-20): the published files its extract was read from, one per role, and the
 * committed extract. The published files are not committed, so only the hand-run rebuild reads them; the seed reads
 * the extract, after its bytes match `extractSha256`.
 *
 * A role names what a file is to its extractor (`table`, `foods`, `composition`), never the edition's file name, so
 * a new edition changes the pins and not the extractor.
 *
 * @module
 */
import { z } from 'zod';

import { committedNameSchema, parsePinsText, sha256Schema, upstreamPinSchema } from './pinSchemas.js';

const roleSchema = z.string().regex(/^[a-z][A-Za-z]*$/u, 'a role is one camelCase word');

/** The shape of a cited table's pins. */
export const tableExtractPinsSchema = z.strictObject({
    upstreams: z
        .record(roleSchema, upstreamPinSchema)
        .refine((upstreams) => Object.keys(upstreams).length > 0, 'names no upstream file'),
    extract: committedNameSchema,
    extractSha256: sha256Schema,
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
