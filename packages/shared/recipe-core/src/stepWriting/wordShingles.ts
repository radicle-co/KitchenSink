/**
 * THE WORDING FINGERPRINT: word shingles reduced to a versioned set of keyed hashes.
 *
 * DESIGN PATTERN: **value object + Port**. A {@link Fingerprint} is an immutable set with a format version, and the
 * keyed hash is injected as a {@link KeyedHash} Port, so this module is pure and `recipe-core` takes no crypto
 * dependency. Callers supply a keyed hash (an HMAC under the current key of the keyring) and compare fingerprints,
 * never text, which is what lets a stored fingerprint measure closeness to a text that is no longer held.
 *
 * Text goes through the package's one text canonical form (`sanitizeFoodName`: NFKC, invisible characters removed,
 * controls as spaces), so composed and decomposed accents are one word, an invisible character never splits a word,
 * and a stored fingerprint matches text typed or pasted in either form. A combining mark with no composed form stays
 * inside its word.
 *
 * Shingles are lower-cased words with punctuation stripped, joined by one space. Apostrophes are removed so
 * "don't" stays one word. A text shorter than the window yields one shingle of all its words, so a short sentence
 * is still comparable; an empty text yields none.
 *
 * Both measures return 0 for empty input: no evidence of overlap is not an overlap.
 */

import { sanitizeFoodName } from '../foodName.js';

/** A keyed hash of one shingle, as a signed 64-bit integer. */
export type KeyedHash = (shingle: string) => bigint;

/** The format of {@link Fingerprint}. Stored beside it; bump it when the shingling or the measure changes. */
export const FINGERPRINT_FORMAT_VERSION = 1;

/** The window sizes in use: 5 words for steps, 2 words for titles. */
export type ShingleSize = 2 | 5;

/** A set of keyed shingle hashes. Never the text. */
export interface Fingerprint {
    readonly formatVersion: typeof FINGERPRINT_FORMAT_VERSION;
    readonly hashes: ReadonlySet<bigint>;
}

/**
 * The lower-cased, punctuation-stripped word windows of `text`, in reading order, duplicates kept.
 */
export function wordShingles(text: string, size: ShingleSize): string[] {
    const words = sanitizeFoodName(text)
        .toLowerCase()
        .replace(/['’]/gu, '')
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
        .split(' ')
        .filter((word) => word !== '');

    if (words.length === 0) {
        return [];
    }

    if (words.length <= size) {
        return [words.join(' ')];
    }

    return Array.from({ length: words.length - size + 1 }, (_, i) => words.slice(i, i + size).join(' '));
}

/**
 * The fingerprint of `text`: each shingle through `hash`, collapsed to a set.
 */
export function fingerprint(text: string, size: ShingleSize, hash: KeyedHash): Fingerprint {
    return {
        formatVersion: FINGERPRINT_FORMAT_VERSION,
        hashes: new Set(wordShingles(text, size).map((shingle) => hash(shingle))),
    };
}

function sharedCount(a: ReadonlySet<bigint>, b: ReadonlySet<bigint>): number {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    let shared = 0;

    for (const value of small) {
        if (large.has(value)) {
            shared += 1;
        }
    }

    return shared;
}

/** Overlap over the union: how alike two whole texts are. Symmetric. */
export function jaccard(a: Fingerprint, b: Fingerprint): number {
    const shared = sharedCount(a.hashes, b.hashes);
    const union = a.hashes.size + b.hashes.size - shared;

    return union === 0 ? 0 : shared / union;
}

/** Overlap over `part`: how much of one sentence sits inside a whole. Not symmetric. */
export function containment(part: Fingerprint, whole: Fingerprint): number {
    return part.hashes.size === 0 ? 0 : sharedCount(part.hashes, whole.hashes) / part.hashes.size;
}
