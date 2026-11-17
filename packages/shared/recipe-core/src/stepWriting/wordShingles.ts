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
 * and a stored fingerprint matches text typed or pasted in either form. A combining mark never splits a word.
 *
 * Look-alike letters are then folded to the Latin letter they imitate (the `confusables` package, pinned to an exact
 * version), so a Cyrillic `е` in "eggs" cannot hide a copy. The fold is wider than look-alikes: it also strips
 * accents (`café` is `cafe`) and maps other scripts letter by letter by shape, so two different non-Latin words can
 * collide. That is accepted: a check only compares a text with its own source's fingerprint, so a collision can only
 * refuse a text that already matches that source letter for letter after the fold, never miss a copy. It runs before
 * lower-casing and only here: the content digest does not use it (see `contentDigest.ts`). Its output is part of what
 * a stored fingerprint means, and `wordShingles.test.ts` pins it with known answers.
 *
 * Shingles are lower-cased words with punctuation stripped, joined by one space. Apostrophes are removed so
 * "don't" stays one word. A text shorter than the window yields one shingle of all its words, so a short sentence
 * is still comparable; an empty text yields none.
 *
 * Both measures return 0 for empty input: no evidence of overlap is not an overlap. Both REFUSE two fingerprints of
 * different format or key version with a {@link FingerprintMismatchError}: that is "not comparable", never 0.
 */

import { remove } from 'confusables';

import { sanitizeFoodName } from '../foodName.js';
import { FINGERPRINT_KEY_VERSION_MAX, isFingerprintKeyVersion } from './fingerprintKeyring.js';

/** A keyed hash of one shingle, as a signed 64-bit integer. */
export type KeyedHash = (shingle: string) => bigint;

/**
 * The format of {@link Fingerprint}. Stored beside it; bump it when the shingling or the measure changes, and when the
 * text fold changes, including a data change in the `confusables` package (which is pinned for that reason).
 */
export const FINGERPRINT_FORMAT_VERSION = 1;

/** The window sizes in use: 5 words for steps, 2 words for titles. */
export type ShingleSize = 2 | 5;

/**
 * A set of keyed shingle hashes, with the format and the key it was taken under. Never the text.
 *
 * `formatVersion` is a plain number, not the literal, because a stored fingerprint of another format is a value the
 * measures must be able to receive and refuse.
 */
export interface Fingerprint {
    readonly formatVersion: number;
    readonly keyVersion: number;
    readonly hashes: ReadonlySet<bigint>;
}

/** Raised when two fingerprints were taken under a different format or key and so cannot be compared. */
export class FingerprintMismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FingerprintMismatchError';
        Object.setPrototypeOf(this, FingerprintMismatchError.prototype);
    }
}

/** Type guard for {@link FingerprintMismatchError}. */
export function isFingerprintMismatchError(error: unknown): error is FingerprintMismatchError {
    return error instanceof FingerprintMismatchError;
}

/**
 * The lower-cased, punctuation-stripped word windows of `text`, in reading order, duplicates kept.
 */
export function wordShingles(text: string, size: ShingleSize): string[] {
    const words = remove(sanitizeFoodName(text))
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
export function fingerprint(text: string, size: ShingleSize, hash: KeyedHash, keyVersion: number): Fingerprint {
    if (!isFingerprintKeyVersion(keyVersion)) {
        throw new RangeError(
            `A fingerprint needs a key version that is an integer from 1 to ${FINGERPRINT_KEY_VERSION_MAX}.`,
        );
    }

    return {
        formatVersion: FINGERPRINT_FORMAT_VERSION,
        keyVersion,
        hashes: new Set(wordShingles(text, size).map((shingle) => hash(shingle))),
    };
}

/**
 * Refuse a pair taken under a different format or key. Their hashes share no meaning, so a score of 0 would read as
 * "not copied" when the truth is "not comparable".
 */
function assertComparable(a: Fingerprint, b: Fingerprint): void {
    if (a.formatVersion !== b.formatVersion || a.keyVersion !== b.keyVersion) {
        throw new FingerprintMismatchError(
            `Fingerprints differ in format (${a.formatVersion}, ${b.formatVersion}) ` +
                `or key version (${a.keyVersion}, ${b.keyVersion}).`,
        );
    }
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
    assertComparable(a, b);

    const shared = sharedCount(a.hashes, b.hashes);
    const union = a.hashes.size + b.hashes.size - shared;

    return union === 0 ? 0 : shared / union;
}

/** Overlap over `part`: how much of one sentence sits inside a whole. Not symmetric. */
export function containment(part: Fingerprint, whole: Fingerprint): number {
    assertComparable(part, whole);

    return part.hashes.size === 0 ? 0 : sharedCount(part.hashes, whole.hashes) / part.hashes.size;
}
