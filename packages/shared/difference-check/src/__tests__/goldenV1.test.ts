/**
 * The frozen answers of v1 (qse F-5): a changed answer fails here, whichever stage changed it. The pass flags were
 * written by hand from the edit's nature; the measures below them were recorded when v1 was frozen.
 */
import { describe, expect, it } from 'vitest';

import { GOLDEN_V1, GOLDEN_V1_MEASURES, INGREDIENTS_TEXT } from '../__fixtures__/goldenV1.js';
import { differenceCheckV1 } from '../differenceCheckV1.js';

describe('the golden set', () => {
    it('is wide enough to pin the measure: at least 15 passing and 20 failing pairs, all named differently', () => {
        expect(GOLDEN_V1.filter((golden) => golden.pass).length).toBeGreaterThanOrEqual(15);
        expect(GOLDEN_V1.filter((golden) => !golden.pass).length).toBeGreaterThanOrEqual(20);
        expect(new Set(GOLDEN_V1.map((golden) => golden.name)).size).toBe(GOLDEN_V1.length);
    });

    it.each(GOLDEN_V1.map((golden) => [golden.name, golden] as const))('%s', (_name, golden) => {
        const result = differenceCheckV1(golden.baseline, golden.steps);

        expect(result.version).toBe('v1');
        expect(result.pass).toBe(golden.pass);
        expect({
            kept: result.kept,
            total: result.total,
            longestRun: result.longestRun,
            newWords: result.newWords,
        }).toEqual(GOLDEN_V1_MEASURES[golden.name]);
    });

    it('records the measures of every case, and of no other', () => {
        expect(Object.keys(GOLDEN_V1_MEASURES).sort()).toEqual(GOLDEN_V1.map((golden) => golden.name).sort());
    });

    it('lists, for every base, only ingredients its own text names', () => {
        const bases = GOLDEN_V1.filter((golden) => !golden.name.startsWith('devanagari')).map(
            (golden) => golden.baseline,
        );

        for (const [dish, ingredientsText] of Object.entries(INGREDIENTS_TEXT)) {
            const baseline = bases.find((text) =>
                GOLDEN_V1.some((golden) => golden.name.startsWith(`${dish}:`) && golden.baseline === text),
            );

            for (const word of ingredientsText.toLowerCase().match(/[a-z]+/g) ?? []) {
                expect(baseline?.toLowerCase(), `${dish}: ${word}`).toContain(word.replace(/s$/u, ''));
            }
        }
    });
});
