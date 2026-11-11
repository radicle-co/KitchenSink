/**
 * What an imported recipe still lacks before it can be saved PUBLISHED (ADR-0072 §3 as amended 2026-11-11).
 *
 * The import saves every recipe published, so it must meet what Publish needs (`publishPolicy.ts`) and what the create route
 * requires (servings and the times). A gap is never filled with a made-up value and the recipe is not saved as a draft: the
 * item waits for the cook. A recipe with no ingredient line or no step is not a gap but a REFUSAL (`importRefusal.ts`), so a
 * save fact that reaches this module without either is a defect, and it throws.
 */
import { describe, expect, it } from 'vitest';

import {
    fileSaveFactsOf,
    importCuisineOf,
    importSaveFactsOf,
    importSaveGapOf,
    type ImportFileFacts,
    type ImportSaveFacts,
} from '../importSaveGap.js';

const NOTHING_FILED: ImportFileFacts = {
    cuisine: null,
    servings: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    totalTimeMinutes: null,
};
const NO_CHOICES = { cuisine: null, servings: null, prepTimeMinutes: null, cookTimeMinutes: null };

const COMPLETE: ImportSaveFacts = {
    statement: { kind: 'authored' },
    cuisine: 'Italian',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    ingredientLineCount: 3,
    stepCount: 2,
};
const gap = (patch: Partial<ImportSaveFacts>) => importSaveGapOf({ ...COMPLETE, ...patch });

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

describe('fileSaveFactsOf: what a stored payload states', () => {
    it('reads the cuisine, servings and the three times, and only them, from the document', () => {
        expect(
            fileSaveFactsOf({
                title: 'Soup',
                cuisine: 'French',
                servings: 4,
                prepTimeMinutes: 5,
                cookTimeMinutes: 0,
                totalTimeMinutes: 5,
                steps: [],
            }),
        ).toEqual({
            cuisine: 'French',
            servings: 4,
            prepTimeMinutes: 5,
            cookTimeMinutes: 0,
            totalTimeMinutes: 5,
        });
    });

    it('is all null for a payload that states none, and for a saved item whose payload is gone', () => {
        expect(fileSaveFactsOf({ title: 'Soup' })).toEqual(NOTHING_FILED);
        expect(fileSaveFactsOf(null)).toEqual(NOTHING_FILED);
    });
});

describe("importSaveFactsOf: what the save would send, the cook's choice over the file's", () => {
    it("takes the cook's choice for each field over the file's", () => {
        expect(
            importSaveFactsOf(
                { cuisine: 'Thai', servings: 2, prepTimeMinutes: 1, cookTimeMinutes: 2 },
                { cuisine: 'Italian', servings: 6, prepTimeMinutes: 10, cookTimeMinutes: 20, totalTimeMinutes: 30 },
            ),
        ).toMatchObject({ cuisine: 'Thai', servings: 2, prepTimeMinutes: 1, cookTimeMinutes: 2 });
    });

    it('falls back to the file for each field the cook did not choose', () => {
        expect(
            importSaveFactsOf(NO_CHOICES, {
                cuisine: 'Italian',
                servings: 6,
                prepTimeMinutes: 10,
                cookTimeMinutes: 20,
                totalTimeMinutes: 30,
            }),
        ).toEqual({
            cuisine: 'Italian',
            servings: 6,
            prepTimeMinutes: 10,
            cookTimeMinutes: 20,
            totalTimeMinutes: 30,
        });
    });

    it('is null for a field neither states: nothing is made up (no 1 serving, no 0 minutes)', () => {
        expect(importSaveFactsOf(NO_CHOICES, NOTHING_FILED)).toEqual(NOTHING_FILED);
    });

    it("takes the FILE's total when it states one, even if prep and cook disagree with it", () => {
        expect(
            importSaveFactsOf(NO_CHOICES, {
                ...NOTHING_FILED,
                prepTimeMinutes: 10,
                cookTimeMinutes: 20,
                totalTimeMinutes: 45,
            }).totalTimeMinutes,
        ).toBe(45);
    });

    it('adds prep and cook for the total when the file states none', () => {
        expect(
            importSaveFactsOf(NO_CHOICES, { ...NOTHING_FILED, prepTimeMinutes: 10, cookTimeMinutes: 20 })
                .totalTimeMinutes,
        ).toBe(30);
        expect(
            importSaveFactsOf({ ...NO_CHOICES, prepTimeMinutes: 5, cookTimeMinutes: 0 }, NOTHING_FILED)
                .totalTimeMinutes,
        ).toBe(5);
    });

    it('has no total when only one of prep and cook is known and the file states none', () => {
        expect(importSaveFactsOf(NO_CHOICES, { ...NOTHING_FILED, prepTimeMinutes: 10 }).totalTimeMinutes).toBeNull();
        expect(importSaveFactsOf(NO_CHOICES, { ...NOTHING_FILED, cookTimeMinutes: 10 }).totalTimeMinutes).toBeNull();
    });

    it('a file that states only a total leaves prep and cook unknown', () => {
        expect(importSaveFactsOf(NO_CHOICES, { ...NOTHING_FILED, totalTimeMinutes: 30 })).toMatchObject({
            prepTimeMinutes: null,
            cookTimeMinutes: null,
            totalTimeMinutes: 30,
        });
    });

    it('treats a 0 the cook or the file gave as a value, not an absence', () => {
        expect(
            importSaveFactsOf({ ...NO_CHOICES, prepTimeMinutes: 0 }, { ...NOTHING_FILED, cookTimeMinutes: 0 }),
        ).toMatchObject({ prepTimeMinutes: 0, cookTimeMinutes: 0, totalTimeMinutes: 0 });
    });
});

describe('importSaveGapOf: the first thing the save still needs, or null', () => {
    it('is null for a recipe with everything', () => {
        expect(gap({})).toBeNull();
    });

    it('needs a cuisine when neither the cook nor the file gave one', () => {
        expect(gap({ cuisine: null })).toBe('cuisine');
    });

    it('needs servings when none is known', () => {
        expect(gap({ servings: null })).toBe('servings');
    });

    it('needs times when prep is unknown, when cook is unknown, or when both are', () => {
        expect(gap({ prepTimeMinutes: null })).toBe('times');
        expect(gap({ cookTimeMinutes: null })).toBe('times');
        expect(gap({ prepTimeMinutes: null, cookTimeMinutes: null })).toBe('times');
    });

    it('⛔ holds on an ABSENT value and never on 0: zero minutes and a zero-prep recipe are stated facts', () => {
        expect(gap({ prepTimeMinutes: 0, cookTimeMinutes: 0 })).toBeNull();
    });

    it('names the FIRST gap in the order cuisine, servings, times, so the cook fixes one thing at a time', () => {
        const nothing = { cuisine: null, servings: null, prepTimeMinutes: null, cookTimeMinutes: null };

        expect(gap(nothing)).toBe('cuisine');
        expect(gap({ ...nothing, cuisine: 'Thai' })).toBe('servings');
        expect(gap({ ...nothing, cuisine: 'Thai', servings: 2 })).toBe('times');
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

    it('⛔ throws for a recipe with no ingredient line or no step: such an item is refused before it gets here', () => {
        expect(() => gap({ ingredientLineCount: 0 })).toThrow(/refused/u);
        expect(() => gap({ stepCount: 0 })).toThrow(/refused/u);
    });
});
