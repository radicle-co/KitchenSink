/**
 * Each editor section's status (build spec §7.2), derived from the ONE publish validator so the section index and
 * Publish can never disagree. Precedence: Fix before publishing (after a refused Publish) > Needs attention (a known
 * blocker) > In progress > Not started; Photos & publish is Optional until the other three are complete.
 */
import { describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues, withLineKeys } from '../../__fixtures__/index.js';
import { TITLE_MAX_LENGTH } from '../../form/limits.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../../form/values.js';
import { doneCount, newlyComplete, sectionStatusesOf, type SectionStatuses } from '../sectionStatus.js';

const RESOLVED = {
    isUserEntered: false,
    ingredientId: '00000000-0000-4000-8000-000000000001',
    name: 'Oil',
    quantity: 2,
};
const UNRESOLVED = { isUserEntered: false, ingredientId: null, name: 'Kale', quantity: 1 };

function statuses(values: RecipeFormValues, over: { pending?: string; attempted?: boolean } = {}): SectionStatuses {
    return sectionStatusesOf({
        values,
        pendingEntryText: over.pending ?? '',
        publishAttempted: over.attempted ?? false,
    });
}

describe('a new, empty recipe', () => {
    it('has every section not started and Photos & publish optional', () => {
        expect(statuses(defaultRecipeFormValues())).toEqual({
            details: { kind: 'notStarted' },
            ingredients: { kind: 'notStarted' },
            steps: { kind: 'notStarted' },
            photos: { kind: 'optional' },
        });
    });
});

describe('a complete recipe', () => {
    it('has every section complete, Photos & publish included (it is "Ready to publish")', () => {
        expect(statuses(makeFilledRecipeFormValues())).toEqual({
            details: { kind: 'complete' },
            ingredients: { kind: 'complete' },
            steps: { kind: 'complete' },
            photos: { kind: 'complete' },
        });
    });
});

describe('Details', () => {
    it('is in progress with "title needed" once anything else is typed', () => {
        const values = { ...defaultRecipeFormValues(), description: 'Creamy.' };

        expect(statuses(values).details).toEqual({ kind: 'inProgress', reason: 'titleRequired' });
    });

    it.each<[string, Partial<RecipeFormValues>]>([
        ['servings', { servings: 3 }],
        ['a prep time', { prepTimeMinutes: 5 }],
        ['a cuisine', { cuisine: 'Thai' }],
        ['a tag', { tags: ['quick'] }],
        ['a difficulty', { difficulty: 'easy' }],
    ])('counts %s as something typed', (_, over) => {
        expect(statuses({ ...defaultRecipeFormValues(), ...over }).details.kind).toBe('inProgress');
    });

    it('needs attention for a title past the 120 publish limit, and says when it is past the wire`s too', () => {
        const long = makeFilledRecipeFormValues({ title: 'a'.repeat(TITLE_MAX_LENGTH + 1) });
        const tooLongToSave = makeFilledRecipeFormValues({ title: 'a'.repeat(201) });

        expect(statuses(long).details).toEqual({ kind: 'attention', reason: 'titleTooLong', count: 1 });
        expect(statuses(tooLongToSave).details).toEqual({ kind: 'attention', reason: 'titleTooLongToSave', count: 1 });
    });

    it('is complete at exactly the limit', () => {
        expect(statuses(makeFilledRecipeFormValues({ title: 'a'.repeat(TITLE_MAX_LENGTH) })).details).toEqual({
            kind: 'complete',
        });
    });
});

describe('Ingredients', () => {
    it('needs attention, with the count, for each line that has no food (U28: it always blocks Publish)', () => {
        const values = makeFilledRecipeFormValues({ ingredients: withLineKeys([RESOLVED, UNRESOLVED, UNRESOLVED]) });

        expect(statuses(values).ingredients).toEqual({ kind: 'attention', reason: 'ingredientsUnresolved', count: 2 });
    });

    it('needs attention for an amount the wire refuses', () => {
        const values = makeFilledRecipeFormValues({ ingredients: withLineKeys([{ ...RESOLVED, quantity: 0.0001 }]) });

        expect(statuses(values).ingredients).toEqual({
            kind: 'attention',
            reason: 'ingredientsQuantityInvalid',
            count: 1,
        });
    });

    it('a line with no food outranks the text being typed, which the validator reports first', () => {
        const values = makeFilledRecipeFormValues({ ingredients: withLineKeys([UNRESOLVED]) });

        expect(statuses(values, { pending: 'flour' }).ingredients).toMatchObject({ reason: 'ingredientsUnresolved' });
    });

    it('is in progress, not alarmed, while the cook is typing a line they have not added', () => {
        const values = makeFilledRecipeFormValues({ ingredients: [] });

        expect(statuses(values, { pending: 'flour' }).ingredients).toEqual({
            kind: 'inProgress',
            reason: 'ingredientsPendingText',
        });
    });
});

describe('Steps', () => {
    it('is in progress when a step has text and another is blank', () => {
        const values = makeFilledRecipeFormValues({ steps: [{ instruction: 'Boil.' }, { instruction: ' ' }] });

        expect(statuses(values).steps).toEqual({ kind: 'inProgress', reason: 'stepBlank' });
    });

    it('is not started while every step is blank', () => {
        const values = makeFilledRecipeFormValues({ steps: [{ instruction: '' }] });

        expect(statuses(values).steps).toEqual({ kind: 'notStarted' });
    });
});

describe('Photos & publish', () => {
    it('stays optional until all three other sections are complete', () => {
        expect(statuses(makeFilledRecipeFormValues({ steps: [] })).photos).toEqual({ kind: 'optional' });
    });
});

describe('after a refused Publish', () => {
    it('every section with a blocking error is "Fix before publishing", with how many things to fix', () => {
        const values = makeFilledRecipeFormValues({
            title: '',
            servings: 0,
            ingredients: withLineKeys([UNRESOLVED, UNRESOLVED, RESOLVED]),
            steps: [],
        });

        expect(statuses(values, { attempted: true })).toEqual({
            details: { kind: 'fix', count: 2 },
            ingredients: { kind: 'fix', count: 2 },
            steps: { kind: 'fix', count: 1 },
            photos: { kind: 'optional' },
        });
    });

    it('a section that was fixed reads complete again', () => {
        expect(statuses(makeFilledRecipeFormValues(), { attempted: true }).details).toEqual({ kind: 'complete' });
    });
});

describe('doneCount and newlyComplete', () => {
    it('counts only real Complete statuses', () => {
        expect(doneCount(statuses(defaultRecipeFormValues()))).toBe(0);
        expect(doneCount(statuses(makeFilledRecipeFormValues({ steps: [] })))).toBe(2);
        expect(doneCount(statuses(makeFilledRecipeFormValues()))).toBe(4);
    });

    it('names the sections that became complete, in page order, and nothing that already was', () => {
        const before = statuses(makeFilledRecipeFormValues({ steps: [] }));
        const after = statuses(makeFilledRecipeFormValues());

        expect(newlyComplete(before, after)).toEqual(['steps', 'photos']);
        expect(newlyComplete(after, after)).toEqual([]);
        expect(newlyComplete(after, before)).toEqual([]);
    });
});
