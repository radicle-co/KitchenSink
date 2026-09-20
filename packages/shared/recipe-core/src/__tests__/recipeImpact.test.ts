/**
 * The count-serving contract (ADR-0030 §8's v1 arm; owner instruction 2026-09-01) — `RecipeDetail.impact`.
 *
 * The detail read now carries the folded lifetime counts (`recipe_impact_signals`): `saveCount` and
 * `viewCount`. ⛔ OPTIONAL on the wire, in one direction only: the SERVER omits the field when the
 * counts are UNKNOWN (an analytics read failure — the detail must never 500 for garnish), and old
 * servers never send it; a fresh recipe is `{ saveCount: 0, viewCount: 0 }`, never an absent field —
 * absent means "unknown", zero means "never". `cookCount` is deliberately NOT on the wire yet: the
 * column is provisioned but unwritten (015/KTD2), and serving a perpetual 0 would be noise a later
 * additive field can replace honestly.
 *
 * The detail schema is NON-STRICT, so without its `impact` line a validating client would silently
 * STRIP the field — the exact regression class `viewerRating`'s test pins one describe over.
 */
import { describe, expect, it } from 'vitest';

import { recipeDetailSchema, recipeImpactSchema } from '../index.js';
import type { RecipeDetail } from '../index.js';
import { makeRecipeDetail } from '../testing/index.js';

function makeDetail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
    return { ...makeRecipeDetail(), ...overrides };
}

describe('recipeImpactSchema (ADR-0030 §8 — the served lifetime counts)', () => {
    it('accepts non-negative integer counts and rejects negatives and fractions', () => {
        expect(recipeImpactSchema.safeParse({ saveCount: 0, viewCount: 0 }).success).toBe(true);
        expect(recipeImpactSchema.safeParse({ saveCount: 412, viewCount: 9001 }).success).toBe(true);
        expect(recipeImpactSchema.safeParse({ saveCount: -1, viewCount: 0 }).success).toBe(false);
        expect(recipeImpactSchema.safeParse({ saveCount: 1.5, viewCount: 0 }).success).toBe(false);
        expect(recipeImpactSchema.safeParse({ saveCount: 1 }).success).toBe(false);
    });
});

describe('recipeDetailSchema — impact (the count-serving field)', () => {
    it('accepts and PRESERVES a present impact object — the non-strict schema must not strip it', () => {
        const parsed = recipeDetailSchema.parse(makeDetail({ impact: { saveCount: 3, viewCount: 7 } }));

        expect(parsed.impact).toEqual({ saveCount: 3, viewCount: 7 });
    });

    it('accepts an ABSENT impact — old servers and the degrade-on-error path both omit it', () => {
        const parsed = recipeDetailSchema.parse(makeDetail());

        expect(parsed.impact).toBeUndefined();
    });

    it('rejects a malformed impact rather than stripping it silently', () => {
        expect(
            recipeDetailSchema.safeParse(makeDetail({ impact: { saveCount: -1, viewCount: 0 } } as never)).success,
        ).toBe(false);
    });
});
