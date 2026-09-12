/**
 * Drift between a mirror and the committed extract (plan R60). The mirror is a cache and never writes a seeded number
 * (R14), so when the publisher's current values for a cited item differ from the values the seed cites, the sync
 * reports the difference and a seed pull request follows.
 *
 * Only cited items are compared, only on the tags the source's mapper reads, and values are compared as numbers.
 *
 * @pattern Specification — a pure comparison of the publisher's current table with the committed one
 * @module
 */
import Decimal from 'decimal.js';

import type { InfoodsTag } from '../../foods/nutrition/nutrientIdentity.js';
import type { ExtractLine } from '../../foods/seed/archive/sourceExtract.js';
import { isAdapterValidationError } from '../foodSource.errors.js';
import type { MirrorItem } from './mirrorFeed.js';

/** One value that differs. A side that states no value reads `undefined`. */
export interface ValueDrift {
    readonly tag: InfoodsTag;
    readonly extract: string | undefined;
    readonly mirror: string | undefined;
}

/** How one cited item drifted. */
export type MirrorDrift =
    | { readonly kind: 'values'; readonly externalKey: string; readonly differences: readonly ValueDrift[] }
    | { readonly kind: 'unmappable'; readonly externalKey: string; readonly reason: string }
    | { readonly kind: 'absent'; readonly externalKey: string };

/**
 * Whether two extract values state the same number, or both state none. Pure.
 *
 * @param left - A value, or `undefined`.
 * @param right - A value, or `undefined`.
 * @returns True when equal as numbers, or both absent.
 */
function sameValue(left: string | undefined, right: string | undefined): boolean {
    if (left === undefined || right === undefined) {
        return left === right;
    }

    return new Decimal(left).equals(right);
}

/**
 * Compare a pull's cited items with the committed extract. Pure.
 *
 * @param items - Every item the source lists.
 * @param extract - The committed extract, by key.
 * @param toLine - The source's mapper from a mirror item to an extract line.
 * @param tags - The tags the mapper reads.
 * @returns One entry per cited item that differs, cannot be mapped, or is no longer listed; items in pull order, then
 *   absent keys in key order.
 * @throws Any error from the mapper other than its validation rejection, which is a bug rather than drift.
 */
export function extractDrift(
    items: readonly MirrorItem[],
    extract: ReadonlyMap<string, ExtractLine>,
    toLine: (item: MirrorItem) => ExtractLine,
    tags: readonly InfoodsTag[],
): MirrorDrift[] {
    const drift: MirrorDrift[] = [];

    for (const item of items) {
        const cited = extract.get(item.externalKey);

        if (cited === undefined) {
            continue;
        }

        let mirrored: ExtractLine;

        try {
            mirrored = toLine(item);
        } catch (error) {
            if (isAdapterValidationError(error)) {
                drift.push({
                    kind: 'unmappable',
                    externalKey: item.externalKey,
                    reason: `${error.field}: ${error.message}`,
                });
                continue;
            }

            throw error;
        }

        const differences = tags.flatMap((tag) =>
            sameValue(cited.values[tag], mirrored.values[tag])
                ? []
                : [{ tag, extract: cited.values[tag], mirror: mirrored.values[tag] }],
        );

        if (differences.length > 0) {
            drift.push({ kind: 'values', externalKey: item.externalKey, differences });
        }
    }

    const listed = new Set(items.map((item) => item.externalKey));

    for (const key of [...extract.keys()].sort()) {
        if (!listed.has(key)) {
            drift.push({ kind: 'absent', externalKey: key });
        }
    }

    return drift;
}
