/**
 * A private food in a PUBLIC recipe is an attention item (ruling 2026-11-09; private foods spec D2, section 16): the row
 * says so, the Ingredients section is not done, the sections bar counts it, and the ready line names it. A private recipe
 * may hold the same line quietly, and the Publish button stays enabled (the server re-checks).
 */
import { describe, expect, it } from 'vitest';

import { FoodResolutionStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import { makeFilledRecipeFormValues, withLineKeys } from '../../__fixtures__/index.js';
import { privateFoodRowIndexes } from '../../form/privateFoodLines.js';
import type { RecipeFormIngredient, RecipeFormValues } from '../../form/values.js';
import { editorMessages } from '../messages.js';
import { publishNoteOf, readyLineOf } from '../publishNote.js';
import { sectionStatusesOf } from '../sectionStatus.js';

const m = editorMessages.en;
const LINE = {
    isUserEntered: false,
    ingredientId: '00000000-0000-4000-8000-000000000001',
    name: 'My spice mix',
    quantity: 2,
    resolutionStatus: FoodResolutionStatus.RESOLVED,
};
const lines = (...over: Partial<RecipeFormIngredient>[]) => withLineKeys(over.map((o) => ({ ...LINE, ...o })));
const draft = (visibility: RecipeVisibility, ...over: Partial<RecipeFormIngredient>[]): RecipeFormValues =>
    makeFilledRecipeFormValues({ visibility, ingredients: lines(...over) });
const statuses = (values: RecipeFormValues) =>
    sectionStatusesOf({ values, pendingEntryText: '', publishAttempted: false, pasteReading: false, pasteNeedsYou: 0 });

describe('privateFoodRowIndexes', () => {
    it('names the private-food lines of a PUBLIC recipe, by position', () => {
        const values = draft(RecipeVisibility.PUBLIC, {}, { foodVisibility: 'private' }, { foodVisibility: 'public' });

        expect(privateFoodRowIndexes(values)).toEqual([1]);
    });

    it('names none in a PRIVATE recipe: the same line is allowed there', () => {
        expect(privateFoodRowIndexes(draft(RecipeVisibility.PRIVATE, { foodVisibility: 'private' }))).toEqual([]);
    });

    it('names none for a line that says nothing about its food', () => {
        expect(privateFoodRowIndexes(draft(RecipeVisibility.PUBLIC, {}))).toEqual([]);
    });
});

describe('the sections bar and the Ingredients section', () => {
    it('⛔ a private food in a public recipe makes Ingredients an attention item, never complete', () => {
        const status = statuses(draft(RecipeVisibility.PUBLIC, { foodVisibility: 'private' })).ingredients;

        expect(status).toEqual({ kind: 'attention', reason: 'ingredientsPrivateFood', count: 1 });
    });

    it('is complete when the recipe is private', () => {
        expect(statuses(draft(RecipeVisibility.PRIVATE, { foodVisibility: 'private' })).ingredients.kind).toBe(
            'complete',
        );
    });

    it('is complete once the food is public', () => {
        expect(statuses(draft(RecipeVisibility.PUBLIC, { foodVisibility: 'public' })).ingredients.kind).toBe(
            'complete',
        );
    });

    it('adds to lines that need a match, under the rank of needing a match, and counts both', () => {
        const status = statuses(
            draft(
                RecipeVisibility.PUBLIC,
                { foodVisibility: 'private' },
                { resolutionStatus: FoodResolutionStatus.NOT_FOUND },
            ),
        ).ingredients;

        expect(status).toEqual({ kind: 'attention', reason: 'ingredientsUnresolved', count: 2 });
    });

    it('does not make Photos & publish ready', () => {
        expect(statuses(draft(RecipeVisibility.PUBLIC, { foodVisibility: 'private' })).photos.kind).toBe('optional');
    });

    it('speaks the reason as a count', () => {
        expect(m.index.reason.ingredientsPrivateFood.one).toBe('{count} uses a private food');
        expect(m.index.reason.ingredientsPrivateFood.other).toBe('{count} use private foods');
    });
});

describe('the ready line', () => {
    const input = (values: RecipeFormValues) => ({ values, pendingEntryText: '', published: false });

    it('⛔ names the private foods and does not say "Ready to publish"', () => {
        const line = readyLineOf(input(draft(RecipeVisibility.PUBLIC, { foodVisibility: 'private' })), m, 'en');

        expect(line).toEqual({
            kind: 'fix',
            text: '1 ingredient uses your private food, so this recipe can’t be public yet.',
            section: 'ingredients',
        });
    });

    it('pluralises', () => {
        const line = readyLineOf(
            input(draft(RecipeVisibility.PUBLIC, { foodVisibility: 'private' }, { foodVisibility: 'private' })),
            m,
            'en',
        );

        expect(line?.text).toBe('2 ingredients use your private foods, so this recipe can’t be public yet.');
    });

    it('is still ready for a private recipe', () => {
        expect(readyLineOf(input(draft(RecipeVisibility.PRIVATE, { foodVisibility: 'private' })), m, 'en')?.kind).toBe(
            'ready',
        );
    });

    it('leaves the unmatched-lines note alone', () => {
        expect(
            publishNoteOf(input(draft(RecipeVisibility.PUBLIC, { foodVisibility: 'private' })), m, 'en'),
        ).toBeUndefined();
    });
});
