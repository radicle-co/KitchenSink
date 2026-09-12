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

describe('the extraction is linear in the input — model output cannot make the parser slow', () => {
    it('⛔ a wall of opening braces with no close is no-json in linear time, not quadratic', () => {
        // ⛔ RED FIRST against the previous `/\{[\s\S]*?\}/`: on N unmatched `{` that regex re-scans to
        // the end from every candidate start, O(N²). MEASURED on Node 24 rather than estimated — the
        // first draft of this case used 60k characters on an arithmetic guess and PASSED against the old
        // regex (243 ms), which would have shipped a vacuous test: 60k → 243 ms, 250k → 4.2 s,
        // 1M → 68 s; the two-`indexOf` reading is ~0.05 ms at every size. 250k is the smallest round
        // size that blows this case's 2 s timeout under the old code without hanging the suite when it
        // does. CodeQL `js/polynomial-redos` flagged it on 2026-09-04 — `text` is model output, so the
        // thing being parsed could choose to be slow to parse.
        //
        // ⚠️ Honest scale: real answers are `maxTokens`-bounded to a few thousand characters, where the
        // old regex cost ~1 ms. This was a wrong SHAPE with a theoretical exposure, not a live outage.
        const wall = '{'.repeat(250_000);

        expect(readFoodnessAnswer(wall, 'end_turn')).toEqual({ kind: 'could-not-judge', reason: 'no-json' });
    }, 2_000);

    it('still selects the FIRST object, exactly as the non-greedy match did', () => {
        // The regex the index scan replaced chose the first `{` and the first `}` after it. Two objects in
        // prose must resolve to the first; a nested-looking prefix must not swallow the second.
        const text =
            'sure: {"isFood": true, "taxonomy": "ingredient"} and also {"isFood": false, "taxonomy": "equipment"}';

        expect(readFoodnessAnswer(text, 'end_turn')).toEqual({
            kind: 'judged',
            isFood: true,
            taxonomy: 'ingredient',
        });
    });
});
