/**
 * Component tests for the native Review step body (U33) — the mirror of `RecipeReviewFields.test.tsx`
 * against the RN leaf, run through react-native-web under jsdom per this package's native test convention.
 *
 * Same load-bearing property as the web spec: every row the DELETED `Preview` overlay carried is asserted
 * here by name, so the deletion of that surface (and of its own describe block in `Wizard.native.test.tsx`)
 * cost no coverage. Native's Preview panel rendered the identical six rows.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import { RecipeReviewFields } from '../RecipeReviewFields.native.js';
import type { RecipeFormValues } from '../model.js';

afterEach(cleanup);

const renderReview = (over: Partial<RecipeFormValues> = {}): void => {
    render(<RecipeReviewFields values={makeRecipeFormValues(over)} />);
};

/**
 * The value rendered inside a row, found by that row's own accessible label.
 *
 * The row renders its label first and its value second, so stripping the label prefix off the row's
 * `textContent` yields the value. Deliberately NOT `getByRole('text')`: `accessibilityRole="text"` is a
 * DEVICE trait that react-native-web projects to no ARIA role at all, so a role query here would be testing
 * the harness rather than the component (the same #123 class of gap the wizard's `aria-expanded` notes
 * record). The trait stays on the element because VoiceOver and TalkBack do read it.
 */
const valueFor = (label: string): string => (screen.getByLabelText(label).textContent ?? '').slice(label.length);

describe('RecipeReviewFields (native) — the six rows the deleted Preview panel carried', () => {
    it('names the step so a cook knows this is the last look, not another form', () => {
        renderReview();

        expect(screen.getByRole('heading', { name: 'Review' })).toBeTruthy();
    });

    it('shows the title, description, servings, counts and visibility', () => {
        renderReview({
            title: 'Herb Risotto',
            description: 'Creamy and slow.',
            servings: 6,
            visibility: 'private',
            ingredients: [
                { ingredientId: 'a', name: 'Rice', quantity: 1 },
                { ingredientId: 'b', name: 'Stock', quantity: 2 },
            ],
            steps: [{ instruction: 'Toast.' }, { instruction: 'Stir.' }],
        });

        expect(valueFor('Title')).toBe('Herb Risotto');
        expect(valueFor('Description')).toBe('Creamy and slow.');
        expect(valueFor('Servings')).toBe('6');
        expect(valueFor('Ingredients')).toBe('2');
        expect(valueFor('Steps')).toBe('2');
        expect(valueFor('Visibility')).toBe('Private');
    });

    it('shows public visibility too, so the row is never ambiguous by omission', () => {
        renderReview({ visibility: 'public' });

        expect(valueFor('Visibility')).toBe('Public');
    });
});

describe('RecipeReviewFields (native) — the rest of the draft', () => {
    it('shows the cuisine, the difficulty and the meal type when stated', () => {
        renderReview({ cuisine: 'Italian', difficulty: 'medium', mealType: 'dinner' });

        expect(valueFor('Cuisine')).toBe('Italian');
        expect(valueFor('Difficulty')).toBe('Medium');
        expect(valueFor('Meal type')).toBe('Dinner');
    });

    it('states an unstated cuisine, difficulty, meal type and description rather than dropping the rows', () => {
        renderReview({ cuisine: '', description: '', difficulty: undefined, mealType: undefined });

        expect(valueFor('Cuisine')).toBe('Not stated');
        expect(valueFor('Difficulty')).toBe('Not stated');
        expect(valueFor('Meal type')).toBe('Not stated');
        expect(valueFor('Description')).toBe('Not stated');
    });

    it('shows prep, cook and the computed total', () => {
        renderReview({ prepTimeMinutes: 10, cookTimeMinutes: 25 });

        expect(valueFor('Prep time')).toBe('10 min');
        expect(valueFor('Cook time')).toBe('25 min');
        expect(valueFor('Total time')).toBe('35 min');
    });

    it('lists tags and dietary flags as the free text they are, keeping the two axes apart', () => {
        renderReview({ tags: ['weeknight', 'one pot'], dietaryFlags: ['vegan'] });

        expect(valueFor('Tags')).toContain('weeknight');
        expect(valueFor('Dietary flags')).toBe('vegan');
    });

    it('states an empty tag or dietary list rather than leaving the row blank', () => {
        renderReview({ tags: [], dietaryFlags: [] });

        expect(valueFor('Tags')).toBe('None');
        expect(valueFor('Dietary flags')).toBe('None');
    });

    it('names each ingredient', () => {
        renderReview({
            ingredients: [
                { ingredientId: 'a', name: 'Arborio rice', quantity: 300, unit: 'g' },
                { ingredientId: 'b', name: 'Parmesan', quantity: 50, unit: 'g' },
            ],
        });

        const list = screen.getByLabelText('Ingredient list');

        expect(within(list).getByText(/Arborio rice/u)).toBeTruthy();
        expect(within(list).getByText(/Parmesan/u)).toBeTruthy();
    });

    it('shows the empty ingredient state instead of an empty list', () => {
        renderReview({ ingredients: [] });

        expect(screen.getByText('No ingredients yet.')).toBeTruthy();
        expect(screen.queryByLabelText('Ingredient list')).toBeFalsy();
    });
});

describe('RecipeReviewFields (native) — photos are a field here, not a step (U33)', () => {
    it('reports photos still waiting to upload, so a save is never silently two operations', () => {
        renderReview({
            photos: [
                { localId: 'one', fileName: 'a.png', contentType: 'image/png', fileSize: 10 },
                { localId: 'two', fileName: 'b.png', contentType: 'image/png', fileSize: 20 },
            ],
        });

        expect(valueFor('Photos to upload')).toBe('2');
    });

    it('omits the pending-photo row entirely when nothing is waiting', () => {
        renderReview({ photos: [] });

        expect(screen.queryByLabelText('Photos to upload')).toBeFalsy();
    });
});
