/**
 * The publish step's note about ingredient lines with no match (build spec §7.2; owner D20, 2026-10-10). The server
 * publishes a recipe whose lines have no matched food and counts them as zero toward nutrition, so Publish stays
 * enabled and the editor says so. The note is the ready text of the action bar and the quiet note of Photos & publish,
 * and it exists only while the recipe is otherwise ready: a recipe Publish would refuse shows the fix line instead.
 */
import { describe, expect, it } from 'vitest';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { makeFilledRecipeFormValues, withLineKeys } from '../../__fixtures__/index.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../../form/values.js';
import { editorMessages } from '../messages.js';
import { publishNoteOf } from '../publishNote.js';

const m = editorMessages.en;
const RESOLVED = {
    isUserEntered: false,
    ingredientId: '00000000-0000-4000-8000-000000000001',
    name: 'Oil',
    quantity: 2,
    resolutionStatus: FoodResolutionStatus.RESOLVED,
};
/** A line Publish accepts that still asks for a match: it has an id, and the lookup found nothing. */
const unmatched = (id: string) => ({
    ...RESOLVED,
    ingredientId: `00000000-0000-4000-8000-00000000000${id}`,
    resolutionStatus: FoodResolutionStatus.NOT_FOUND,
});

const note = (values: RecipeFormValues, over: { pending?: string; published?: boolean; locale?: string } = {}) =>
    publishNoteOf(
        { values, pendingEntryText: over.pending ?? '', published: over.published ?? false },
        m,
        over.locale ?? 'en',
    );

describe('publishNoteOf', () => {
    it('says nothing when every line has its match', () => {
        expect(note(makeFilledRecipeFormValues({ ingredients: withLineKeys([RESOLVED]) }))).toBeUndefined();
    });

    it('counts one line in the singular', () => {
        const values = makeFilledRecipeFormValues({ ingredients: withLineKeys([RESOLVED, unmatched('2')]) });

        expect(note(values)).toBe('Ready to publish. 1 ingredient has no match, so its nutrition is left out.');
    });

    it('counts two lines in the plural', () => {
        const values = makeFilledRecipeFormValues({
            ingredients: withLineKeys([RESOLVED, unmatched('2'), unmatched('3')]),
        });

        expect(note(values)).toBe('Ready to publish. 2 ingredients have no match, so their nutrition is left out.');
    });

    it('says nothing while Publish would refuse: the fix line speaks instead', () => {
        const values = makeFilledRecipeFormValues({ title: '', ingredients: withLineKeys([unmatched('2')]) });

        expect(note(values)).toBeUndefined();
    });

    it('says nothing while the cook holds an uncommitted ingredient line, which Publish refuses', () => {
        const values = makeFilledRecipeFormValues({ ingredients: withLineKeys([unmatched('2')]) });

        expect(note(values, { pending: 'flour' })).toBeUndefined();
    });

    it('says nothing for a recipe with no ingredient lines', () => {
        expect(note({ ...defaultRecipeFormValues(), title: 'Soup' })).toBeUndefined();
    });

    it('says nothing for a published recipe, whose primary is Save changes and not Publish', () => {
        const values = makeFilledRecipeFormValues({ ingredients: withLineKeys([unmatched('2')]) });

        expect(note(values, { published: true })).toBeUndefined();
    });
});
