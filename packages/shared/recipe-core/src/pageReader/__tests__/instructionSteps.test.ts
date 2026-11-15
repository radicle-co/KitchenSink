import { describe, expect, it } from 'vitest';

import { instructionSteps } from '../instructionSteps.js';
import { MAX_WALK_DEPTH, MAX_WALK_NODES } from '../pageCaps.js';

const step = (text: string) => ({ '@type': 'HowToStep', text });

describe('instructionSteps', () => {
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
});
