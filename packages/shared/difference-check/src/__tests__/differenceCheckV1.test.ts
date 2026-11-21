/**
 * `differenceCheckV1`: the three measures, their boundaries (qse F-2), one case per normalisation stage that flips when
 * the stage is removed (qse F-3), the stage order, fail-closed (qse F-4), the runtime pin and the cost bound
 * (qse F-11). Every text is synthetic or our own.
 */
import { describe, expect, it } from 'vitest';

import { synthWord, synthWords, textOf } from '../__fixtures__/synthetic.js';
import { DifferenceCheckError } from '../differenceCheckError.js';
import { baselineQualifiesV1, differenceCheckV1, FROZEN_UNICODE_VERSION } from '../differenceCheckV1.js';
import { runCheck } from '../checkV1.js';
import { foldQuantities } from '../normalise/foldQuantities.js';
import { normaliseWith, V1_TEXT_STAGES, V1_TOKEN_STAGES } from '../normalise/normaliseV1.js';
import { skeletonTokens } from '../normalise/skeleton.js';

/** The check with one named stage left out: what the stage buys is what this changes. */
function withoutStage(stage: keyof typeof V1_TEXT_STAGES | keyof typeof V1_TOKEN_STAGES) {
    const text = Object.entries(V1_TEXT_STAGES)
        .filter(([name]) => name !== stage)
        .map(([, run]) => run);
    const tokens = Object.entries(V1_TOKEN_STAGES)
        .filter(([name]) => name !== stage)
        .map(([, run]) => run);

    return (baseline: string, steps: string) => runCheck(normaliseWith(text, tokens), baseline, steps);
}

describe('measure A: kept three-token shingles, pass when 5 * kept <= total', () => {
    const baseline = synthWords(27);
    const fresh = synthWords(40, 1000);

    it('passes at exactly one fifth kept (5 of 25 shingles)', () => {
        const result = differenceCheckV1(textOf(baseline), textOf([...baseline.slice(0, 7), ...fresh]));

        expect(result).toMatchObject({ version: 'v1', kept: 5, total: 25, pass: true });
    });

    it('fails with one shingle more (6 of 25)', () => {
        const result = differenceCheckV1(textOf(baseline), textOf([...baseline.slice(0, 8), ...fresh]));

        expect(result).toMatchObject({ kept: 6, total: 25, pass: false });
    });
});

describe('measure R: no shared nine-token run', () => {
    const baseline = synthWords(60);
    const fresh = synthWords(40, 1000);

    it('passes a copied run of 8 tokens', () => {
        const result = differenceCheckV1(textOf(baseline), textOf([...baseline.slice(10, 18), ...fresh]));

        expect(result).toMatchObject({ longestRun: 8, pass: true });
    });

    it('fails a copied run of 9 tokens, though A still holds (Covers AE4)', () => {
        const result = differenceCheckV1(textOf(baseline), textOf([...baseline.slice(10, 19), ...fresh]));

        expect(result.longestRun).toBe(9);
        expect(5 * result.kept).toBeLessThanOrEqual(result.total);
        expect(result.pass).toBe(false);
    });
});

describe('measure F: at least five new stemmed words', () => {
    const baseline = synthWords(60);
    /** Every other baseline word: no shared shingle, no new word. */
    const scattered = baseline.filter((_, index) => index % 2 === 0);

    it('passes with 5 new words', () => {
        const result = differenceCheckV1(textOf(baseline), textOf([...scattered, ...synthWords(5, 2000)]));

        expect(result).toMatchObject({ newWords: 5, kept: 0, longestRun: 1, pass: true });
    });

    it('fails with 4 new words', () => {
        const result = differenceCheckV1(textOf(baseline), textOf([...scattered, ...synthWords(4, 2000)]));

        expect(result).toMatchObject({ newWords: 4, pass: false });
    });

    it('adds nothing for new numbers or units alone', () => {
        const withQuantities = `${textOf(scattered)} 2 tbsp 350 ml 25 minutes 9 cm 3 kg`;

        expect(differenceCheckV1(textOf(baseline), withQuantities)).toMatchObject({ newWords: 0, pass: false });
    });

    it('fails when half of the steps are deleted (Covers AE3)', () => {
        const result = differenceCheckV1(textOf(baseline), textOf(baseline.slice(0, 30)));

        expect(result.pass).toBe(false);
        expect(result.newWords).toBe(0);
    });
});

describe('each normalisation stage flips a case when it is removed (qse F-3)', () => {
    const words = synthWords(40);
    const baseline = textOf(words);

    /** A mechanical edit of every word, which v1 must see through. */
    const edits: ReadonlyArray<
        readonly [stage: keyof typeof V1_TEXT_STAGES | keyof typeof V1_TOKEN_STAGES, steps: string]
    > = [
        [
            'nfkc',
            textOf(
                words.map((word) =>
                    word.replace(/./g, (letter) => String.fromCodePoint(letter.charCodeAt(0) + 0xfee0)),
                ),
            ),
        ],
        ['strip', textOf(words.map((word) => `${word.slice(0, 2)}‍${word.slice(2)}`))],
        ['stem', textOf(words.map((word) => `${word}s`))],
    ];

    it.each(edits)('%s: v1 does not earn the edit; without the stage it would', (stage, steps) => {
        expect(differenceCheckV1(baseline, steps).pass).toBe(false);
        expect(withoutStage(stage)(baseline, steps).pass).toBe(true);
    });

    it('lowerCase: a capital I, which the skeleton reads as l, where the lower case reads it as i', () => {
        const lower = textOf(words.map((word) => `${word}i`));
        const capital = textOf(words.map((word) => `${word}I`));

        expect(differenceCheckV1(lower, capital).pass).toBe(false);
        expect(withoutStage('lowerCase')(lower, capital).pass).toBe(true);
    });

    it('skeleton: Cyrillic look-alikes for c, p, x, h and d', () => {
        const lookAlikes: Readonly<Record<string, string>> = {
            c: '\u0441',
            p: '\u0440',
            x: '\u0445',
            h: '\u04bb',
            d: '\u0501',
        };
        const latin = Array.from({ length: 40 }, (_, index) =>
            [3, 2, 1, 0].map((place) => 'cpxhd'[Math.floor(index / 5 ** place) % 5] ?? 'c').join(''),
        );
        const spoofed = latin.map((word) => word.replace(/./g, (letter) => lookAlikes[letter] ?? letter));

        expect(spoofed.every((word, index) => word !== latin[index])).toBe(true);
        expect(differenceCheckV1(textOf(latin), textOf(spoofed)).pass).toBe(false);
        expect(withoutStage('skeleton')(textOf(latin), textOf(spoofed)).pass).toBe(true);
    });

    it('foldQuantities: a quantity-only edit', () => {
        const rows = (numbers: readonly string[], units: readonly string[]) =>
            textOf(
                words.flatMap((word, index) => [
                    word,
                    numbers[index % numbers.length] ?? '',
                    units[index % units.length] ?? '',
                ]),
            );
        const before = rows(['2', '350', '15', '1/2'], ['tbsp', 'ml', 'minutes', 'cups']);
        const after = rows(['4', '180', '30', '3'], ['tsp', 'l', 'hours', 'pints']);

        expect(differenceCheckV1(before, after).pass).toBe(false);
        expect(withoutStage('foldQuantities')(before, after).pass).toBe(true);
    });
});

describe('stage order (KTD-2)', () => {
    const words = synthWords(40);
    const quantityRows = (amount: (index: number) => string) =>
        textOf(words.flatMap((word, index) => [word, amount(index)]));
    /** Numbers written with the digits 0 and 1 only, which the skeleton reads as o and l: 10, 11, 100, 101, ... */
    const binary = (value: number): string => value.toString(2);

    /** The check with the skeleton moved BEFORE the number and unit fold: the order the plan forbids. */
    const skeletonFirst = (baseline: string, steps: string) =>
        runCheck(
            normaliseWith(Object.values(V1_TEXT_STAGES), [
                (tokens) => skeletonTokens(tokens),
                (tokens) => foldQuantities(tokens),
                V1_TOKEN_STAGES.stem,
            ]),
            baseline,
            steps,
        );

    it('a quantity-only edit whose numbers hold 0 and 1 and whose unit is ml fails', () => {
        const before = quantityRows((index) => `${binary(index + 2)} ml`);
        const after = quantityRows((index) => `${binary(index + 66)} ml`);

        expect(differenceCheckV1(before, after).pass).toBe(false);
        expect(skeletonFirst(before, after).pass).toBe(true);
    });

    it('180C changed to 350F and nothing else fails', () => {
        const base = `${textOf(words)} bake at 180C`;

        expect(differenceCheckV1(base, `${textOf(words)} bake at 350F`).pass).toBe(false);
    });

    it('0nion against onion counts as no new word', () => {
        const baseline = `${textOf(words)} onion`;
        const result = differenceCheckV1(baseline, `${textOf(words.slice().reverse())} 0nion`);

        expect(result.newWords).toBe(0);
    });
});

describe('fail closed (qse F-4), measured after normalisation', () => {
    const fresh = textOf(synthWords(60, 1000));

    it('never passes for a missing or empty baseline, or empty new steps', () => {
        expect(differenceCheckV1('', fresh).pass).toBe(false);
        expect(differenceCheckV1('   \n ', fresh).pass).toBe(false);
        expect(differenceCheckV1(textOf(synthWords(60)), '').pass).toBe(false);
    });

    it('never passes for a baseline of 19 shingles, and passes for 20', () => {
        expect(differenceCheckV1(textOf(synthWords(21)), fresh)).toMatchObject({ total: 19, pass: false });
        expect(differenceCheckV1(textOf(synthWords(22)), fresh)).toMatchObject({ total: 20, pass: true });
    });

    it('never passes for a baseline of numbers and units only (no shingle at all)', () => {
        const quantities = Array.from({ length: 40 }, (_, index) => `${String(index + 2)} tbsp`).join(' ');

        expect(differenceCheckV1(quantities, fresh)).toMatchObject({ total: 2, pass: false });
    });

    it('never passes when the new text is the baseline', () => {
        for (const count of [22, 40, 100]) {
            const text = textOf(synthWords(count));

            expect(differenceCheckV1(text, text).pass).toBe(false);
        }
    });

    it('leaves total 0 out of the A compare: an empty baseline reports total 0 and no pass', () => {
        expect(differenceCheckV1('', fresh)).toMatchObject({ kept: 0, total: 0, pass: false });
    });
});

describe('baselineQualifiesV1', () => {
    it('is false for 19 shingles and true for 20, counted after normalisation', () => {
        expect(baselineQualifiesV1(textOf(synthWords(21)))).toBe(false);
        expect(baselineQualifiesV1(textOf(synthWords(22)))).toBe(true);
    });

    it('counts distinct shingles, not windows: fifty copies of one word are one shingle', () => {
        expect(baselineQualifiesV1(textOf(Array.from({ length: 50 }, () => 'bdfh')))).toBe(false);
    });

    it('counts the number and unit tokens as tokens: they make shingles of their own', () => {
        expect(baselineQualifiesV1(`${textOf(synthWords(21))} 2 tbsp 350 ml`)).toBe(true);
    });
});

describe('the runtime pin (KTD-2)', () => {
    const baseline = textOf(synthWords(40));
    const steps = textOf(synthWords(40, 1000));

    it('runs at the Unicode version v1 was frozen at', () => {
        expect(FROZEN_UNICODE_VERSION).toBe('17.0');
        expect(differenceCheckV1(baseline, steps, { unicode: FROZEN_UNICODE_VERSION }).pass).toBe(true);
    });

    it('runs on this runtime, whose Unicode version is the frozen one', () => {
        expect(process.versions.unicode).toBe(FROZEN_UNICODE_VERSION);
        expect(differenceCheckV1(baseline, steps).pass).toBe(true);
    });

    it('throws a DifferenceCheckError on any other Unicode version', () => {
        for (const other of ['16.0', '18.0', '', 'x']) {
            expect(() => differenceCheckV1(baseline, steps, { unicode: other })).toThrow(DifferenceCheckError);
        }
    });
});

describe('look-alike quantities do not earn the fact (B10a S-1, AE5)', () => {
    // Each sentence: two numbers, two units, three words, so every three-token shingle holds a quantity. Our own text.
    const sentences = Array.from({ length: 14 }, (_, index) => {
        const noun = synthWord(100 + index);
        const verb = synthWord(300 + index);

        return {
            plain: `${verb} ${String(150 + index)} g and ${String(20 + index)} minutes ${noun}.`,
            // Digits written as the letters l and O, units with Cyrillic с, р, і and е.
            disguised: `${verb} l${String(5 + (index % 4))}O \u0441u\u0440s and 2${String(index % 10)}O m\u0456nut\u0435s ${noun}.`,
        };
    });
    const baseline = sentences.map((sentence) => sentence.plain).join(' ');

    it('(c) fails a copy whose every quantity is swapped for a look-alike and whose every tenth word is changed', () => {
        const words = sentences
            .map((sentence) => sentence.disguised)
            .join(' ')
            .split(' ');
        const edited = words.map((word, index) => (index % 10 === 9 ? synthWord(2000 + index) : word)).join(' ');
        const result = differenceCheckV1(baseline, edited);

        expect(result.total).toBeGreaterThanOrEqual(20);
        expect(result.pass).toBe(false);
    });
});

describe('the stated v1 limit: scripts written without spaces between words', () => {
    it('never earns the fact for Japanese, whose runs tokenise into a few long tokens and miss the minimum', () => {
        const japanese = '焼き目がつくまでじっくり焦がさずに炒め、第二に調味料を加えてよく混ぜる';
        const other = 'とろ火で柔らかく煮込み、塗るようにソースを絡めて盛り付ける';

        expect(differenceCheckV1(japanese, other).pass).toBe(false);
        expect(baselineQualifiesV1(japanese)).toBe(false);
    });
});

describe('cost (qse F-11)', () => {
    it('finishes a pair at the 100 kB body limit inside the default test timeout', () => {
        const words = Array.from({ length: 17_000 }, (_, index) => synthWord((index * 7) % 4096));
        const baseline = textOf(words);
        const steps = textOf(words.map((word, index) => (index % 40 === 0 ? synthWord(index % 4096) : word)));

        expect(baseline.length).toBeGreaterThan(80_000);
        expect(differenceCheckV1(baseline, steps).longestRun).toBeGreaterThan(0);
    });
});
