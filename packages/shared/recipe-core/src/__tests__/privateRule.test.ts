import { describe, expect, it } from 'vitest';

import {
    RECIPE_SOURCE_KINDS,
    RecipeSourceType,
    RecipeVisibility,
    UNRECOGNISED_SOURCE_KIND,
    privateRuleOf,
    recipeSourceKindViewSchema,
    usesPremiumCapability,
} from '../index.js';
import type { PrivateRule } from '../index.js';

/**
 * ADR-0073 section 10: which provenance label can go private, and under which rule, is stated ONCE (`privateRuleOf`).
 * The table is keyed by every `RecipeSourceType` value, so a new label with no row fails to compile AND fails the
 * completeness test below.
 */
const EXPECTED: Record<RecipeSourceType, PrivateRule> = {
    [RecipeSourceType.USER_CREATED]: 'slots',
    // ADR-0077 section 6 (owner ruling 2026-10-29, "Any cook, using a slot"): an imported public-web recipe is private
    // within the cook's slots like a recipe they wrote, with no Premium or substantive edit needed.
    [RecipeSourceType.IMPORTED_PUBLIC]: 'slots',
    [RecipeSourceType.IMPORTED_PHYSICAL]: 'privateOnly',
    [RecipeSourceType.IMPORTED_PAID]: 'privateOnly',
};

describe('privateRuleOf', () => {
    it('has an expected row for every source type', () => {
        expect(Object.keys(EXPECTED).sort()).toEqual(Object.values(RecipeSourceType).sort());
    });

    it.each(Object.values(RecipeSourceType).map((sourceType) => [sourceType, EXPECTED[sourceType]] as const))(
        '%s is under the %s rule',
        (sourceType, rule) => {
            expect(privateRuleOf(sourceType, null)).toBe(rule);
        },
    );

    // ADR-0089: a web copy (a pasted web link) is private only. Its label is the same `imported_public` the curator's
    // public-domain text carries, so the KIND is what tells them apart: kind null keeps the row above.
    it.each([
        [RecipeSourceType.IMPORTED_PUBLIC, 'public_web', 'privateOnly'],
        [RecipeSourceType.IMPORTED_PUBLIC, null, 'slots'],
        [RecipeSourceType.USER_CREATED, null, 'slots'],
        [RecipeSourceType.IMPORTED_PHYSICAL, 'book', 'privateOnly'],
        [RecipeSourceType.IMPORTED_PAID, 'paid_site', 'privateOnly'],
    ] as const)('%s with source kind %s is under the %s rule', (sourceType, sourceKind, rule) => {
        expect(privateRuleOf(sourceType, sourceKind)).toBe(rule);
    });

    // A kind a newer server sent that this client does not know FAILS CLOSED: the client offers Public for nothing it cannot
    // name. The server's own rule still decides; this only keeps an old client from offering what it would refuse.
    it.each(Object.values(RecipeSourceType))('%s with an unrecognised kind is private only', (sourceType) => {
        expect(privateRuleOf(sourceType, UNRECOGNISED_SOURCE_KIND)).toBe('privateOnly');
    });
});

describe('recipeSourceKindViewSchema: the wire read of a source kind', () => {
    // Installed clients read `unrecognised` as "a kind I do not know", so it can never be a real kind.
    it('never names a real kind unrecognised', () => {
        expect(RECIPE_SOURCE_KINDS).not.toContain(UNRECOGNISED_SOURCE_KIND);
    });

    it.each(['public_web', 'book', 'paid_site'] as const)('reads the known kind %s as itself', (kind) => {
        expect(recipeSourceKindViewSchema.parse(kind)).toBe(kind);
    });

    it.each(['adapted', 'family', ''])(
        'reads a kind it does not know (%j) as unrecognised, not a failed read',
        (kind) => {
            expect(recipeSourceKindViewSchema.parse(kind)).toBe(UNRECOGNISED_SOURCE_KIND);
        },
    );

    it.each([null, 7, {}])('still refuses a value that is not a kind at all (%j)', (value) => {
        expect(recipeSourceKindViewSchema.safeParse(value).success).toBe(false);
    });
});

describe('no private rule is Premium-only (ADR-0077 section 6)', () => {
    it('the rules are slots and privateOnly, and nothing else', () => {
        expect(new Set(Object.values(EXPECTED))).toEqual(new Set(['slots', 'privateOnly']));
    });

    it.each(Object.values(RecipeSourceType))('%s: keeping it private is never a premium capability', (sourceType) => {
        expect(usesPremiumCapability({ visibility: RecipeVisibility.PRIVATE, sourceType })).toBe(false);
        expect(usesPremiumCapability({ visibility: RecipeVisibility.PUBLIC, sourceType })).toBe(false);
    });
});
