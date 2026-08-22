/**
 * THE TRUTH TABLE for the transcription carry-forward (plan U11/U14).
 *
 * ⛔ THE DEFECT THIS POLICY EXISTS TO FIX WAS A FALSE PREMISE IN A DOCSTRING. `sourceLine` is a create-only
 * wire field (ADR-0023's shape), and the first version of that decision justified itself with: "a
 * metadata-only `PATCH` supplies no `ingredients` and preserves them." That sentence is FALSE against both
 * shipped clients. `toUpdateRecipeInput` (`features/recipes/src/form/model.ts`) destructures `visibility`
 * out of `toCreateRecipeInput(...)` and spreads the rest — and `toCreateRecipeInput` ALWAYS emits
 * `ingredients`. Web and mobile both use it. So there is no metadata-only PATCH from any shipped client, and
 * fixing a typo in an imported recipe's TITLE would have destroyed every source line on it, permanently and
 * silently — after which the verification gate reads `skip: 'no-source-text'` for that recipe forever.
 *
 * The tuple below is not a guess. It is `verificationKeyPreimage`'s digest membership
 * (`@kitchensink/recipe-core/resolution/verification-key`) MINUS the line itself: identity, both quantity
 * bounds, and the unit. That is exactly the set of facts a verdict is ABOUT, so:
 *
 *  - all four unchanged ⇒ the transcription still describes this line ⇒ CARRY IT;
 *  - any one changed ⇒ the judgement is a different judgement ⇒ the old transcription is STALE, and keeping
 *    it would have the gate check our parse of `3 cups` against a source that said `2 cups` and correctly
 *    disagree with a line the author deliberately edited.
 *
 * ⚠️ `name` and `notes` are deliberately NOT in the tuple. `name` is OUR rendering — U3 re-canonicalizes it
 * from food-service the moment a food resolves, so including it would drop every transcription on the first
 * background resolution. `notes` is a display override the author chose and says nothing about what the
 * source stated.
 */
import { describe, expect, it } from 'vitest';

import type { IngredientQuantity } from '@kitchensink/recipe-core';

import {
    carryForwardSourceLines,
    type IncomingLineIdentity,
    type StoredTranscription,
} from '../sourceLineCarryForward.js';

const FLOUR = '00000000-0000-4000-8000-0000000000aa';
const BUTTER = '00000000-0000-4000-8000-0000000000bb';

const exact = (value: number): IngredientQuantity => ({ kind: 'exact', value });

/** One stored line, defaulting to a transcribed `2 cup` of flour. */
const stored = (over: Partial<StoredTranscription> = {}): StoredTranscription => ({
    ingredientId: FLOUR,
    quantity: exact(2),
    unit: 'cup',
    sourceLine: '2 cups all-purpose flour, sifted',
    ...over,
});

/** One incoming line, defaulting to the same identity/quantity/unit as {@link stored}. */
const incoming = (over: Partial<IncomingLineIdentity> = {}): IncomingLineIdentity => ({
    ingredientId: FLOUR,
    quantity: exact(2),
    unit: 'cup',
    ...over,
});

describe('carryForwardSourceLines — the transcription survives an edit that did not change the judgement', () => {
    it('CARRIES the transcription when identity, both bounds and the unit are unchanged', () => {
        expect(carryForwardSourceLines([stored()], [incoming()])).toEqual(['2 cups all-purpose flour, sifted']);
    });

    it('carries NOTHING when there is no stored line to carry from (a create, or a brand-new line)', () => {
        expect(carryForwardSourceLines([], [incoming()])).toEqual([undefined]);
    });

    it('carries NOTHING from a stored line that was itself authored rather than transcribed', () => {
        expect(carryForwardSourceLines([stored({ sourceLine: undefined })], [incoming()])).toEqual([undefined]);
    });

    it.each([
        ['the ingredient identity changed', incoming({ ingredientId: BUTTER })],
        ['the lower bound changed', incoming({ quantity: exact(3) })],
        ['an exact quantity became a range', incoming({ quantity: { kind: 'range', low: 2, high: 3 } })],
        ['the quantity became absent', incoming({ quantity: { kind: 'absent' } })],
        ['the unit changed', incoming({ unit: 'tablespoon' })],
    ])('DROPS the transcription when %s — the judgement is a different judgement', (_label, line) => {
        expect(carryForwardSourceLines([stored()], [line])).toEqual([undefined]);
    });

    // ⛔ The upper bound is in the tuple on its own account. `2–3 cups` and `2–4 cups` share a lower bound,
    // and `quantitiesEqual` is the value object's own identity precisely so an upper-bound-only edit reads as
    // substantive (the same reason `ingredientsChanged` uses it).
    it('DROPS the transcription when ONLY the upper bound changed', () => {
        const ranged = stored({ quantity: { kind: 'range', low: 2, high: 3 } });

        expect(carryForwardSourceLines([ranged], [incoming({ quantity: { kind: 'range', low: 2, high: 4 } })])).toEqual(
            [undefined],
        );
    });

    it('does NOT depend on position — a reordered line keeps its own transcription', () => {
        const flour = stored();
        const butter = stored({ ingredientId: BUTTER, unit: 'tablespoon', sourceLine: '1 tbsp sweet butter' });

        expect(
            carryForwardSourceLines(
                [flour, butter],
                [incoming({ ingredientId: BUTTER, unit: 'tablespoon' }), incoming()],
            ),
        ).toEqual(['1 tbsp sweet butter', '2 cups all-purpose flour, sifted']);
    });

    // ⛔ A MULTISET, not a map. Two lines can legitimately share an identity/quantity/unit tuple ("2 cups
    // flour" twice, for two stages of a dough). A map keyed on the tuple would hand BOTH incoming lines the
    // same stored transcription and silently duplicate one author's words onto a line they never wrote.
    it('consumes each stored transcription AT MOST ONCE for duplicate tuples', () => {
        const first = stored({ sourceLine: '2 cups flour, for the sponge' });
        const second = stored({ sourceLine: '2 cups flour, for the dough' });

        expect(carryForwardSourceLines([first, second], [incoming(), incoming(), incoming()])).toEqual([
            '2 cups flour, for the sponge',
            '2 cups flour, for the dough',
            undefined,
        ]);
    });

    it('leaves the surplus incoming lines without a transcription rather than reusing one', () => {
        expect(carryForwardSourceLines([stored()], [incoming(), incoming()])).toEqual([
            '2 cups all-purpose flour, sifted',
            undefined,
        ]);
    });

    it('is total over an empty incoming set', () => {
        expect(carryForwardSourceLines([stored()], [])).toEqual([]);
    });

    it('returns one entry per incoming line, always — the caller indexes it positionally', () => {
        const result = carryForwardSourceLines([stored()], [incoming(), incoming({ ingredientId: BUTTER })]);

        expect(result).toHaveLength(2);
    });

    it('is PURE — it mutates neither argument', () => {
        const storedLines = [stored()];
        const incomingLines = [incoming()];
        const storedSnapshot = structuredClone(storedLines);
        const incomingSnapshot = structuredClone(incomingLines);

        carryForwardSourceLines(storedLines, incomingLines);

        expect(storedLines).toEqual(storedSnapshot);
        expect(incomingLines).toEqual(incomingSnapshot);
    });
});
