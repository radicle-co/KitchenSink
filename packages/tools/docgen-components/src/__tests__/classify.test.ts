/**
 * The CLASSIFICATION layer — what the docblock SAYS, never what the code looks like.
 */
import { describe, expect, it } from 'vitest';

import { kindFromSignals, layerSignalsOf, patternsFrom } from '../classify.js';

describe('layerSignalsOf', () => {
    it.each([
        ['a pure presentational chip', { presentational: true, orchestration: false }],
        ['the orchestrational half of the split', { presentational: false, orchestration: true }],
        ['the orchestration layer selects the render component', { presentational: false, orchestration: true }],
        ['orchestrating the fetch', { presentational: false, orchestration: true }],
        ['renders a list', { presentational: false, orchestration: false }],
    ])('reads %j as %j', (documentation, expected) => {
        expect(layerSignalsOf(documentation)).toEqual(expected);
    });

    // Whole-word matching: a component whose prose merely contains the letters must not be classified.
    it('does not fire on a word that merely contains the term', () => {
        expect(layerSignalsOf('the presentationalism of it')).toEqual({ presentational: false, orchestration: false });
    });
});

describe('kindFromSignals', () => {
    it('reports the layer a docblock states', () => {
        expect(kindFromSignals({ presentational: true, orchestration: false })).toBe('presentational');
        expect(kindFromSignals({ presentational: false, orchestration: true })).toBe('orchestration');
    });

    // Asymmetric on purpose — see the reasoning in `classify.ts`. The residual error is not hidden: the raw
    // signals travel with the entry and the findings layer raises `ambiguous-layer-signal` on exactly these.
    it('resolves a docblock naming BOTH layers to orchestration', () => {
        expect(kindFromSignals({ presentational: true, orchestration: true })).toBe('orchestration');
    });

    // The silence IS the coverage number. A guess here would be a fact the code never stated.
    it('says unclassified rather than guessing when the docblock states nothing', () => {
        expect(kindFromSignals({ presentational: false, orchestration: false })).toBe('unclassified');
    });
});

describe('patternsFrom', () => {
    it('collects distinct `@pattern` tags across every leaf, sorted', () => {
        expect(
            patternsFrom([
                [
                    { name: 'pattern', text: 'Adapter' },
                    { name: 'module', text: 'x' },
                ],
                [{ name: 'pattern', text: 'Adapter' }],
                [{ name: 'pattern', text: 'Registry' }],
            ]),
        ).toEqual(['Adapter', 'Registry']);
    });

    // Prose matching was rejected: "Provider", "Command" and "State" occur constantly in ordinary sentences
    // about React, and matching them manufactures a pattern register nobody wrote.
    it('ignores pattern names that merely appear in prose', () => {
        expect(patternsFrom([[{ name: 'module', text: 'wraps the Provider and issues a Command' }]])).toEqual([]);
    });

    it('ignores an empty tag, so `@pattern` with no name is not a pattern called ""', () => {
        expect(patternsFrom([[{ name: 'pattern', text: '' }]])).toEqual([]);
    });
});
