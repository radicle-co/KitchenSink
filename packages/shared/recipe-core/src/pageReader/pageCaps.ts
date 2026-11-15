/**
 * The bounds on reading a pasted page, in one place (blueprint §4). A page is hostile input and every number here is a
 * refusal point: the paste is never cut short to fit one, and nothing is read past one.
 */

/** The most UTF-8 bytes a paste may hold, counted in bytes and checked before anything is parsed. About 4 times the largest measured page. */
export const MAX_PASTE_BYTES = 2_000_000;

/**
 * More characters than this (UTF-16 units, which is what the name says) and not a page: the paste box shows a card instead
 * of the text. A named limit of the paste screen's spec (§5.1) that lives with the other caps so no screen repeats a literal.
 */
export const PASTE_CARD_THRESHOLD_CHARS = 20_000;

/** The longest image address kept, in characters. An image address is never fetched. */
export const MAX_IMAGE_URL_CHARS = 2_000;

/** The most `<script type="application/ld+json">` blocks read; the rest are ignored. Real pages carry one to five. */
export const MAX_JSON_LD_BLOCKS = 16;

/** The most UTF-8 bytes of one JSON-LD block that are handed to `JSON.parse`; a larger block is skipped. */
export const MAX_JSON_LD_BLOCK_BYTES = 262_144;

/** The most Recipe items read from a page's microdata, in page order. A page with more is not one recipe's page. */
export const MAX_MICRODATA_RECIPES = 64;

/** The deepest nesting a walk over parsed JSON-LD or microdata descends to. */
export const MAX_WALK_DEPTH = 32;

/** The most nodes one walk visits, and the most one element's text is read from. */
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

/** What a paste is, for the paste box: nothing, over the cap, a page, long text, or short text. */
export type PasteKind = 'empty' | 'tooLarge' | 'page' | 'longText' | 'shortText';

/** The marks of a pasted page, lower case. A bare `<` is not one: "&lt; 1 tsp" and "bake < 20 minutes" are text. */
const PAGE_MARKS: readonly string[] = ['<html', '<script', 'application/ld+json'];

/**
 * What a paste is. The ONE rule for "is this a page" and "is this too large": the paste box and `readPastedContent` both
 * ask it (the paste spec, §5.1), so the screen and the reader cannot disagree.
 *
 * @param text - Everything the cook pasted.
 * @returns `empty` when blank; `tooLarge` over {@link MAX_PASTE_BYTES} UTF-8 bytes; `page` when it holds `<html`, `<script`
 *   or `application/ld+json` in any case; `longText` over {@link PASTE_CARD_THRESHOLD_CHARS} characters; else `shortText`. Pure.
 */
export function classifyPaste(text: string): PasteKind {
    if (text.trim() === '') {
        return 'empty';
    }

    if (!fitsInBytes(text, MAX_PASTE_BYTES)) {
        return 'tooLarge';
    }

    const lower = text.toLowerCase();

    if (PAGE_MARKS.some((mark) => lower.includes(mark))) {
        return 'page';
    }

    return text.length > PASTE_CARD_THRESHOLD_CHARS ? 'longText' : 'shortText';
}
