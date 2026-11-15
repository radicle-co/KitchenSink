import { describe, expect, it } from 'vitest';

import { instructionOf, instructionSteps as readSteps } from '../instructionSteps.js';
import { MAX_WALK_DEPTH, MAX_WALK_NODES } from '../pageCaps.js';

const step = (text: string) => ({ '@type': 'HowToStep', text });

/** The steps as the recipe states them with no step name shown: section labels only (today's behaviour). */
const instructionSteps = (value: unknown) => readSteps(value).map((read) => instructionOf(read, false));

describe('instructionSteps', () => {
    describe('R3: a HowToStep name, as a heading only where the page shows it', () => {
        const named = (name: string, text: string) => ({ '@type': 'HowToStep', name, text });
        const namesOf = (value: unknown) => readSteps(value).map((read) => read.name);

        it('keeps the raw text and the name of a step apart, and writes the name only when told it is shown', () => {
            const [read] = readSteps([named('Scramble the egg', 'Lightly whisk the eggs.')]);

            expect(read).toEqual({ text: 'Lightly whisk the eggs.', name: 'Scramble the egg' });
            expect(instructionOf(read ?? { text: '' }, false)).toBe('Lightly whisk the eggs.');
            expect(instructionOf(read ?? { text: '' }, true)).toBe('Scramble the egg: Lightly whisk the eggs.');
        });

        it.each(['Step 1', 'Krok 1', 'ETAP 3:', 'Step 12.', '1', '2.', '***', '\u2014', '  '])(
            'offers no name for %j (an ordinal, or no letters)',
            (name) => {
                expect(namesOf([named(name, 'Mix the flour in.')])).toEqual([undefined]);
            },
        );

        it('offers no name that is the step text, or a subsequence of its words ("Prep salmon" in "Prep the salmon")', () => {
            expect(
                namesOf([
                    named('Mix the flour in.', 'Mix the flour in.'),
                    named('Prep salmon', 'Prep the salmon, then pat it dry.'),
                    named('Toast', 'Toast the bread until golden.'),
                ]),
            ).toEqual([undefined, undefined, undefined]);
        });

        it('offers a name that says something the text does not, even one that has a digit ("Step 1 cakes")', () => {
            expect(namesOf([named('Top', 'Remove the enchiladas.'), named('Step 1 cakes', 'Mix.')])).toEqual([
                'Top',
                'Step 1 cakes',
            ]);
        });

        it('reads a step with a name and no text as that name, with no heading', () => {
            expect(readSteps([{ '@type': 'HowToStep', name: 'Bake.' }])).toEqual([{ text: 'Bake.' }]);
        });

        it('lets a section label go first: a step that spent one has no name heading', () => {
            const reads = readSteps({
                '@type': 'HowToSection',
                name: 'For the glaze',
                itemListElement: [named('Whisk', 'Combine sugar and milk.'), named('Drizzle', 'Pour it over.')],
            });

            expect(reads.map((read) => instructionOf(read, true))).toEqual([
                'For the glaze: Combine sugar and milk.',
                'Drizzle: Pour it over.',
            ]);
        });

        it('adds no second colon after a name that ends in one', () => {
            const [read] = readSteps([named('Top:', 'Remove the enchiladas.')]);

            expect(instructionOf(read ?? { text: '' }, true)).toBe('Top: Remove the enchiladas.');
        });
    });

    it('splits a string on line breaks and block elements', () => {
        expect(instructionSteps('Mix.\nBake.<br>Cool.<p>Serve.</p>')).toEqual(['Mix.', 'Bake.', 'Cool.', 'Serve.']);
    });

    it('reads a list of strings as one step each, with markup removed', () => {
        expect(instructionSteps(['Mix <b>well</b>.', 'Bake &amp; cool.', '  '])).toEqual(['Mix well.', 'Bake & cool.']);
    });

    it('reads a HowToStep by its text, else by its name', () => {
        expect(
            instructionSteps([
                step('Mix.'),
                { '@type': 'HowToStep', name: 'Bake.' },
                { '@type': 'HowToStep', text: 'T', name: 'N' },
            ]),
        ).toEqual(['Mix.', 'Bake.', 'T']);
    });

    it('flattens a HowToSection in order and puts its name at the start of its first step only', () => {
        expect(
            instructionSteps([
                step('Preheat.'),
                { '@type': 'HowToSection', name: 'For the glaze', itemListElement: [step('Whisk.'), step('Drizzle.')] },
                { '@type': 'HowToSection', name: 'Serve', itemListElement: [step('Slice.')] },
            ]),
        ).toEqual(['Preheat.', 'For the glaze: Whisk.', 'Drizzle.', 'Serve: Slice.']);
    });

    it('flattens a section inside a section, labelling each section once', () => {
        expect(
            instructionSteps({
                '@type': 'HowToSection',
                name: 'Outer',
                itemListElement: [
                    { '@type': 'HowToSection', name: 'Inner', itemListElement: [step('A.'), step('B.')] },
                    step('C.'),
                ],
            }),
        ).toEqual(['Inner: A.', 'B.', 'C.']);
    });

    it('does not label a section that has no steps, nor one with a blank name', () => {
        expect(
            instructionSteps([
                { '@type': 'HowToSection', name: 'Empty', itemListElement: [] },
                { '@type': 'HowToSection', name: '  ', itemListElement: [step('One.')] },
            ]),
        ).toEqual(['One.']);
    });

    it('reads an ItemList without a label', () => {
        expect(
            instructionSteps({ '@type': 'ItemList', name: 'Steps', itemListElement: [step('One.'), 'Two.'] }),
        ).toEqual(['One.', 'Two.']);
    });

    it('reads the steps inside a HowToStep that lists directions', () => {
        expect(
            instructionSteps([
                { '@type': 'HowToStep', itemListElement: [{ '@type': 'HowToDirection', text: 'Stir.' }] },
            ]),
        ).toEqual(['Stir.']);
    });

    it('reads a text that was encoded twice', () => {
        expect(instructionSteps([step('Add &amp;amp; stir.')])).toEqual(['Add & stir.']);
    });

    it.each([[undefined], [null], [42], [true], [{}], [{ '@type': 'HowToStep' }], [[]], [[null, 7, {}]]])(
        'reads %j as no steps',
        (value) => {
            expect(instructionSteps(value)).toEqual([]);
        },
    );

    it('treats a __proto__ key as data and pollutes nothing', () => {
        const hostile: unknown = JSON.parse('[{"@type":"HowToStep","text":"Mix.","__proto__":{"polluted":1}}]');

        expect(instructionSteps(hostile)).toEqual(['Mix.']);
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('stops at the node budget', () => {
        const steps = Array.from({ length: MAX_WALK_NODES * 5 }, () => 'Stir.');

        expect(instructionSteps(steps).length).toBeLessThanOrEqual(MAX_WALK_NODES);
        expect(instructionSteps(steps).length).toBeGreaterThan(0);
    });

    it('does not descend past the depth cap', () => {
        let nested: unknown = step('Too deep.');

        for (let level = 0; level < MAX_WALK_DEPTH * 3; level += 1) {
            nested = { '@type': 'HowToSection', name: 's', itemListElement: [nested] };
        }

        expect(instructionSteps(nested)).toEqual([]);
        expect(instructionSteps([step('Kept.'), nested])).toEqual(['Kept.']);
    });

    describe('section names that already end in a colon', () => {
        it.each(['Make the cookies:', 'Make the cookies\uFF1A'])('adds no second colon after %j', (name) => {
            expect(
                instructionSteps({ '@type': 'HowToSection', name, itemListElement: [step('Mix.'), step('Bake.')] }),
            ).toEqual([`${name} Mix.`, 'Bake.']);
        });

        it('still adds ": " after a name that does not end in one', () => {
            expect(
                instructionSteps({
                    '@type': 'HowToSection',
                    name: 'Make: the cookies',
                    itemListElement: [step('Mix.')],
                }),
            ).toEqual(['Make: the cookies: Mix.']);
        });
    });

    describe('HowToTip is skipped with its whole subtree', () => {
        const tip = (extra: Record<string, unknown> = {}) => ({
            '@type': 'HowToTip',
            text: 'Use cold butter.',
            ...extra,
        });

        it('skips a tip typed as a string or as an array, among steps', () => {
            expect(
                instructionSteps([
                    step('Mix.'),
                    tip(),
                    { ...tip(), '@type': ['HowToTip', 'CreativeWork'] },
                    step('Bake.'),
                ]),
            ).toEqual(['Mix.', 'Bake.']);
        });

        it('skips a tip nested in a section, and the steps inside the tip', () => {
            expect(
                instructionSteps({
                    '@type': 'HowToSection',
                    name: 'Dough',
                    itemListElement: [tip({ itemListElement: [step('Hidden.')] }), step('Mix.')],
                }),
            ).toEqual(['Dough: Mix.']);
        });

        it('gives no step for a section that holds only tips, and spends no label on it', () => {
            expect(
                instructionSteps([
                    { '@type': 'HowToSection', name: 'Notes', itemListElement: [tip(), tip()] },
                    step('Mix.'),
                ]),
            ).toEqual(['Mix.']);
        });

        it('leaves HowToStep, HowToSection and plain strings unchanged', () => {
            expect(instructionSteps(['Plain.', step('Step.')])).toEqual(['Plain.', 'Step.']);
        });
    });
});
