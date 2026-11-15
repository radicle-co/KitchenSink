/**
 * The bounds on reading a pasted page, in one place (blueprint §4). A page is hostile input and every number here is a
 * refusal point: the paste is never cut short to fit one, and nothing is read past one.
 */

/** The most UTF-8 bytes a paste may hold, counted in bytes and checked before anything is parsed. About 4 times the largest measured page. */
export const MAX_PASTE_BYTES = 2_000_000;

/** The most `<script type="application/ld+json">` blocks read; the rest are ignored. Real pages carry one to five. */
export const MAX_JSON_LD_BLOCKS = 16;

/** The most UTF-8 bytes of one JSON-LD block that are handed to `JSON.parse`; a larger block is skipped. */
export const MAX_JSON_LD_BLOCK_BYTES = 262_144;

/** The deepest nesting a walk over parsed JSON-LD or microdata descends to. */
export const MAX_WALK_DEPTH = 32;

/** The most nodes one walk visits. */
export const MAX_WALK_NODES = 10_000;

const UTF8_MAX_BYTES_PER_UTF16_UNIT = 3;
const ENCODER = new TextEncoder();

/**
 * The size of `text` in UTF-8 bytes. A text whose size is certain either way (every UTF-16 unit is at least one byte and
 * at most three) is not encoded.
 *
 * @param text - Any text.
 * @returns The number of bytes `TextEncoder` would produce. Pure.
 */
export function utf8ByteLength(text: string): number {
    return ENCODER.encode(text).length;
}

/**
 * Whether `text` is within `maxBytes` of UTF-8, without encoding it when its length alone decides.
 *
 * @param text - Any text.
 * @param maxBytes - The most bytes allowed.
 * @returns `true` when the text is at most `maxBytes` bytes. Pure.
 */
export function fitsInBytes(text: string, maxBytes: number): boolean {
    if (text.length > maxBytes) {
        return false;
    }

    return text.length * UTF8_MAX_BYTES_PER_UTF16_UNIT <= maxBytes || utf8ByteLength(text) <= maxBytes;
}
