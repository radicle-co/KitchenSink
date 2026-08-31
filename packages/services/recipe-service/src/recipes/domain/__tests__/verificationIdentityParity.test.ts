/**
 * ⛔ THE PRODUCER AND THE READER MUST DERIVE THE SAME JUDGEMENT IDENTITY — asserted, once, in both
 * directions.
 *
 * `verificationRequests.ts` (U11) turns a stored line into the message the gate is asked, and
 * `lineVerification.ts` (U14) turns the SAME stored line into the key a verdict about it is stored under.
 * The verdict table is content-addressed, so those two derivations ARE the join: if they disagree by a
 * single field, the worker writes a row under one key and this service looks for it under another.
 *
 * ⚠️ AND THE FAILURE IS SILENT IN THE SAFE-LOOKING DIRECTION. `0023_line_verifications.sql` establishes that
 * absence of a verdict means PUBLISH, so a mismatched key does not raise, does not log and does not withhold
 * — it reports "the gate has judged nothing" forever, for every line, while the gate is judging and being
 * billed for all of them. `verificationRequests.ts`'s own docstring names this exactly: "Two implementations
 * of that rule would drift, and the drift would be invisible: it would show up only as a bill."
 *
 * Both modules delegate the SERIALIZATION to `verificationKeyPreimage`. What this file pins is the half that
 * lives in this service: the mapping from `recipe_ingredients`' COLUMNS onto that tuple — `sourceLine`'s
 * `null`, the two quantity bounds, the unit's empty-string spelling of "none", and (since migration 0027) the
 * measure the SOURCE printed before a historical unit was restated. That mapping is the thing that can differ
 * while both sides still look correct in isolation.
 *
 * ⚠️ THE STATED MEASURE IS THE NEWEST MEMBER AND THE EASIEST TO DROP, because it is the only one the two ends
 * spell differently on the way in: the reader holds a `StatedMeasure` VALUE OBJECT read out of three columns,
 * while the producer puts a flat `{ quantityLow, quantityHigh, unit }` on the wire. A producer that forgot to
 * emit it would still build a perfectly valid message — and every verdict for a restated line would then be
 * written under a key this service never looks up. The cases below drive both spellings.
 */
import { describe, expect, it } from 'vitest';
import { ABSENT_QUANTITY, type IngredientQuantity, type StatedMeasure } from '@kitchensink/recipe-core';
import { PROVISIONAL_VERIFICATION_THRESHOLDS } from '@kitchensink/recipe-core/resolution/verification-gate-policy';
import { verificationKeyPreimage } from '@kitchensink/recipe-core/resolution/verification-key';

import { verifiedLineIdentity } from '../lineVerification.js';
import { buildVerificationRequests } from '../verificationRequests.js';

const FOOD_ID = '01JFOODPARITY000000000001';
const SOURCE_LINE = '2 cups of plain flour, sifted';

/** One stored line, in the two shapes the two ends each take it in. */
interface StoredLine {
    readonly sourceLine: string;
    readonly quantity: IngredientQuantity;
    readonly unit: string;
    /** What the source PRINTED, when the pair above is a restatement of it (migration 0027). */
    readonly statedMeasure: StatedMeasure | undefined;
}

/** The plan's headline restatement: the source printed `one gill`, and we persisted `0.5 cup`. */
const GILL: StatedMeasure = { quantity: { kind: 'exact', value: 1 }, unit: 'gill' };

/**
 * The preimage the PRODUCER would send for this line — recovered from the message it actually builds, not
 * from any internal helper, so the assertion pins the wire the consumer receives.
 */
function producerPreimage(line: StoredLine): string {
    const { requests } = buildVerificationRequests({
        recipeId: '00000000-0000-4000-8000-00000000e001',
        lines: [{ ...line, foodId: FOOD_ID, candidateFoodName: 'Plain flour', resolutionTier: undefined }],
        alreadyRequested: [],
        thresholds: PROVISIONAL_VERIFICATION_THRESHOLDS,
        requestedAt: '2026-08-22T00:00:00.000Z',
    });
    const message = requests[0];

    expect(message, 'the producer must actually ask about this line').toBeDefined();

    return verificationKeyPreimage({
        sourceLine: message?.sourceLine ?? '',
        foodId: message?.foodId ?? '',
        quantityLow: message?.quantityLow ?? null,
        quantityHigh: message?.quantityHigh ?? null,
        unit: message?.unit ?? null,
        // ⛔ The wire's FLAT shape, read straight back. It is deliberately not reconstructed from `line`:
        // this function exists to pin what the consumer actually receives, so a producer that dropped the
        // member must fail here rather than be papered over by the test's own fixture.
        statedMeasure: message?.statedMeasure ?? null,
    });
}

/** The preimage the READER will look the verdict up under. */
function readerPreimage(line: StoredLine): string {
    const identity = verifiedLineIdentity({ ...line, sourceLine: line.sourceLine }, FOOD_ID);

    expect(identity, 'the reader must recognise this line as judgeable').toBeDefined();

    return identity === undefined ? '' : verificationKeyPreimage(identity);
}

describe('the producer and the reader agree on what a judgement is ABOUT', () => {
    it.each<[string, StoredLine]>([
        [
            'an exact quantity with a unit',
            { sourceLine: SOURCE_LINE, quantity: { kind: 'exact', value: 2 }, unit: 'cup', statedMeasure: undefined },
        ],
        [
            'a stated RANGE, both bounds',
            {
                sourceLine: '2 to 3 cups of flour',
                quantity: { kind: 'range', low: 2, high: 3 },
                unit: 'cup',
                statedMeasure: undefined,
            },
        ],
        [
            'an ABSENT quantity',
            {
                sourceLine: 'butter the size of an egg',
                quantity: ABSENT_QUANTITY,
                unit: 'knob',
                statedMeasure: undefined,
            },
        ],
        [
            "a UNITLESS line — the column spells it `''`, the wire spells it `null`",
            { sourceLine: '2 eggs, beaten', quantity: { kind: 'exact', value: 2 }, unit: '', statedMeasure: undefined },
        ],
        [
            // ⛔ THE REACHABLE DIVERGENCE. `recipeIngredientUnitSchema` is `z.string().min(1)` with NO
            // `.trim()`, so a single space PASSES the wire and is persisted verbatim into a `NOT NULL`
            // column. The producer treats it as no unit; a reader comparing against `''` alone would treat
            // it as the unit `' '` — two keys for one judgement, and every verdict for such a line lost.
            'a WHITESPACE-ONLY unit, which the wire admits',
            {
                sourceLine: '2 eggs, beaten',
                quantity: { kind: 'exact', value: 2 },
                unit: ' ',
                statedMeasure: undefined,
            },
        ],
        [
            'a unit that merely has surrounding space — the value itself is preserved, not trimmed away',
            {
                sourceLine: '2 cups of flour',
                quantity: { kind: 'exact', value: 2 },
                unit: ' cup ',
                statedMeasure: undefined,
            },
        ],
        [
            // ⛔ THE 0027 MEMBER. The reader reads three columns into a value object; the producer flattens it
            // onto the wire. Two spellings of one fact is exactly the shape this file exists to police.
            'a RESTATED line — the source printed a gill, the row holds cups',
            {
                sourceLine: 'one gill of milk',
                quantity: { kind: 'exact', value: 0.5 },
                unit: 'cup',
                statedMeasure: GILL,
            },
        ],
        [
            'a restated line whose SOURCE printed a range',
            {
                sourceLine: 'one to two gills of milk',
                quantity: { kind: 'range', low: 0.5, high: 1 },
                unit: 'cup',
                statedMeasure: { quantity: { kind: 'range', low: 1, high: 2 }, unit: 'gill' },
            },
        ],
    ])('derives one identity for %s', (_name, line) => {
        expect(readerPreimage(line)).toBe(producerPreimage(line));
    });

    it('⛔ still distinguishes two genuinely different judgements — parity is not collapse', () => {
        // Guards the degenerate way to make the cases above pass: a mapping that answered the same thing for
        // everything would agree perfectly and verify nothing.
        const unitless = readerPreimage({
            sourceLine: '2 eggs',
            quantity: { kind: 'exact', value: 2 },
            unit: '',
            statedMeasure: undefined,
        });
        const withUnit = readerPreimage({
            sourceLine: '2 eggs',
            quantity: { kind: 'exact', value: 2 },
            unit: 'each',
            statedMeasure: undefined,
        });

        expect(unitless).not.toBe(withUnit);
    });

    /**
     * ⛔ THE OTHER DIRECTION FOR THE 0027 MEMBER, and the one that would have been missed.
     *
     * A producer that silently dropped `statedMeasure` would still agree with a reader that also dropped it —
     * the cases above would all pass. What breaks then is the DISTINCTION: a restated line and its
     * un-restated self are shown different numbers and reach different verdicts, so they must never share a
     * key. Both ends are checked, so neither can be the one that collapses them.
     */
    it('⛔ a restated line and its un-restated self are different judgements at BOTH ends', () => {
        const restated = {
            sourceLine: 'one gill of milk',
            quantity: { kind: 'exact', value: 0.5 } as const,
            unit: 'cup',
        };

        expect(readerPreimage({ ...restated, statedMeasure: GILL })).not.toBe(
            readerPreimage({ ...restated, statedMeasure: undefined }),
        );
        expect(producerPreimage({ ...restated, statedMeasure: GILL })).not.toBe(
            producerPreimage({ ...restated, statedMeasure: undefined }),
        );
    });
});
