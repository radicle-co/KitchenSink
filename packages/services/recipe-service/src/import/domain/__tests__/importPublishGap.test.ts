/**
 * What an imported recipe still lacks before it can be saved PUBLISHED (ADR-0072 §3 as amended 2026-11-11).
 *
 * The import saves every recipe published, so it must meet what Publish needs (`publishPolicy.ts`). A gap is not filled with a
 * made-up value and the recipe is not saved as a draft: the item waits for the cook. These tests pin that the import asks the
 * ONE publish policy, with the provenance the cook's statement sets, and does not keep a second copy of the rule.
 */
import { describe, expect, it } from 'vitest';

import { fileCuisineOf, importCuisineOf, importPublishGapOf, type ImportPublishFacts } from '../importPublishGap.js';

const COMPLETE: ImportPublishFacts = {
    statement: { kind: 'authored' },
    cuisine: 'Italian',
    ingredientLineCount: 3,
    stepCount: 2,
};
const gap = (patch: Partial<ImportPublishFacts>) => importPublishGapOf({ ...COMPLETE, ...patch });

describe('importCuisineOf: the cuisine the save uses', () => {
    it("takes the cook's choice over the file's", () => {
        expect(importCuisineOf('Thai', 'Italian')).toBe('Thai');
    });

    it("falls back to the file's cuisine when the cook chose none", () => {
        expect(importCuisineOf(null, 'Italian')).toBe('Italian');
    });

    it('is null when neither states one: nothing is made up', () => {
        expect(importCuisineOf(null, undefined)).toBeNull();
        expect(importCuisineOf(null, null)).toBeNull();
    });
});

describe('fileCuisineOf: the cuisine a stored payload states', () => {
    it('reads it, and only it, from the document', () => {
        expect(fileCuisineOf({ title: 'Soup', cuisine: 'French', steps: [] })).toBe('French');
    });

    it('is null for a payload that states none, and for a saved item whose payload is gone', () => {
        expect(fileCuisineOf({ title: 'Soup' })).toBeNull();
        expect(fileCuisineOf(null)).toBeNull();
    });
});

describe('importPublishGapOf: the first thing Publish still needs, or null', () => {
    it('is null for a recipe with a cuisine, a line and a step', () => {
        expect(gap({})).toBeNull();
    });

    it('needs a cuisine when neither the cook nor the file gave one', () => {
        expect(gap({ cuisine: null })).toBe('cuisine');
    });

    it('needs ingredients for a recipe with no ingredient line', () => {
        expect(gap({ ingredientLineCount: 0 })).toBe('ingredients');
    });

    it('needs steps for a recipe with no step', () => {
        expect(gap({ stepCount: 0 })).toBe('steps');
    });

    it('names the FIRST gap in the publish order, so the cook fixes one thing at a time', () => {
        expect(gap({ cuisine: null, ingredientLineCount: 0, stepCount: 0 })).toBe('cuisine');
        expect(gap({ ingredientLineCount: 0, stepCount: 0 })).toBe('ingredients');
    });

    it('⛔ reads the provenance the STATEMENT sets: a public-domain web import needs no cuisine, as on every route', () => {
        expect(gap({ cuisine: null, statement: { kind: 'public_web', citation: 'https://example.org/r' } })).toBeNull();
    });

    it('asks a book or paid-site import for a cuisine like any other recipe', () => {
        expect(gap({ cuisine: null, statement: { kind: 'book', citation: 'A Book, p. 4' } })).toBe('cuisine');
        expect(gap({ cuisine: null, statement: { kind: 'paid_site', citation: 'https://paid.example/r' } })).toBe(
            'cuisine',
        );
    });
});
