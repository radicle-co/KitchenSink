import { describe, expect, it } from 'vitest';

import type { CandidateRecipe, RecipeCandidateOutcome } from '../../proseRecipe.js';
import { buildParseCorpus, determinismSample, harvestSourceTexts, plannedCalls } from '../parseCorpus.js';

const clause = (text: string, origin: 'ingredient' | 'dropped' = 'ingredient') => ({ text, origin }) as const;

describe('buildParseCorpus', () => {
    it('keeps the source text verbatim — the corpus is measured as the book prints it', () => {
        expect(buildParseCorpus([clause('one-half cup of butter')])[0]?.text).toBe('one-half cup of butter');
    });

    it("carries each line's origin, because the two halves are different populations", () => {
        const corpus = buildParseCorpus([clause('two eggs'), clause('Serve on a heated platter', 'dropped')]);

        expect(corpus.map((line) => line.origin)).toEqual(['ingredient', 'dropped']);
    });

    it('gives every line a stable id derived from its position, so two runs pair up', () => {
        const first = buildParseCorpus([clause('a cup of milk'), clause('two eggs')]);
        const second = buildParseCorpus([clause('a cup of milk'), clause('two eggs')]);

        expect(first.map((line) => line.id)).toEqual(second.map((line) => line.id));
        expect(new Set(first.map((line) => line.id)).size).toBe(2);
    });

    it('drops an exact duplicate, keeping the first occurrence', () => {
        const corpus = buildParseCorpus([clause('two eggs'), clause('a cup of milk'), clause('two eggs')]);

        expect(corpus.map((line) => line.text)).toEqual(['two eggs', 'a cup of milk']);
    });

    it('keeps the FIRST origin when one clause appears in both halves, so a line is counted once', () => {
        const corpus = buildParseCorpus([clause('a little salt'), clause('a little salt', 'dropped')]);

        expect(corpus).toHaveLength(1);
        expect(corpus[0]?.origin).toBe('ingredient');
    });

    it('treats two spellings of the same phrase as two lines — the corpus is text, not meaning', () => {
        expect(buildParseCorpus([clause('Two eggs'), clause('two eggs')])).toHaveLength(2);
    });

    it('collapses a line broken across a source line break into one line of prose', () => {
        expect(buildParseCorpus([clause('one cup of\nbrown sugar')])[0]?.text).toBe('one cup of brown sugar');
    });

    it('trims edge whitespace, which is an artefact of the extraction and not of the book', () => {
        expect(buildParseCorpus([clause('  two eggs  ')])[0]?.text).toBe('two eggs');
    });

    it('drops a line that is empty once trimmed', () => {
        expect(buildParseCorpus([clause('  '), clause(''), clause('two eggs')])).toHaveLength(1);
    });

    it('dedupes AFTER trimming, so whitespace cannot smuggle a duplicate in', () => {
        expect(buildParseCorpus([clause('two eggs'), clause(' two eggs ')])).toHaveLength(1);
    });

    it('preserves source order', () => {
        expect(buildParseCorpus([clause('c'), clause('a'), clause('b')]).map((line) => line.text)).toEqual([
            'c',
            'a',
            'b',
        ]);
    });

    it('returns nothing for no input', () => {
        expect(buildParseCorpus([])).toEqual([]);
    });
});

describe('harvestSourceTexts', () => {
    function candidate(ingredients: readonly string[], droppedLines: readonly string[]): RecipeCandidateOutcome {
        const recipe = { ingredients: ingredients.map((sourceText) => ({ sourceText })) } as unknown as CandidateRecipe;

        return { kind: 'candidate', recipe, droppedLines, droppedInstructions: [] };
    }

    it('harvests the clauses the extractor ACCEPTED as ingredients', () => {
        const harvest = harvestSourceTexts([candidate(['two eggs'], [])]);

        expect(harvest.clauses).toEqual([{ text: 'two eggs', origin: 'ingredient' }]);
        expect(harvest.acceptedBlocks).toBe(1);
    });

    it("ALSO harvests the clauses it dropped, so the corpus is not filtered by our own parser's success", () => {
        const harvest = harvestSourceTexts([candidate(['two eggs'], ['Serve hot'])]);

        expect(harvest.clauses).toEqual([
            { text: 'two eggs', origin: 'ingredient' },
            { text: 'Serve hot', origin: 'dropped' },
        ]);
    });

    it('tallies why each block was skipped — the DIRECTION of the residual bias, not just its size', () => {
        const harvest = harvestSourceTexts([
            { kind: 'skipped', title: 'A', reason: 'too_few_ingredients' },
            { kind: 'skipped', title: 'B', reason: 'too_few_ingredients' },
            { kind: 'skipped', title: 'C', reason: 'no_body' },
            candidate(['two eggs'], []),
        ]);

        expect(harvest.skipReasons).toEqual({ too_few_ingredients: 2, no_body: 1 });
        expect(harvest.acceptedBlocks).toBe(1);
        expect(harvest.skippedBlocks).toBe(3);
    });

    it('harvests nothing from a skipped block — a skip discards the whole block', () => {
        const harvest = harvestSourceTexts([{ kind: 'skipped', title: 'A', reason: 'no_body' }]);

        expect(harvest.clauses).toEqual([]);
    });

    it('returns empty tallies for no blocks', () => {
        expect(harvestSourceTexts([])).toEqual({
            clauses: [],
            acceptedBlocks: 0,
            skippedBlocks: 0,
            skipReasons: {},
        });
    });
});

describe('determinismSample', () => {
    const corpus = buildParseCorpus(Array.from({ length: 100 }, (_, index) => clause(`line ${index}`)));

    it('draws the asked-for number of lines', () => {
        expect(determinismSample(corpus, 40)).toHaveLength(40);
    });

    it('draws the same lines every run — a re-run must be comparable', () => {
        expect(determinismSample(corpus, 40)).toEqual(determinismSample(corpus, 40));
    });

    it('spreads the draw across the whole corpus rather than taking a prefix', () => {
        const drawn = determinismSample(corpus, 10);

        expect(drawn[0]?.text).toBe('line 0');
        expect(drawn.at(-1)?.text).not.toBe('line 9');
    });

    it('draws no line twice', () => {
        expect(new Set(determinismSample(corpus, 40).map((line) => line.id)).size).toBe(40);
    });

    it('returns the whole corpus when asked for more lines than it holds', () => {
        expect(determinismSample(corpus, 500)).toHaveLength(100);
    });

    it('returns nothing when asked for nothing', () => {
        expect(determinismSample(corpus, 0)).toEqual([]);
    });

    it('returns nothing from an empty corpus', () => {
        expect(determinismSample([], 40)).toEqual([]);
    });
});

describe('plannedCalls', () => {
    it('counts both passes, because both are billed', () => {
        expect(plannedCalls(100, 40)).toBe(140);
    });

    it('never plans more repeats than there are lines to repeat', () => {
        expect(plannedCalls(10, 40)).toBe(20);
    });

    it('plans one pass when no repeats were asked for', () => {
        expect(plannedCalls(100, 0)).toBe(100);
    });

    it('plans nothing for an empty corpus', () => {
        expect(plannedCalls(0, 40)).toBe(0);
    });
});
