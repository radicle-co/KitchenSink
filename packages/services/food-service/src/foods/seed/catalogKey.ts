/**
 * The natural keys of the seeded catalog (plan KTD-8).
 *
 * @pattern Value Object — each key is a string whose spelling is its identity, parsed at the boundary
 *
 * - An item's natural key is `fdc:<id>`.
 * - A root that stands for no USDA item has a `curated:<slug>` seed key, and its item takes that key as its
 *   own natural key (KTD-6).
 *
 * Keys are frozen at first commit, so each has exactly one spelling: no leading zero, no sign, no space, no
 * upper case. A second spelling of one key would mint a second row for one thing.
 */

/** A USDA item's natural key. */
export type FdcKey = `fdc:${string}`;

/** The seed key of a root that stands for no USDA item. */
export type CuratedKey = `curated:${string}`;

/** A root's frozen seed key. */
export type SeedKey = FdcKey | CuratedKey;

/** An item's natural key: a USDA item's `fdc:<id>`, or the seed key of the sourceless root that owns it. */
export type ItemKey = FdcKey | CuratedKey;

const FDC_KEY = /^fdc:([1-9][0-9]*)$/;
const CURATED_KEY = /^curated:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Build an item key from an FDC id. Pure.
 *
 * @param fdcId - A positive safe-integer FDC id.
 * @returns `fdc:<id>`.
 * @throws {RangeError} when the id is not a positive safe integer.
 */
export function fdcKey(fdcId: number): FdcKey {
    if (!Number.isSafeInteger(fdcId) || fdcId <= 0) {
        throw new RangeError(`${String(fdcId)} is not an FDC id.`);
    }

    return `fdc:${String(fdcId)}`;
}

/**
 * The FDC id inside an item key. Pure.
 *
 * @param key - An `fdc:<id>` key.
 * @returns The numeric id.
 * @throws {RangeError} when the key is not a well-formed `fdc:<id>`.
 */
export function fdcIdOf(key: FdcKey): number {
    const text: string = key;

    if (!isFdcKey(key)) {
        throw new RangeError(`'${text}' is not an FDC item key.`);
    }

    return Number(key.slice('fdc:'.length));
}

/**
 * Whether a value is a well-formed `fdc:<id>` key. Pure.
 *
 * @param value - Any value.
 * @returns `true` for `fdc:` followed by a positive safe integer with no leading zero.
 */
export function isFdcKey(value: unknown): value is FdcKey {
    if (typeof value !== 'string') {
        return false;
    }

    const digits = FDC_KEY.exec(value)?.[1];

    return digits !== undefined && Number.isSafeInteger(Number(digits));
}

/**
 * Whether a value is a well-formed `curated:<slug>` key. Pure.
 *
 * @param value - Any value.
 * @returns `true` for `curated:` followed by lower-case alphanumeric words joined by single hyphens.
 */
export function isCuratedKey(value: unknown): value is CuratedKey {
    return typeof value === 'string' && CURATED_KEY.test(value);
}

/**
 * Whether a value is a well-formed seed key of either spelling. Pure.
 *
 * @param value - Any value.
 * @returns `true` for an `fdc:<id>` or a `curated:<slug>` key.
 */
export function isSeedKey(value: unknown): value is SeedKey {
    return isFdcKey(value) || isCuratedKey(value);
}
