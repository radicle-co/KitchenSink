/**
 * The three-valued foodness reader (plan U6) — could-not-judge is NEVER a verdict, and the
 * taxonomy-vs-boolean contradiction check is holdout-evidenced, not defensive decoration.
 */
import { describe, expect, it } from 'vitest';

import { readFoodnessAnswer } from '../foodnessAnswer.js';

describe('judged answers', () => {
    it('reads the exact shape the prompt demands', () => {
        expect(readFoodnessAnswer('{"isFood": true, "taxonomy": "biscuit"}', 'end_turn')).toEqual({
            kind: 'judged',
            isFood: true,
            taxonomy: 'biscuit',
        });
    });

    it('reads a negative verdict with its taxonomy — `mixing bowl whip` → false/equipment-class', () => {
        expect(readFoodnessAnswer('{"isFood": false, "taxonomy": "equipment"}', 'end_turn')).toEqual({
            kind: 'judged',
            isFood: false,
            taxonomy: 'equipment',
        });
    });

    it('extracts the first JSON object out of surrounding prose', () => {
        const reading = readFoodnessAnswer(
            'Sure! {"isFood": true, "taxonomy": "vegetable"} Hope that helps.',
            'end_turn',
        );

        expect(reading).toMatchObject({ kind: 'judged', isFood: true });
    });

    it('an isFood:false verdict stands whatever its taxonomy — the markers gate TRUE only', () => {
        expect(readFoodnessAnswer('{"isFood": false, "taxonomy": "unknown word"}', 'end_turn')).toMatchObject({
            kind: 'judged',
            isFood: false,
        });
    });
});

describe('could-not-judge — absence, never a verdict', () => {
    it('⛔ a TRUNCATED answer is could-not-judge even when a JSON object survived the cut', () => {
        expect(readFoodnessAnswer('{"isFood": true, "taxonomy": "fruit"}', 'max_tokens')).toEqual({
            kind: 'could-not-judge',
            reason: 'truncated',
        });
    });

    it('no JSON at all', () => {
        expect(readFoodnessAnswer('It depends on the context.', 'end_turn')).toEqual({
            kind: 'could-not-judge',
            reason: 'no-json',
        });
    });

    it('a wrong shape — extra keys are chat, missing keys are a hedge', () => {
        expect(readFoodnessAnswer('{"isFood": true}', 'end_turn')).toMatchObject({ reason: 'bad-shape' });
        expect(
            readFoodnessAnswer('{"isFood": true, "taxonomy": "fruit", "confidence": 0.9}', 'end_turn'),
        ).toMatchObject({ reason: 'bad-shape' });
    });

    it('⛔ the CONSISTENCY CROSS-CHECK: isFood true beside a non-food taxonomy is a hedge, not a verdict', () => {
        // Holdout-evidenced: most residual errors were exactly this internal contradiction.
        for (const taxonomy of ['unknown word', 'kitchen equipment', 'Unknown term', 'not a food']) {
            expect(readFoodnessAnswer(`{"isFood": true, "taxonomy": "${taxonomy}"}`, 'end_turn')).toEqual({
                kind: 'could-not-judge',
                reason: 'contradiction',
            });
        }
    });
});
