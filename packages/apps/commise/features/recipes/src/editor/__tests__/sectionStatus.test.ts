/**
 * Each editor section's status (build spec §7.2), derived from the ONE publish validator so the section index and
 * Publish can never disagree. Precedence: Fix before publishing (after a refused Publish) > Needs attention (a known
 * blocker) > In progress > Not started; Photos & publish is Optional until the other three are complete.
 */
import { describe, expect, it } from 'vitest';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { makeFilledRecipeFormValues, withLineKeys } from '../../__fixtures__/index.js';
import { rowPresentationOf, type RowFacts } from '../../form/ingredientRowPolicy.js';
import { TITLE_MAX_LENGTH } from '../../form/limits.js';
import { validateRecipeForm } from '../../form/validate.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../../form/values.js';
import {
    doneCount,
    lineNeedsAttention,
    newlyComplete,
    sectionStatusesOf,
    type SectionStatuses,
} from '../sectionStatus.js';

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

/**
 * UX F4 (`docs/design/uiOverhaul/evaluateFinal.md`): the index said Ingredients was complete and "Ready to publish"
 * while rows said "Choose a match" or "No match found". The recipe service publishes any line whose binding exists,
 * whatever its food's resolution (`ingredientLine.planner.ts` refuses only an unknown binding; `recipes.service.ts`
 * only an empty list), so Publish stays allowed — but the index must not call the section done while a row asks the
 * cook to act (GOV.UK task list: done is only done). A row asks exactly when its glyph is `alert`
 * (`ingredientRowPolicy.ts`), so that is the one rule the index reads.
 */
describe('Ingredients with a line whose food needs the cook (F4)', () => {
    const bound = (resolutionStatus: FoodResolutionStatus) => ({ ...RESOLVED, resolutionStatus });
    const FACTS: readonly RowFacts[] = [
        { figures: undefined, hasVariants: undefined, changing: false },
        { figures: 'published', hasVariants: true, changing: false },
        { figures: 'unpublished', hasVariants: false, changing: true },
    ];

    it.each(Object.values(FoodResolutionStatus))(
        'a %s line needs attention exactly when its row shows an alert',
        (status) => {
            const line = withLineKeys([bound(status)])[0]!;

            for (const facts of FACTS) {
                expect(lineNeedsAttention(line)).toBe(rowPresentationOf(line, facts).glyph === 'alert');
            }
        },
    );

    it('a line with no food and a declared line ("Use as written") follow their rows too', () => {
        const [unresolved, declared] = withLineKeys([UNRESOLVED, { ...RESOLVED, isUserEntered: true }]);

        expect(lineNeedsAttention(unresolved!)).toBe(true);
        expect(lineNeedsAttention(declared!)).toBe(false);
    });

    it.each([
        FoodResolutionStatus.UNRESOLVED,
        FoodResolutionStatus.AMBIGUOUS,
        FoodResolutionStatus.NOT_FOUND,
        FoodResolutionStatus.FAILED,
        FoodResolutionStatus.FOOD_REMOVED,
        FoodResolutionStatus.NEEDS_REVIEW,
    ])('a publishable recipe with a %s line: Ingredients needs attention, and Photos is not "Ready"', (status) => {
        const values = makeFilledRecipeFormValues({ ingredients: withLineKeys([RESOLVED, bound(status)]) });

        // Publish is not refused: the service accepts the line, and the validator adds no refusal of its own.
        expect(validateRecipeForm(values, '')).toEqual({});
        expect(statuses(values).ingredients).toEqual({ kind: 'attention', reason: 'ingredientsUnresolved', count: 1 });
        expect(statuses(values).photos).toEqual({ kind: 'optional' });
        expect(doneCount(statuses(values))).toBe(2);
    });

    it.each([
        FoodResolutionStatus.RESOLVED,
        FoodResolutionStatus.PENDING,
        FoodResolutionStatus.PENDING_VERIFICATION,
        FoodResolutionStatus.RESOLVED_UNAVAILABLE,
        FoodResolutionStatus.FOOD_UNREACHABLE,
    ])('a %s line asks nothing of the cook: Ingredients stays complete', (status) => {
        const values = makeFilledRecipeFormValues({ ingredients: withLineKeys([bound(status)]) });

        expect(statuses(values).ingredients).toEqual({ kind: 'complete' });
    });

    it('a refused Publish does not turn a line that does not block into "Fix"', () => {
        const values = makeFilledRecipeFormValues({
            title: '',
            ingredients: withLineKeys([bound(FoodResolutionStatus.NOT_FOUND)]),
        });

        expect(statuses(values, { attempted: true }).ingredients).toEqual({
            kind: 'attention',
            reason: 'ingredientsUnresolved',
            count: 1,
        });
    });

    it('counts every line that needs a match, blocking or not', () => {
        const values = makeFilledRecipeFormValues({
            ingredients: withLineKeys([UNRESOLVED, bound(FoodResolutionStatus.AMBIGUOUS), RESOLVED]),
        });

        expect(statuses(values).ingredients).toEqual({ kind: 'attention', reason: 'ingredientsUnresolved', count: 2 });
    });

    it('a blocking amount outranks a line that only needs a match', () => {
        const values = makeFilledRecipeFormValues({
            ingredients: withLineKeys([{ ...RESOLVED, quantity: 0.0001 }, bound(FoodResolutionStatus.NOT_FOUND)]),
        });

        expect(statuses(values).ingredients).toMatchObject({ reason: 'ingredientsQuantityInvalid' });
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
