/**
 * `ingredientLineIdentity` — the ONE derivation of a recipe line's name and user-entered flag (plan 002 R9,
 * R10, R15).
 *
 * The recipe database stores no food names. A line's name is the failure record's name on the unresolved arm,
 * and food-service's name on a bound arm. When food could not be asked, or will not show the food, the line has
 * NO name: there is no fallback of any kind, and this suite pins that no placeholder appears.
 */
import { describe, expect, it } from 'vitest';

import type { FoodLookupArm, UnresolvedArm } from '../../../database/schema/foodLookupArm.js';
import { canonicalIngredientName } from '../ingredientName.js';
import type { FoodRefAnswer } from '../foodRefAnswer.js';
import {
    catalogStatusOf,
    deriveIngredientLineIdentity,
    isUserEnteredOf,
    lineNameOf,
    MissingLineIdentityError,
    presenceOf,
    requireIngredientLineIdentity,
    shareableLineNameOf,
    shareableVariantPartsOf,
} from '../ingredientLineIdentity.js';

const AT = new Date('2026-09-30T00:00:00.000Z');
const ROOT: FoodLookupArm = { kind: 'root', lookupId: 'l-root', foodId: 'food-1', foodOwnerId: null, createdAt: AT };
const VARIANT: FoodLookupArm = { kind: 'variant', lookupId: 'l-variant', foodVariantId: 'variant-1', createdAt: AT };

function unresolved(
    reasonCode: UnresolvedArm['failure']['reasonCode'],
    status: UnresolvedArm['failure']['status'],
): UnresolvedArm {
    return {
        kind: 'unresolved',
        lookupId: 'l-unresolved',
        createdAt: AT,
        failure: {
            unresolvedFoodId: 'failure-1',
            name: 'nutritional yeast',
            normalizedKey: 'nutritional yeast',
            reasonCode,
            status,
            foodHandleId: reasonCode === 'awaiting_source' ? 'food-9' : null,
            tiersConsulted: [],
            tiersUnavailable: [],
            attempts: 1,
            settledLookupId: null,
        },
    };
}

function answers(entries: readonly (readonly [string, FoodRefAnswer])[]): ReadonlyMap<string, FoodRefAnswer> {
    return new Map(entries);
}

const found = (name: string, status: 'RESOLVED' | 'WITHDRAWN' = 'RESOLVED'): FoodRefAnswer => ({
    outcome: 'found',
    name: canonicalIngredientName(name),
    status,
    isPrivate: false,
    rootId: 'food-1',
});

const FLAT = { id: 'variant-1', parts: [{ attribute: 'cut', text: 'flat' }] };

describe('deriveIngredientLineIdentity', () => {
    it('names an unresolved line from its failure record, and a declared one as the cook’s own', () => {
        const pending = deriveIngredientLineIdentity(unresolved('awaiting_source', 'PENDING'), answers([]));
        const declared = deriveIngredientLineIdentity(unresolved('author_declared', 'UNRESOLVED'), answers([]));

        expect([lineNameOf(pending), isUserEnteredOf(pending), catalogStatusOf(pending)]).toStrictEqual([
            'nutritional yeast',
            false,
            'PENDING',
        ]);
        // A declared line reports no catalog status: nothing is resolving, so the picker has nothing to poll.
        expect([lineNameOf(declared), isUserEnteredOf(declared), catalogStatusOf(declared)]).toStrictEqual([
            'nutritional yeast',
            true,
            undefined,
        ]);
    });

    it('names a bound line from food’s answer, keyed by the arm’s reference', () => {
        const identity = deriveIngredientLineIdentity(ROOT, answers([['root:food-1', found('beef brisket')]]));

        expect([
            lineNameOf(identity),
            isUserEnteredOf(identity),
            catalogStatusOf(identity),
            presenceOf(identity),
        ]).toStrictEqual(['beef brisket', false, 'RESOLVED', 'present']);
    });

    it('keeps a withdrawn food’s name for a reader food still shows it to', () => {
        const identity = deriveIngredientLineIdentity(
            ROOT,
            answers([['root:food-1', found('gran’s filling', 'WITHDRAWN')]]),
        );

        expect([lineNameOf(identity), presenceOf(identity)]).toStrictEqual(['gran’s filling', 'withdrawn']);
    });

    it('⛔ gives NO name when food says the food is absent, or could not be asked — never a placeholder', () => {
        const gone = deriveIngredientLineIdentity(ROOT, answers([['root:food-1', { outcome: 'absent' }]]));
        const down = deriveIngredientLineIdentity(ROOT, answers([['root:food-1', { outcome: 'unreachable' }]]));
        const nameless = deriveIngredientLineIdentity(ROOT, answers([['root:food-1', found('​')]]));

        expect([lineNameOf(gone), presenceOf(gone)]).toStrictEqual([undefined, 'gone']);
        expect([lineNameOf(down), presenceOf(down)]).toStrictEqual([undefined, 'unreachable']);
        // A found food with no usable name is treated as gone rather than shown under an empty name.
        expect([lineNameOf(nameless), presenceOf(nameless)]).toStrictEqual([undefined, 'gone']);
    });

    it('treats a bound line whose reference was never answered as unreachable', () => {
        expect(presenceOf(deriveIngredientLineIdentity(VARIANT, answers([])))).toBe('unreachable');
    });

    it('carries where food says the line’s food lives: its live root, and its variant (curated U9)', () => {
        const root = deriveIngredientLineIdentity(ROOT, answers([['root:food-1', found('beef brisket')]]));
        const variant = deriveIngredientLineIdentity(
            VARIANT,
            answers([
                [
                    'variant:variant-1',
                    {
                        outcome: 'found',
                        name: canonicalIngredientName('beef brisket'),
                        status: 'RESOLVED',
                        isPrivate: false,
                        rootId: 'R-brisket',
                        variant: FLAT,
                    },
                ],
            ]),
        );

        expect(root.food).toStrictEqual({ rootId: 'food-1' });
        expect(variant.food).toStrictEqual({ rootId: 'R-brisket', variant: FLAT });
    });

    it('⛔ carries no food when the line has no name to show: absent, unreachable, nameless or unbound', () => {
        const identities = [
            deriveIngredientLineIdentity(ROOT, answers([['root:food-1', { outcome: 'absent' }]])),
            deriveIngredientLineIdentity(ROOT, answers([['root:food-1', { outcome: 'unreachable' }]])),
            deriveIngredientLineIdentity(ROOT, answers([['root:food-1', found('​')]])),
            deriveIngredientLineIdentity(unresolved('no_source_has_it', 'NOT_FOUND'), answers([])),
        ];

        expect(identities.map((identity) => identity.food)).toStrictEqual([undefined, undefined, undefined, undefined]);
    });

    it('does not confuse a root and a variant that share an id string', () => {
        const identity = deriveIngredientLineIdentity(VARIANT, answers([['root:variant-1', found('wrong food')]]));

        expect(lineNameOf(identity)).toBeUndefined();
    });
});

describe('requireIngredientLineIdentity — the one place absence becomes a refusal', () => {
    it('returns the identity for a known lookup, and throws a named error for a missing one', () => {
        const identity = deriveIngredientLineIdentity(ROOT, answers([['root:food-1', found('beef brisket')]]));
        const byLookup = new Map([['l-root', identity]]);

        expect(requireIngredientLineIdentity(byLookup, 'l-root')).toBe(identity);
        expect(() => requireIngredientLineIdentity(byLookup, 'l-missing')).toThrow(MissingLineIdentityError);
    });
});

describe('shareableLineNameOf — the name every reader of the recipe may see', () => {
    it('is the line’s name for a shared food, a variant and an unresolved line', () => {
        expect(
            shareableLineNameOf({ arm: ROOT, name: 'beef brisket', presence: 'present', food: { rootId: 'food-1' } }),
        ).toBe('beef brisket');
        expect(
            shareableLineNameOf({
                arm: VARIANT,
                name: 'flat-cut brisket',
                presence: 'present',
                food: { rootId: 'R-brisket', variant: FLAT },
            }),
        ).toBe('flat-cut brisket');
        expect(
            shareableLineNameOf({
                arm: unresolved('author_declared', 'UNRESOLVED'),
                name: 'nutritional yeast',
                presence: 'unbound',
            }),
        ).toBe('nutritional yeast');
    });

    it('⛔ is nothing for a PRIVATE food, even when the reader who derived the identity is its author', () => {
        const privateRoot: FoodLookupArm = { ...ROOT, foodOwnerId: 'author-1' };

        expect(
            shareableLineNameOf({
                arm: privateRoot,
                name: 'grandma’s rub',
                presence: 'present',
                food: { rootId: 'food-1' },
            }),
        ).toBeUndefined();
    });
});

describe('shareableVariantPartsOf — the variant parts a version freezes (curated U9)', () => {
    it('is the variant’s parts for a line whose food is a variant', () => {
        expect(
            shareableVariantPartsOf({
                arm: VARIANT,
                name: 'beef brisket',
                presence: 'present',
                food: { rootId: 'R-brisket', variant: FLAT },
            }),
        ).toStrictEqual(FLAT.parts);
    });

    it('is nothing for a root line, and for a line food could not be asked about', () => {
        expect(
            shareableVariantPartsOf({
                arm: ROOT,
                name: 'beef brisket',
                presence: 'present',
                food: { rootId: 'food-1' },
            }),
        ).toBeUndefined();
        expect(shareableVariantPartsOf({ arm: VARIANT, name: undefined, presence: 'unreachable' })).toBeUndefined();
    });
});
