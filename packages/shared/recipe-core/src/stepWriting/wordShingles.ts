/**
 * THE WORDING FINGERPRINT: word shingles reduced to a versioned set of keyed hashes.
 *
 * DESIGN PATTERN: **value object + Port**. A {@link Fingerprint} is an immutable set with its format, key version and
 * shingle size, and the keyed hash is injected as a {@link KeyedHasher} Port, so this module is pure and `recipe-core`
 * takes no crypto dependency. Callers compare fingerprints, never text, which is what lets a stored fingerprint
 * measure closeness to a text that is no longer held.
 *
 * Text goes through `comparisonForm` (the one fold, applied to both sides), then every run of other punctuation is a
 * gap. Shingles are words joined by one space. A text shorter than the window yields one shingle of all its words, an
 * empty text none.
 *
 * Windows run across sentence and step boundaries: callers pass the source steps joined in order, so no sentence is a
 * window of its own. A sentence of fewer words than the window is therefore skipped by name, with no check of its own;
 * the whole-recipe measure ({@link jaccard}) is what catches a source copied as short sentences.
 *
 * Both measures return 0 for empty input: no evidence of overlap is not an overlap. Both REFUSE two fingerprints of
 * a different format, key version or shingle size with a {@link FingerprintMismatchError}: that is "not comparable",
 * never 0.
 */

import { comparisonForm } from '../comparisonForm.js';
import { FINGERPRINT_KEY_VERSION_MAX, isFingerprintKeyVersion } from './fingerprintKeyring.js';

/** A keyed hash of one shingle, as a signed 64-bit integer. */
export type KeyedHash = (shingle: string) => bigint;

/** A keyed hash together with the version of the key it was made from, so the two cannot be given apart. */
export interface KeyedHasher {
    readonly keyVersion: number;
    readonly hash: KeyedHash;
}

/**
 * The format of {@link Fingerprint}. Stored beside it; bump it when the shingling or the measure changes, and when the
 * text fold (`comparisonForm`) changes.
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
    readonly shingleSize: number;
    readonly hashes: ReadonlySet<bigint>;
}

/** Raised when two fingerprints were taken under a different format, key or shingle size and so cannot be compared. */
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
 * The word windows of `text` over the comparison form, in reading order, duplicates kept.
 */
export function wordShingles(text: string, size: ShingleSize): string[] {
    const words = comparisonForm(text)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
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
export function fingerprint(text: string, size: ShingleSize, { keyVersion, hash }: KeyedHasher): Fingerprint {
    if (!isFingerprintKeyVersion(keyVersion)) {
        throw new RangeError(
            `A fingerprint needs a key version that is an integer from 1 to ${FINGERPRINT_KEY_VERSION_MAX}.`,
        );
    }

    return {
        formatVersion: FINGERPRINT_FORMAT_VERSION,
        keyVersion,
        shingleSize: size,
        hashes: new Set(wordShingles(text, size).map((shingle) => hash(shingle))),
    };
}

/**
 * Refuse a pair taken under a different format or key. Their hashes share no meaning, so a score of 0 would read as
 * "not copied" when the truth is "not comparable".
 */
function assertComparable(a: Fingerprint, b: Fingerprint): void {
    if (a.formatVersion !== b.formatVersion || a.keyVersion !== b.keyVersion || a.shingleSize !== b.shingleSize) {
        throw new FingerprintMismatchError(
            `Fingerprints differ in format (${a.formatVersion}, ${b.formatVersion}), ` +
                `key version (${a.keyVersion}, ${b.keyVersion}) or shingle size (${a.shingleSize}, ${b.shingleSize}).`,
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
