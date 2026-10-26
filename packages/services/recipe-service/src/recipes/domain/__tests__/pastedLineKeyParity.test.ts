/**
 * Verdict-key PARITY between the paste matcher and the save path (ADR-0071).
 *
 * ⛔ What this guards: the gate's verdict on a paste proposal is stored under the key `matchJudgementOf` computes, and
 * when the cook keeps that food and saves, the save path's producer reads the verdict table by the key IT computes for
 * the saved row. If the two differ the producer pays the gate again for a judgement already on record. They differed:
 * the editor saves a pasted row's measure in the cook's words (`2 tbsp` → unit `tbsp`) while the matcher keyed the
 * parse's canonical unit (`tablespoon`).
 *
 * The editor builds the row with recipe-core's `pastedLineMeasureOf`; these cases build the saved row the same way, run
 * it through the save path's own producer (`buildVerificationRequests`) and derive the key from the message it would
 * send, exactly as the dedup read and the worker do. A matcher that read the measure any other way fails here.
 */
import { describe, expect, it } from 'vitest';

import type { IngredientQuantity } from '@kitchensink/recipe-core';
import { pastedLineMeasureOf, type PastedLineParse } from '@kitchensink/recipe-core/parsing/pasted-line-measure';
import { PROVISIONAL_VERIFICATION_THRESHOLDS } from '@kitchensink/recipe-core/resolution/verification-gate-policy';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';
import { verifiedLineIdentityOfMessage } from '@kitchensink/recipe-core/resolution/verification-message';

import { sha256Hex } from '../../../common/sha256.js';
import { matchJudgementOf } from '../matchProposal.js';
import { buildVerificationRequests } from '../verificationRequests.js';

const FOOD_ID = '01JPARITYFOOD0000000000001';

/** The key the save path's producer reads and the worker writes for the row the editor saves. */
function savePathKey(sourceLine: string, parse: PastedLineParse, foodIndex: number): string {
    const row = pastedLineMeasureOf(parse, foodIndex);
    const plan = buildVerificationRequests({
        recipeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        lines: [
            {
                sourceLine,
                sourcePhrase: undefined,
                food: { kind: 'root', id: FOOD_ID },
                candidateFoodName: 'A food',
                quantity: row.quantity,
                unit: row.unit,
                // A pasted row carries no restatement: the editor sends none.
                statedMeasure: undefined,
            },
        ],
        alreadyRequested: [],
        thresholds: PROVISIONAL_VERIFICATION_THRESHOLDS,
        requestedAt: '2026-10-25T10:00:00.000Z',
    });
    const [message] = plan.requests;

    if (message === undefined) {
        throw new Error('the save path asked nothing about the row');
    }

    return verificationKey(verifiedLineIdentityOfMessage(message), sha256Hex);
}

/** The key the matcher stores on the proposal's row. */
function matcherKey(sourceLine: string, parse: PastedLineParse, foodIndex: number): string {
    const judgement = matchJudgementOf({ sourceLine, ...parse }, foodIndex, FOOD_ID);

    if (judgement === undefined) {
        throw new Error('the matcher asked nothing about the line');
    }

    return verificationKey(judgement, sha256Hex);
}

const exact = (value: number): IngredientQuantity => ({ kind: 'exact', value });

describe('the matcher keys a proposal exactly as the save path keys the row the editor saves', () => {
    it.each([
        ['2 tbsp olive oil', { quantity: exact(2), unit: 'tablespoon', statedMeasure: '2 tbsp' }],
        ['1 T butter', { quantity: exact(1), unit: 'tablespoon', statedMeasure: '1 T' }],
        ['1 t salt', { quantity: exact(1), unit: 'teaspoon', statedMeasure: '1 t' }],
        ['one gill of milk', { quantity: exact(1), unit: 'gill', statedMeasure: 'one gill' }],
        ['2-3 cups flour', { quantity: { kind: 'range', low: 2, high: 3 }, unit: 'cup', statedMeasure: '2-3 cups' }],
        ['a handful of parsley', { quantity: { kind: 'absent' }, unit: null, statedMeasure: 'a handful' }],
        ['3 eggs', { quantity: exact(3), unit: null, statedMeasure: null }],
    ] as const)('for %j', (sourceLine, parse) => {
        expect(matcherKey(sourceLine, parse, 0)).toBe(savePathKey(sourceLine, parse, 0));
    });

    it('for the SECOND food of a line, which the editor saves with no measure', () => {
        const parse = { quantity: exact(2), unit: 'tablespoon', statedMeasure: '2 tbsp' } as const;

        expect(matcherKey('2 tbsp salt and pepper', parse, 1)).toBe(savePathKey('2 tbsp salt and pepper', parse, 1));
    });
});
