/**
 * The field schemas every hand-written pins file shares (plan U1, U23): a digest, an upstream file name, a committed
 * file name, and one parse step that turns a pins file's text into its typed shape or refuses it.
 *
 * @pattern Parser — `parsePinsText` is the one door from a pins file's text to a typed value
 * @module
 */
import { z } from 'zod';

import { SourcePinsFormatError } from './usdaSourceArchive.errors.js';

/** A lower-case hex SHA-256. */
export const SHA256 = /^[0-9a-f]{64}$/;

/** A pinned digest. */
export const sha256Schema = z.string().regex(SHA256, 'must be a lower-case hex SHA-256');

/** An upstream name is a bare file name; publishers' own names carry hyphens, underscores and spaces. */
const upstreamNameSchema = z
    .string()
    .regex(/^[^/\\]+$/, 'must be a file name, not a path')
    .refine((name) => name !== '.' && name !== '..', 'must be a file name, not a path');

/** A committed name obeys the repository's file-name rule: camelCase, then an extension. */
export const committedNameSchema = z.string().regex(/^[A-Za-z0-9]+\.[a-z0-9]+$/, 'must be a camelCase file name');

/** An upstream input: its published name and the SHA-256 of its published bytes. */
export const upstreamPinSchema = z.strictObject({ upstream: upstreamNameSchema, upstreamSha256: sha256Schema });

/**
 * Parse a pins file's text against its shape. Pure.
 *
 * ⛔ Pins are edited by hand, deliberately. No tool writes a pins file: a pin written by the tool whose output it
 * pins proves nothing.
 *
 * @param json - The file's text.
 * @param schema - The file's shape.
 * @returns The pins.
 * @throws {SourcePinsFormatError} when the text is not JSON or not the shape.
 */
export function parsePinsText<Schema extends z.ZodType>(json: string, schema: Schema): z.output<Schema> {
    let value: unknown;

    try {
        value = JSON.parse(json);
    } catch (error) {
        throw new SourcePinsFormatError(error instanceof Error ? error.message : 'not JSON');
    }

    const parsed = schema.safeParse(value);

    if (!parsed.success) {
        throw new SourcePinsFormatError(
            parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
        );
    }

    return parsed.data;
}
