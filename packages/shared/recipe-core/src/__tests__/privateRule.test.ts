import { describe, expect, it } from 'vitest';

import { RecipeSourceType, RecipeVisibility, privateRuleOf, usesPremiumCapability } from '../index.js';
import type { PrivateRule } from '../index.js';

/**
 * ADR-0073 section 10: which provenance label can go private, and under which rule, is stated ONCE (`privateRuleOf`).
 * The table is keyed by every `RecipeSourceType` value, so a new label with no row fails to compile AND fails the
 * completeness test below.
 */
const EXPECTED: Record<RecipeSourceType, PrivateRule> = {
    [RecipeSourceType.USER_CREATED]: 'slots',
    [RecipeSourceType.IMPORTED_PUBLIC]: 'premium',
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
            expect(privateRuleOf(sourceType)).toBe(rule);
        },
    );
});

describe('usesPremiumCapability is derived from privateRuleOf', () => {
    it.each(Object.values(RecipeSourceType))(
        '%s: private uses a premium capability iff its rule is premium',
        (sourceType) => {
            expect(usesPremiumCapability({ visibility: RecipeVisibility.PRIVATE, sourceType })).toBe(
                EXPECTED[sourceType] === 'premium',
            );
            expect(usesPremiumCapability({ visibility: RecipeVisibility.PUBLIC, sourceType })).toBe(false);
        },
    );
});
