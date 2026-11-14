/**
 * The opaque cursors of the paged lists (ADR-0072 §1; the contract's `nextAfter`).
 *
 * DESIGN PATTERN: **Value codec**, pure and total. A cursor is the client's to hold and never to build; decoding refuses
 * anything else with `undefined`, which the controller answers as a `400`, so a hostile or stale cursor can never reach SQL as
 * a bad parameter (an out-of-range integer would be a Postgres `22003` and a `500`).
 */
import { z } from 'zod';

const INT4_MAX = 2_147_483_647;

const lineCursorSchema = z.strictObject({
    o: z.number().int().min(0).max(INT4_MAX),
    l: z.number().int().min(0).max(INT4_MAX),
    f: z.number().int().min(0).max(INT4_MAX),
});

const importListCursorSchema = z.strictObject({ c: z.iso.datetime(), i: z.uuid() });

/** A position in the flagged or to-check list: after this (item, line, food). */
export interface LineCursor {
    readonly ordinal: number;
    readonly lineIndex: number;
    readonly foodIndex: number;
}

/** A position in the list of the caller's imports: after this one, newest first. */
export interface ImportListCursor {
    readonly createdAt: string;
    readonly id: string;
}

/** Decode base64url JSON, or `undefined` when it is neither. Pure. */
function decodeJson(cursor: string): unknown {
    try {
        return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    } catch {
        return undefined;
    }
}

/**
 * Encode a position in a line list.
 *
 * @param cursor - The position.
 * @returns An opaque string. Pure.
 */
export function encodeLineCursor(cursor: LineCursor): string {
    return Buffer.from(JSON.stringify({ o: cursor.ordinal, l: cursor.lineIndex, f: cursor.foodIndex })).toString(
        'base64url',
    );
}

/**
 * Decode a line-list cursor.
 *
 * @param cursor - What the client sent back.
 * @returns The position, or `undefined` when it is not one this service issued. Pure and total.
 */
export function decodeLineCursor(cursor: string): LineCursor | undefined {
    const parsed = lineCursorSchema.safeParse(decodeJson(cursor));

    return parsed.success ? { ordinal: parsed.data.o, lineIndex: parsed.data.l, foodIndex: parsed.data.f } : undefined;
}

/**
 * Encode a position in the list of imports.
 *
 * @param cursor - The import to continue after.
 * @returns An opaque string. Pure.
 */
export function encodeImportListCursor(cursor: ImportListCursor): string {
    return Buffer.from(JSON.stringify({ c: cursor.createdAt, i: cursor.id })).toString('base64url');
}

/**
 * Decode an import-list cursor.
 *
 * @param cursor - What the client sent back.
 * @returns The position, or `undefined` when it is not one this service issued. Pure and total.
 */
export function decodeImportListCursor(cursor: string): ImportListCursor | undefined {
    const parsed = importListCursorSchema.safeParse(decodeJson(cursor));

    return parsed.success ? { createdAt: parsed.data.c, id: parsed.data.i } : undefined;
}
