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
 * `null`, the two quantity bounds, and the unit's empty-string spelling of "none". That mapping is the thing
 * that can differ while both sides still look correct in isolation.
 */
import { describe, expect, it } from 'vitest';
import { ABSENT_QUANTITY, type IngredientQuantity } from '@kitchensink/recipe-core';
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
}

/**
 * The preimage the PRODUCER would send for this line — recovered from the message it actually builds, not
 * from any internal helper, so the assertion pins the wire the consumer receives.
 */
function producerPreimage(line: StoredLine): string {
    const { requests } = buildVerificationRequests({
        recipeId: '00000000-0000-4000-8000-00000000e001',
        lines: [{ ...line, foodId: FOOD_ID, candidateFoodName: 'Plain flour' }],
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
            { sourceLine: SOURCE_LINE, quantity: { kind: 'exact', value: 2 }, unit: 'cup' },
        ],
        [
            'a stated RANGE, both bounds',
            { sourceLine: '2 to 3 cups of flour', quantity: { kind: 'range', low: 2, high: 3 }, unit: 'cup' },
        ],
        ['an ABSENT quantity', { sourceLine: 'butter the size of an egg', quantity: ABSENT_QUANTITY, unit: 'knob' }],
        [
            "a UNITLESS line — the column spells it `''`, the wire spells it `null`",
            { sourceLine: '2 eggs, beaten', quantity: { kind: 'exact', value: 2 }, unit: '' },
        ],
        [
            // ⛔ THE REACHABLE DIVERGENCE. `recipeIngredientUnitSchema` is `z.string().min(1)` with NO
            // `.trim()`, so a single space PASSES the wire and is persisted verbatim into a `NOT NULL`
            // column. The producer treats it as no unit; a reader comparing against `''` alone would treat
            // it as the unit `' '` — two keys for one judgement, and every verdict for such a line lost.
            'a WHITESPACE-ONLY unit, which the wire admits',
            { sourceLine: '2 eggs, beaten', quantity: { kind: 'exact', value: 2 }, unit: ' ' },
        ],
        [
            'a unit that merely has surrounding space — the value itself is preserved, not trimmed away',
            { sourceLine: '2 cups of flour', quantity: { kind: 'exact', value: 2 }, unit: ' cup ' },
        ],
    ])('derives one identity for %s', (_name, line) => {
        expect(readerPreimage(line)).toBe(producerPreimage(line));
    });

    it('⛔ still distinguishes two genuinely different judgements — parity is not collapse', () => {
        // Guards the degenerate way to make the cases above pass: a mapping that answered the same thing for
        // everything would agree perfectly and verify nothing.
        const unitless = readerPreimage({ sourceLine: '2 eggs', quantity: { kind: 'exact', value: 2 }, unit: '' });
        const withUnit = readerPreimage({ sourceLine: '2 eggs', quantity: { kind: 'exact', value: 2 }, unit: 'each' });

        expect(unitless).not.toBe(withUnit);
    });
});
