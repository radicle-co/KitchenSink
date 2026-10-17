/**
 * Which catalog entry a by-name food IS, before any source is asked (FOOD-SERVICE-6; ADR-0055 point 4: catalog foods
 * come first).
 *
 * Identity is stricter than search's attachment, on purpose: a match here forwards the food with no source call and no
 * cook involved, so it must never claim an identity the catalog does not hold.
 *
 * - A root is the food when the name equals the root's name or one of its synonyms under the catalog's own identity
 *   key (`normalizeName`, the key `createByName` dedups on). No plural or punctuation folding: `2% milk` is not
 *   `2 milk` (`normalizedKey.ts`).
 * - A variant is the food when the name's ranking tokens are exactly a root name's tokens plus exactly one live
 *   variant's part tokens: the variant rule search attaches by (`matchVariant`), tightened from "contains" to "equals".
 * - Two entries matching is no match: the worker never chooses between foods.
 */
import { describe, expect, it } from 'vitest';

import { identicalCatalogEntryOf, type CatalogNameHit } from '../catalogNameMatch.js';
import { identicalVariant, type VariantCandidate } from '../variantQueryMatch.js';

const BROCCOLI: CatalogNameHit = { id: 'R-broccoli', name: 'Broccoli', aliases: 'calabrese; sprouting broccoli' };
const MILK: CatalogNameHit = { id: 'R-milk', name: 'Milk', aliases: null };
const STEAMED: VariantCandidate = { id: 'V-steamed', parts: [{ text: 'steamed' }] };
const STEAMED_CHOPPED: VariantCandidate = {
    id: 'V-steamed-chopped',
    parts: [{ text: 'steamed' }, { text: 'chopped' }],
};
const RAW: VariantCandidate = { id: 'V-raw', parts: [{ text: 'raw' }] };

/** The live variants of each root, as the matcher's I/O shell reads them. */
function variantsOf(
    table: Record<string, readonly VariantCandidate[]>,
): (rootId: string) => readonly VariantCandidate[] {
    return (rootId) => table[rootId] ?? [];
}

describe('identicalVariant', () => {
    it('is the variant whose part tokens are exactly what the name adds to the root', () => {
        expect(identicalVariant('steamed broccoli', ['Broccoli'], [STEAMED, RAW])).toBe(STEAMED);
    });

    it('reads the inverted catalog spelling the same as the natural one', () => {
        expect(identicalVariant('Broccoli, steamed', ['Broccoli'], [STEAMED, RAW])).toBe(STEAMED);
    });

    it('⛔ is no variant when a variant merely CONTAINS the leftover words — that is attachment, not identity', () => {
        expect(identicalVariant('steamed broccoli', ['Broccoli'], [STEAMED_CHOPPED])).toBeUndefined();
    });

    it('⛔ is no variant when the name leaves a word no variant holds', () => {
        expect(identicalVariant('steamed broccoli florets', ['Broccoli'], [STEAMED])).toBeUndefined();
    });

    it('⛔ is no variant when the name lacks a word of the root it is read against', () => {
        expect(identicalVariant('brisket flat', ['beef brisket'], [{ id: 'V-flat', parts: [{ text: 'flat' }] }])).toBe(
            undefined,
        );
    });

    it('is no variant when the name is the root alone', () => {
        expect(identicalVariant('broccoli', ['Broccoli'], [STEAMED])).toBeUndefined();
    });

    it('is no variant when two live variants carry exactly the leftover words', () => {
        expect(
            identicalVariant(
                'steamed broccoli',
                ['Broccoli'],
                [STEAMED, { id: 'V-steamed-2', parts: [{ text: 'steamed' }] }],
            ),
        ).toBeUndefined();
    });
});

describe('identicalCatalogEntryOf', () => {
    it("is the root whose synonym the name is, under the catalog's identity key", () => {
        expect(identicalCatalogEntryOf('  Calabrese ', [BROCCOLI], variantsOf({}))).toEqual({
            kind: 'root',
            id: 'R-broccoli',
        });
    });

    it('is the root whose own name the name is', () => {
        expect(identicalCatalogEntryOf('BROCCOLI', [BROCCOLI], variantsOf({}))).toEqual({
            kind: 'root',
            id: 'R-broccoli',
        });
    });

    it('⛔ folds no plural into a root identity: the identity key keeps `eggs` and `egg` apart', () => {
        expect(identicalCatalogEntryOf('eggs', [{ id: 'R-egg', name: 'Egg', aliases: null }], variantsOf({}))).toBe(
            undefined,
        );
    });

    it('⛔ folds no punctuation into a root identity: `2 milk` is not `2% milk`', () => {
        expect(
            identicalCatalogEntryOf('2 milk', [{ id: 'R-2pc', name: '2% milk', aliases: null }], variantsOf({})),
        ).toBeUndefined();
    });

    it('is the variant the name names exactly, under its root', () => {
        expect(
            identicalCatalogEntryOf('steamed broccoli', [BROCCOLI], variantsOf({ 'R-broccoli': [STEAMED, RAW] })),
        ).toEqual({ kind: 'variant', id: 'V-steamed' });
    });

    it('reads a variant against a synonym as well as the name', () => {
        expect(
            identicalCatalogEntryOf('raw calabrese', [BROCCOLI], variantsOf({ 'R-broccoli': [STEAMED, RAW] })),
        ).toEqual({ kind: 'variant', id: 'V-raw' });
    });

    it('is nothing when no hit is the name', () => {
        expect(
            identicalCatalogEntryOf('broccoli florets', [BROCCOLI, MILK], variantsOf({ 'R-broccoli': [STEAMED] })),
        ).toBeUndefined();
    });

    it('⛔ is nothing when two catalog entries are the name: the worker never chooses between foods', () => {
        const twin: CatalogNameHit = { id: 'R-calabrese', name: 'Calabrese', aliases: null };

        expect(identicalCatalogEntryOf('calabrese', [BROCCOLI, twin], variantsOf({}))).toBeUndefined();
    });

    it('counts one root reached twice as one entry', () => {
        expect(identicalCatalogEntryOf('broccoli', [BROCCOLI, BROCCOLI], variantsOf({}))).toEqual({
            kind: 'root',
            id: 'R-broccoli',
        });
    });

    it('is nothing for a name with no visible content', () => {
        expect(identicalCatalogEntryOf('   ', [{ id: 'R-blank', name: '', aliases: null }], variantsOf({}))).toBe(
            undefined,
        );
    });
});
