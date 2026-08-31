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

import type { IngredientQuantity, StatedAmount } from '@kitchensink/recipe-core';

import {
    carryForwardTranscription,
    type IncomingLineIdentity,
    type StoredTranscription,
} from '../transcriptionCarryForward.js';

const FLOUR = '00000000-0000-4000-8000-0000000000aa';
const BUTTER = '00000000-0000-4000-8000-0000000000bb';

const exact = (value: number): IngredientQuantity => ({ kind: 'exact', value });

/** The same amount, narrowed to the union a stated measure admits — it can never be `absent`. */
const statedExact = (value: number): StatedAmount => ({ kind: 'exact', value });

/**
 * The carried SOURCE LINES only.
 *
 * ⚠️ REWRITTEN, not weakened. Every case below was originally written against a policy that returned
 * `(string | undefined)[]`, and each still proves exactly the staleness rule it always did — the policy now
 * returns a BUNDLE, because migration 0027 added a second fact with the identical lifecycle (what the source
 * PRINTED before a historical unit was restated), and two carry-forward mechanisms for one rule would be two
 * places for that rule to drift. The bundle's other member has its own describe block at the end of this file.
 *
 * @param storedLines - The recipe's currently persisted lines.
 * @param incomingLines - The lines the update will persist.
 * @returns Just the source line each incoming line inherits. Pure.
 */
const carriedSourceLines = (
    storedLines: readonly StoredTranscription[],
    incomingLines: readonly IncomingLineIdentity[],
): readonly (string | undefined)[] =>
    carryForwardTranscription(storedLines, incomingLines).map((carried) => carried.sourceLine);

/** One stored line, defaulting to a transcribed `2 cup` of flour. */
const stored = (over: Partial<StoredTranscription> = {}): StoredTranscription => ({
    ingredientId: FLOUR,
    quantity: exact(2),
    unit: 'cup',
    sourceLine: '2 cups all-purpose flour, sifted',
    statedMeasure: undefined,
    sourcePhrase: undefined,
    ...over,
});

/** One incoming line, defaulting to the same identity/quantity/unit as {@link stored}. */
const incoming = (over: Partial<IncomingLineIdentity> = {}): IncomingLineIdentity => ({
    ingredientId: FLOUR,
    quantity: exact(2),
    unit: 'cup',
    ...over,
});

describe('carryForwardTranscription — the transcription survives an edit that did not change the judgement', () => {
    it('CARRIES the transcription when identity, both bounds and the unit are unchanged', () => {
        expect(carriedSourceLines([stored()], [incoming()])).toEqual(['2 cups all-purpose flour, sifted']);
    });

    it('carries NOTHING when there is no stored line to carry from (a create, or a brand-new line)', () => {
        expect(carriedSourceLines([], [incoming()])).toEqual([undefined]);
    });

    it('carries NOTHING from a stored line that was itself authored rather than transcribed', () => {
        expect(carriedSourceLines([stored({ sourceLine: undefined })], [incoming()])).toEqual([undefined]);
    });

    it.each([
        ['the ingredient identity changed', incoming({ ingredientId: BUTTER })],
        ['the lower bound changed', incoming({ quantity: exact(3) })],
        ['an exact quantity became a range', incoming({ quantity: { kind: 'range', low: 2, high: 3 } })],
        ['the quantity became absent', incoming({ quantity: { kind: 'absent' } })],
        ['the unit changed', incoming({ unit: 'tablespoon' })],
    ])('DROPS the transcription when %s — the judgement is a different judgement', (_label, line) => {
        expect(carriedSourceLines([stored()], [line])).toEqual([undefined]);
    });

    // ⛔ The upper bound is in the tuple on its own account. `2–3 cups` and `2–4 cups` share a lower bound,
    // and `quantitiesEqual` is the value object's own identity precisely so an upper-bound-only edit reads as
    // substantive (the same reason `ingredientsChanged` uses it).
    it('DROPS the transcription when ONLY the upper bound changed', () => {
        const ranged = stored({ quantity: { kind: 'range', low: 2, high: 3 } });

        expect(carriedSourceLines([ranged], [incoming({ quantity: { kind: 'range', low: 2, high: 4 } })])).toEqual([
            undefined,
        ]);
    });

    it('does NOT depend on position — a reordered line keeps its own transcription', () => {
        const flour = stored();
        const butter = stored({ ingredientId: BUTTER, unit: 'tablespoon', sourceLine: '1 tbsp sweet butter' });

        expect(
            carriedSourceLines([flour, butter], [incoming({ ingredientId: BUTTER, unit: 'tablespoon' }), incoming()]),
        ).toEqual(['1 tbsp sweet butter', '2 cups all-purpose flour, sifted']);
    });

    // ⛔ A MULTISET, not a map. Two lines can legitimately share an identity/quantity/unit tuple ("2 cups
    // flour" twice, for two stages of a dough). A map keyed on the tuple would hand BOTH incoming lines the
    // same stored transcription and silently duplicate one author's words onto a line they never wrote.
    it('consumes each stored transcription AT MOST ONCE for duplicate tuples', () => {
        const first = stored({ sourceLine: '2 cups flour, for the sponge' });
        const second = stored({ sourceLine: '2 cups flour, for the dough' });

        expect(carriedSourceLines([first, second], [incoming(), incoming(), incoming()])).toEqual([
            '2 cups flour, for the sponge',
            '2 cups flour, for the dough',
            undefined,
        ]);
    });

    it('leaves the surplus incoming lines without a transcription rather than reusing one', () => {
        expect(carriedSourceLines([stored()], [incoming(), incoming()])).toEqual([
            '2 cups all-purpose flour, sifted',
            undefined,
        ]);
    });

    it('is total over an empty incoming set', () => {
        expect(carriedSourceLines([stored()], [])).toEqual([]);
    });

    it('returns one entry per incoming line, always — the caller indexes it positionally', () => {
        const result = carriedSourceLines([stored()], [incoming(), incoming({ ingredientId: BUTTER })]);

        expect(result).toHaveLength(2);
    });

    it('is PURE — it mutates neither argument', () => {
        const storedLines = [stored()];
        const incomingLines = [incoming()];
        const storedSnapshot = structuredClone(storedLines);
        const incomingSnapshot = structuredClone(incomingLines);

        carriedSourceLines(storedLines, incomingLines);

        expect(storedLines).toEqual(storedSnapshot);
        expect(incomingLines).toEqual(incomingSnapshot);
    });
});

/**
 * U7/U11 — the SECOND carried fact: what the source PRINTED before a historical unit was restated.
 *
 * ⛔ IT RIDES THE SAME MECHANISM ON PURPOSE, and the reason is the same one that put `sourceLine` here. Both
 * are create-only wire fields (a `PATCH` cannot assert either, because either would let a caller steer a
 * verdict that `ingredient_resolution_memos` then memoizes across users), `replaceForRecipe` swaps the whole
 * line set on every save, and both are stale under EXACTLY the same condition — the tuple a verdict is keyed
 * on moved. A parallel carry-forward for the stated measure would be a second place for one rule to live, and
 * the two would drift silently: a line would keep its gill while losing the transcription it came from, or
 * the reverse, and the gate would be asked about a pair no source ever printed.
 *
 * ⚠️ `statedMeasure` is deliberately NOT in the MATCH tuple, even though it IS in the verification key. The
 * tuple is what the incoming line can assert; a create-only fact cannot be matched on, only carried. That is
 * exactly `sourceLine`'s position, and it is why the module docstring derives the tuple as "digest membership
 * MINUS the line itself" rather than "the whole digest".
 */
/**
 * The THIRD fact in the bundle (owner ruling 2026-08-31, U15 report "Owner rulings" §3): the parsed
 * ingredient phrase — the memo tier's key grain — is create-only wire like its two siblings, swapped away
 * by `replaceForRecipe` on every save, and stale under exactly the same condition. The module docstring
 * called a third carry-forward landing anywhere else the failure mode this file exists to prevent.
 */
describe('carryForwardTranscription — the source phrase rides with the transcription', () => {
    const phrased = (): StoredTranscription => stored({ sourcePhrase: 'all-purpose flour' });

    it('CARRIES the phrase when the judgement is unchanged', () => {
        const [carried] = carryForwardTranscription([phrased()], [incoming()]);

        expect(carried?.sourcePhrase).toBe('all-purpose flour');
    });

    it('DROPS the phrase with the rest of the bundle when the judgement moved', () => {
        const [carried] = carryForwardTranscription([phrased()], [incoming({ quantity: exact(3) })]);

        expect(carried).toEqual({ sourceLine: undefined, statedMeasure: undefined, sourcePhrase: undefined });
    });

    it('carries a transcription with no phrase, which every pre-existing row is', () => {
        const [carried] = carryForwardTranscription([stored()], [incoming()]);

        expect(carried?.sourceLine).toBe('2 cups all-purpose flour, sifted');
        expect(carried?.sourcePhrase).toBeUndefined();
    });
});

describe('carryForwardTranscription — the stated measure rides with the transcription', () => {
    const GILL = { quantity: statedExact(1), unit: 'gill' } as const;

    /** A stored line the importer restated: the source printed `one gill`, we persisted `0.5 cup`. */
    const restated = (over: Partial<StoredTranscription> = {}): StoredTranscription =>
        stored({
            quantity: exact(0.5),
            unit: 'cup',
            sourceLine: 'one gill of milk',
            statedMeasure: GILL,
            ...over,
        });

    /** The same line coming back on an edit that did not touch it. */
    const unchanged = (): IncomingLineIdentity => incoming({ quantity: exact(0.5), unit: 'cup' });

    it('CARRIES both facts together when the judgement is unchanged', () => {
        expect(carryForwardTranscription([restated()], [unchanged()])).toEqual([
            { sourceLine: 'one gill of milk', statedMeasure: GILL },
        ]);
    });

    // ⛔ THE PROPERTY THAT MAKES ONE MECHANISM CORRECT. A title-only edit re-sends every line, so without
    // this a corrected import would silently lose its gill and the gate would go straight back to comparing
    // `one gill of milk` against `0.5 cup` — the exact false disagree this whole change deletes.
    it('a metadata-only edit does not strip the restatement', () => {
        const [carried] = carryForwardTranscription([restated()], [unchanged()]);

        expect(carried?.statedMeasure).toEqual(GILL);
    });

    it.each([
        ['the lower bound changed', incoming({ quantity: exact(0.75), unit: 'cup' })],
        ['the unit changed', incoming({ quantity: exact(0.5), unit: 'tablespoon' })],
        ['the ingredient identity changed', incoming({ ingredientId: BUTTER, quantity: exact(0.5), unit: 'cup' })],
    ])('DROPS BOTH facts when %s', (_label, line) => {
        // ⛔ Both, never one. A stated measure kept beside an amount the author has since edited claims the
        // source printed a gill for a quantity it never printed — a restatement whose two halves describe
        // different lines, which is worse than no restatement at all.
        expect(carryForwardTranscription([restated()], [line])).toEqual([
            { sourceLine: undefined, statedMeasure: undefined },
        ]);
    });

    // The two members are INDEPENDENTLY optional: the dominant line is transcribed and never restated.
    it('carries a transcription with no stated measure, which is the ordinary case', () => {
        expect(carryForwardTranscription([stored()], [incoming()])).toEqual([
            { sourceLine: '2 cups all-purpose flour, sifted', statedMeasure: undefined },
        ]);
    });

    // ⛔ The multiset rule holds for the bundle as a whole — two identical tuples carrying DIFFERENT
    // restatements must not have one of them duplicated onto both lines.
    it('consumes each stored bundle at most once for duplicate tuples', () => {
        const sponge = restated({ sourceLine: 'one gill of milk, for the sponge' });
        const dough = restated({
            sourceLine: 'one gill of milk, for the dough',
            statedMeasure: { quantity: statedExact(2), unit: 'gill' },
        });

        expect(carryForwardTranscription([sponge, dough], [unchanged(), unchanged()])).toEqual([
            { sourceLine: 'one gill of milk, for the sponge', statedMeasure: GILL },
            {
                sourceLine: 'one gill of milk, for the dough',
                statedMeasure: { quantity: statedExact(2), unit: 'gill' },
            },
        ]);
    });
});
