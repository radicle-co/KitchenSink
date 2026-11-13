import fc from 'fast-check';
import { split } from 'sentence-splitter';
import { describe, expect, it } from 'vitest';

import { GOLDEN_CORPUS_STEPS, STEP_LINE_TRAPS, STEP_LINE_TRAPS_2 } from '../__fixtures__/stepLinesGolden.js';
import { STEP_LINE_ABBREVIATIONS, splitStepLines } from '../stepLines.js';

/**
 * `splitStepLines` — one cooking step split into the lines the cook ticks.
 *
 * The oracles are the product owner's, never the builder's: the public-domain half of the golden split and the
 * two trap tables. The pass mark is mechanical: the cut positions a split makes
 * must be a SUBSET of the golden cut positions, so any extra cut fails — that is the cut that would separate an
 * action from its amount. A golden cut the split does not make (a semicolon or paragraph colon, which this split does not make yet) is
 * reported, not gated. The trap table is matched exactly. The second trap table gates extra cuts only.
 *
 * "The oracle can fail" is proved here too: the same scorer, run over the naive "cut at every period followed by a
 * space" splitter, must find a defect. If it ever stopped finding one, the oracle would be too easy to mean anything.
 */

type Splitter = (text: string) => readonly string[];

/** The character offsets where `lines` cut `text`, found by walking the lines through the text in order. */
function cutsOf(text: string, lines: readonly string[]): ReadonlySet<number> {
    const cuts = new Set<number>();
    let position = 0;

    for (const line of lines.slice(0, -1)) {
        position = text.indexOf(line, position) + line.length;
        cuts.add(position);
    }

    return cuts;
}

/** Cuts `splitter` makes on `text` that `expected` does not: the gated defect. */
function extraCuts(splitter: Splitter, text: string, expected: readonly string[]): number[] {
    const want = cutsOf(text, expected);

    return [...cutsOf(text, splitter(text))].filter((cut) => !want.has(cut));
}

/** Every gated defect of `splitter` against all three oracles, as readable strings. */
function gatedDefects(splitter: Splitter): string[] {
    const defects: string[] = [];

    for (const step of GOLDEN_CORPUS_STEPS) {
        for (const cut of extraCuts(splitter, step.text, step.lines)) {
            defects.push(`golden "${step.recipe}" step ${step.step}: extra cut at ${cut}`);
        }
    }

    for (const trap of STEP_LINE_TRAPS) {
        const got = splitter(trap.text);

        if (JSON.stringify(got) !== JSON.stringify(trap.lines)) {
            defects.push(`trap "${trap.text}" gave ${JSON.stringify(got)}`);
        }
    }

    for (const trap of STEP_LINE_TRAPS_2) {
        for (const cut of extraCuts(splitter, trap.text, trap.lines)) {
            defects.push(`trap2 "${trap.text}": extra cut at ${cut}`);
        }
    }

    return defects;
}

/**
 * The contract: the lines are non-empty, trimmed slices of the text,
 * in order, with only whitespace between and around them.
 */
function assertSlicesOf(text: string, lines: readonly string[]): void {
    let position = 0;

    for (const line of lines) {
        expect(line).not.toBe('');
        expect(line).toBe(line.trim());
        const at = text.indexOf(line, position);
        expect(at).toBeGreaterThanOrEqual(0);
        expect(text.slice(position, at).trim()).toBe('');
        position = at + line.length;
    }

    expect(text.slice(position).trim()).toBe('');
}

describe('splitStepLines — the golden split and the trap tables ', () => {
    it('makes no gated defect on any oracle', () => {
        expect(gatedDefects(splitStepLines)).toEqual([]);
    });

    it.each(STEP_LINE_TRAPS)('matches the trap "$text" exactly', ({ text, lines }) => {
        expect(splitStepLines(text)).toEqual(lines);
    });

    it.each(STEP_LINE_TRAPS_2)('never cuts "$text" where the product owner does not', ({ text, lines }) => {
        expect(extraCuts(splitStepLines, text, lines)).toEqual([]);
    });

    it('keeps every golden line as a slice of its step', () => {
        for (const step of GOLDEN_CORPUS_STEPS) {
            assertSlicesOf(step.text, splitStepLines(step.text));
        }
    });

    it('finds the defects of the naive splitter, so the oracle can fail', () => {
        const naive: Splitter = (text) => text.split(/(?<=\.)\s+/u);

        expect(gatedDefects(naive).length).toBeGreaterThan(0);
    });
});

describe('splitStepLines — the product owner examples', () => {
    it('abbreviations and decimals are not sentence ends', () => {
        expect(splitStepLines('Heat 1.5 tbsp. oil. Add the onion and cook 5 min.')).toEqual([
            'Heat 1.5 tbsp. oil.',
            'Add the onion and cook 5 min.',
        ]);
    });

    it('a semicolon does not split a line', () => {
        expect(splitStepLines('Whisk the eggs; add the milk; beat well.')).toEqual([
            'Whisk the eggs; add the milk; beat well.',
        ]);
    });

    it('never cuts inside a parenthesis', () => {
        expect(splitStepLines('Add 2 tbsp oil (or butter). Fry 5 min.')).toEqual([
            'Add 2 tbsp oil (or butter).',
            'Fry 5 min.',
        ]);
    });

    it('a one-sentence step is one line', () => {
        expect(splitStepLines('Preheat the oven to 220°C.')).toEqual(['Preheat the oven to 220°C.']);
    });

    it('splits at a question mark and an exclamation mark', () => {
        expect(splitStepLines('Is it golden? Take it out now!')).toEqual(['Is it golden?', 'Take it out now!']);
    });

    it('splits across a line break and trims the lines', () => {
        expect(splitStepLines('  Mix.\nBake for 20 minutes.  ')).toEqual(['Mix.', 'Bake for 20 minutes.']);
    });

    it('keeps a sentence that ends without a full stop', () => {
        expect(splitStepLines('Mix well. Serve warm')).toEqual(['Mix well.', 'Serve warm']);
    });
});

describe('splitStepLines — stray punctuation is kept, never dropped', () => {
    it.each([
        ['!', ['!']],
        ['Mix. !', ['Mix. !']],
        ['Mix.  ?? Bake.', ['Mix.  ??', 'Bake.']],
        ['. Mix', ['. Mix']],
        [' ! ', ['!']],
    ])('%j gives %j', (text, lines) => {
        expect(splitStepLines(text)).toEqual(lines);
    });
});

describe('splitStepLines — empty input', () => {
    it.each(['', ' ', '\n\t  '])('returns no lines for %j', (text) => {
        expect(splitStepLines(text)).toEqual([]);
    });
});

/**
 * Every abbreviation in the list earns its place. Each entry has a sentence that the bare
 * library cuts in the wrong place (separating an amount or a reference from what follows) and that
 * `splitStepLines` keeps whole. The key set must equal the list, so an entry added without a case fails here.
 */
const ABBREVIATION_CASES: Readonly<Record<string, string>> = {
    'tbsp.': 'Add 2 tbsp. oil to the pan.',
    'Tbsp.': 'Add 2 Tbsp. butter to the pan.',
    'tsp.': 'Add 1 tsp. salt to the water.',
    'oz.': 'Stir in 8 oz. cream cheese.',
    'approx.': 'Bake for approx. 25 minutes.',
    'Fig.': 'Fold the dough as in Fig. 2 and chill it.',
    'in.': 'Cut the butter into 1/2 in. cubes.',
    'c.': 'Add 1 c. sugar to the bowl.',
    'lb.': 'Add 1 lb. apples to the pot.',
    'lbs.': 'Add 2 lbs. potatoes to the pot.',
    'pt.': 'Pour in 1 pt. milk slowly.',
    'qt.': 'Bring 2 qt. water to a boil.',
    'doz.': 'Beat 1 doz. eggs in a bowl.',
    'T.': 'Add 2 T. butter to the pan.',
    't.': 'Add 1 t. salt to the water.',
};

describe('STEP_LINE_ABBREVIATIONS — each entry is needed', () => {
    it('has exactly one case per entry', () => {
        expect([...STEP_LINE_ABBREVIATIONS].sort()).toEqual(Object.keys(ABBREVIATION_CASES).sort());
    });

    it.each(Object.entries(ABBREVIATION_CASES))(
        '"%s": the bare library cuts it, splitStepLines does not',
        (_, line) => {
            const bare = split(line)
                .filter((node) => node.type === 'Sentence')
                .map((node) => node.raw.trim());

            expect(bare.length).toBeGreaterThan(1);
            expect(splitStepLines(line)).toEqual([line]);
        },
    );
});

/** Properties over generated steps (the lines rejoin to the step text exactly). */
describe('splitStepLines — properties', () => {
    const word = fc.constantFrom(
        '!',
        '??',
        '...',
        '.',
        'Add',
        'the',
        'flour',
        '2',
        'tbsp.',
        '1.5',
        'oz.',
        '(or',
        'butter)',
        'Stir',
        'well',
    );
    const sentence = fc
        .tuple(fc.array(word, { minLength: 1, maxLength: 8 }), fc.constantFrom('.', '?', '!', ';', ''))
        .map(([words, end]) => words.join(' ') + end);
    const step = fc
        .tuple(fc.array(sentence, { minLength: 0, maxLength: 6 }), fc.constantFrom(' ', '  ', '\n', ' \n '))
        .map(([sentences, gap]) => sentences.join(gap));

    it('returns trimmed, non-empty, in-order slices of the text with only whitespace between them', () => {
        fc.assert(
            fc.property(step, (text) => {
                assertSlicesOf(text, splitStepLines(text));
            }),
        );
    });

    it('gives at least one line for any step that is not blank, so [] only ever means a blank step', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1 }).filter((text) => text.trim() !== ''),
                (text) => {
                    expect(splitStepLines(text).length).toBeGreaterThan(0);
                },
            ),
        );
    });

    it('never cuts between a number and the unit after it', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 99 }),
                fc.constantFrom(...STEP_LINE_ABBREVIATIONS),
                fc.constantFrom('flour', 'sugar', 'butter', 'milk'),
                (amount, unit, food) => {
                    const line = `Add ${amount} ${unit} ${food}.`;

                    expect(splitStepLines(`${line} Stir.`)).toEqual([line, 'Stir.']);
                },
            ),
        );
    });
});
