/**
 * The CONTENT key a line verdict is stored under (plan U11).
 *
 * ⛔ WHY A CONTENT KEY AND NOT `recipe_ingredients.id`. `replaceForRecipe` deletes every row of a recipe's
 * ingredients and re-inserts them with fresh `defaultRandom()` ids on EVERY recipe update. A verdict keyed on
 * that id would therefore (a) be written against a row that no longer exists whenever a message is in flight
 * across an edit, and (b) discard every verdict for the whole recipe on any edit, re-verifying — and
 * re-paying for — every line because one word changed in a step.
 *
 * Keying on the CONTENT of the judgement makes all of that disappear: the write is idempotent by primary key,
 * verdicts survive edits, and the same line appearing in two of the corpus's 448 recipes is verified once.
 *
 * ⚠️ It is also the reason no user text is stored. The key is a digest, so the verdict table holds the
 * judgement without holding the recipe line that produced it.
 */
import { describe, expect, it } from 'vitest';

import {
    VERIFICATION_KEY_VERSION,
    verificationKey,
    verificationKeyPreimage,
    type VerifiedLineIdentity,
} from '../verificationKey.js';

/** A deterministic stand-in for a digest — the identity, so a test can read what was hashed. */
const echo = (input: string): string => input;

const identity = (overrides: Partial<VerifiedLineIdentity> = {}): VerifiedLineIdentity => ({
    sourceLine: '2 cups all-purpose flour',
    foodId: '01JFOOD000000000000000000',
    quantityLow: 2,
    quantityHigh: null,
    unit: 'cup',
    statedMeasure: null,
    ...overrides,
});

/** The plan's headline restatement: the source printed `one gill`, and we persisted `0.5 cup`. */
const GILL = { quantityLow: 1, quantityHigh: null, unit: 'gill' } as const;

describe('verificationKey', () => {
    it('is stable for the same judgement', () => {
        expect(verificationKey(identity(), echo)).toBe(verificationKey(identity(), echo));
    });

    it('carries a version prefix, so a derivation change is a NEW key rather than a wrong one', () => {
        // ⛔ Without this, changing what goes into the preimage silently re-partitions the table: old rows
        // become unreachable AND new rows collide with nothing, so the system would appear to work while
        // every stored verdict quietly stopped applying. A prefix turns that into a visible, additive event.
        expect(verificationKey(identity(), echo).startsWith(`${VERIFICATION_KEY_VERSION}:`)).toBe(true);
    });

    it.each([
        ['the source line', { sourceLine: '2 cups bread flour' }],
        ['the resolved food', { foodId: '01JFOOD000000000000000001' }],
        ['the parsed quantity', { quantityLow: 3 }],
        ['the parsed upper bound', { quantityHigh: 4 }],
        ['the parsed unit', { unit: 'tablespoon' }],
        // U7/U11 — the pair the SOURCE printed. It changes what the model is shown and therefore what it is
        // asked, so by this module's own rule ("everything a verdict is ABOUT") it belongs in the key.
        ['the stated measure appearing', { statedMeasure: GILL }],
        ['the stated amount', { statedMeasure: { ...GILL, quantityLow: 2 } }],
        ['the stated upper bound', { statedMeasure: { ...GILL, quantityHigh: 2 } }],
        ['the stated unit', { statedMeasure: { ...GILL, unit: 'wineglass' } }],
    ])('changes when %s changes', (_label, overrides) => {
        // Every one of these is a thing the verdict is ABOUT. A key that ignored any of them would serve a
        // verdict for a judgement nobody made — the worst possible cache hit, because it looks like a saving.
        expect(verificationKey(identity(overrides), echo)).not.toBe(verificationKey(identity(), echo));
    });

    it('distinguishes an ABSENT bound from a zero one', () => {
        // `quantity_high` is null for an exact quantity and a number for a range. If those collided, "2 cups"
        // and "0–2 cups" would share a verdict.
        expect(verificationKey(identity({ quantityHigh: null }), echo)).not.toBe(
            verificationKey(identity({ quantityHigh: 0 }), echo),
        );
    });

    it('distinguishes an absent unit from an empty one', () => {
        expect(verificationKey(identity({ unit: null }), echo)).not.toBe(verificationKey(identity({ unit: '' }), echo));
    });

    it('cannot be confused by a field boundary', () => {
        // ⛔ THE CLASSIC CONCATENATION BUG. With a naive `a + b` join, `unit: 'cup'` + `foodId: 'X'` and
        // `unit: 'cupX'` + `foodId: ''` produce the same string — so two different judgements share a verdict.
        // JSON encoding of a fixed-order tuple is what makes that unrepresentable.
        expect(verificationKey(identity({ unit: 'cup', foodId: 'X' }), echo)).not.toBe(
            verificationKey(identity({ unit: 'cupX', foodId: '' }), echo),
        );
    });

    it('normalizes the source line to NFC, so one line has one key', () => {
        // The same text typed with a precomposed `\u00e8` and with `e` + a combining grave is the SAME line to
        // a cook and to a model. Two keys for it would double the spend and halve the hit rate, invisibly.
        //
        // ⚠️ The decomposed form is written with ESCAPES on purpose: the two forms are byte-different and
        // pixel-identical, so a literal would be unreviewable — and a first draft of this test silently compared
        // `cr\u00e8me` against `cr\u00e9me`, i.e. two different WORDS, and "failed" against correct code.
        const precomposed = identity({ sourceLine: '2 cups crème fraîche' });
        const decomposed = identity({ sourceLine: '2 cups cre\u0300me frai\u0302che' });

        expect(precomposed.sourceLine).not.toBe(decomposed.sourceLine);
        expect(verificationKey(precomposed, echo)).toBe(verificationKey(decomposed, echo));
    });

    it('collapses whitespace runs and trims, because they are not part of the judgement', () => {
        expect(verificationKey(identity({ sourceLine: '  2   cups all-purpose   flour ' }), echo)).toBe(
            verificationKey(identity({ sourceLine: '2 cups all-purpose flour' }), echo),
        );
    });

    it('does NOT fold case — "Flour" and "flour" are different source text', () => {
        // Contrast `normalizedIngredientKey`, which destroys case ON PURPOSE because it is an
        // equivalence-class key for MATCHING. This one identifies a JUDGEMENT about a specific line, and a
        // model may legitimately read a capitalised proper noun differently.
        expect(verificationKey(identity({ sourceLine: 'Flour' }), echo)).not.toBe(
            verificationKey(identity({ sourceLine: 'flour' }), echo),
        );
    });

    it('passes the digest exactly one argument — the preimage', () => {
        const seen: string[] = [];
        verificationKey(identity(), (input) => {
            seen.push(input);

            return 'digest';
        });

        expect(seen).toEqual([verificationKeyPreimage(identity())]);
    });

    /**
     * ⛔ THE REASON THE VERSION IS `v2` AND NOT `v1`, asserted rather than left to a comment.
     *
     * Before migration 0027 a restated line reached the gate as `[.., 0.5, null, 'cup']` with nothing saying
     * the source had printed `one gill`, and the model — shown `one gill of milk` beside `0.5 cup` — quite
     * correctly DISAGREED. After 0027 the same line is judged against the gill and agrees. Both spellings
     * share every other member of the tuple, so at `v1` the corrected line would have looked up the
     * pre-correction verdict and U14 would have withheld nutrition from it FOREVER — the exact false
     * disagree this whole change exists to delete, made permanent by a cache hit.
     */
    it('is a NEW generation, so no pre-0027 verdict can be served to a corrected line', () => {
        expect(VERIFICATION_KEY_VERSION).toBe('v2');
    });

    // The stated measure is ONE nested member, not three flat ones, so "no restatement" has exactly one
    // spelling (`null`) rather than three coordinated nulls that could disagree.
    it('serializes the stated measure as a single nested member', () => {
        expect(verificationKeyPreimage(identity({ statedMeasure: GILL }))).toBe(
            JSON.stringify([
                VERIFICATION_KEY_VERSION,
                '2 cups all-purpose flour',
                '01JFOOD000000000000000000',
                2,
                null,
                'cup',
                [1, null, 'gill'],
            ]),
        );
        expect(verificationKeyPreimage(identity())).toBe(
            JSON.stringify([
                VERIFICATION_KEY_VERSION,
                '2 cups all-purpose flour',
                '01JFOOD000000000000000000',
                2,
                null,
                'cup',
                null,
            ]),
        );
    });

    // ⛔ The same boundary bug the flat tuple is protected from, one level down: a nested array keeps a
    // stated unit from running into the bound beside it.
    it('cannot confuse a stated field boundary either', () => {
        expect(
            verificationKey(identity({ statedMeasure: { quantityLow: 1, quantityHigh: null, unit: 'gill' } }), echo),
        ).not.toBe(
            verificationKey(identity({ statedMeasure: { quantityLow: 1, quantityHigh: null, unit: 'gil' } }), echo),
        );
    });

    it('produces a preimage that carries no raw user text once hashed', () => {
        // The preimage necessarily contains the line; the KEY must not. This asserts the seam is the digest.
        expect(verificationKey(identity(), () => 'deadbeef')).toBe(`${VERIFICATION_KEY_VERSION}:deadbeef`);
    });
});
