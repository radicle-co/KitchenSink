// @vitest-environment jsdom
/**
 * Component tests for the web Review step body (U33) — the surface that REPLACED the deleted `Preview`
 * overlay, and the reason that deletion was safe.
 *
 * ⛔ **The load-bearing property is the coverage inheritance.** The Preview panel rendered exactly six rows
 * (title, description, servings, ingredient count, step count, visibility) and its own describe block was
 * deleted with it. Every one of those six is asserted here, by name, so "Review renders every field the
 * deleted Preview rendered" is a checked property rather than a claim in a commit message. The rest of the
 * draft is covered too, because a REVIEW step that omits a field is worse than no review at all: it invites
 * a cook to publish believing they have seen everything.
 *
 * ⛔ **It is PURE `props -> JSX`.** No fetching, no mutation, no state — the whole point of moving the draft
 * summary onto a wizard step is that it reads the SAME `values` the other three steps edit, so it cannot
 * drift from them the way a second surface with its own props did.
 *
 * ⚠️ Absent optional fields render an explicit "not stated" line rather than disappearing. A row that
 * vanishes is indistinguishable from a row a cook has not scrolled to, and "did I set a difficulty?" is
 * exactly the question this step exists to answer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import { RecipeReviewFields } from '../RecipeReviewFields.js';
import type { RecipeFormValues } from '../model.js';

afterEach(cleanup);

const renderReview = (over: Partial<RecipeFormValues> = {}): void => {
    render(<RecipeReviewFields values={makeRecipeFormValues(over)} />);
};

/** The value rendered against a row's label, as a screen reader would pair them. */
const valueFor = (label: string): string => {
    const term = screen.getByText(label);
    const value = term.nextElementSibling;

    if (value === null) {
        throw new Error(`review row "${label}" has no value beside it`);
    }

    return value.textContent ?? '';
};

describe('RecipeReviewFields (web) — the six rows the deleted Preview panel carried', () => {
    it('names the step so a cook knows this is the last look, not another form', () => {
        renderReview();

        expect(screen.getByRole('heading', { name: 'Review' })).toBeTruthy();
    });

    it('shows the title', () => {
        renderReview({ title: 'Herb Risotto' });

        expect(valueFor('Title')).toBe('Herb Risotto');
    });

    it('shows the description', () => {
        renderReview({ description: 'Creamy and slow.' });

        expect(valueFor('Description')).toBe('Creamy and slow.');
    });

    it('shows the servings', () => {
        renderReview({ servings: 6 });

        expect(valueFor('Servings')).toBe('6');
    });

    it('shows the ingredient count', () => {
        renderReview({
            ingredients: [
                { ingredientId: 'a', name: 'Rice', quantity: 1 },
                { ingredientId: 'b', name: 'Stock', quantity: 2 },
            ],
        });

        expect(valueFor('Ingredients')).toBe('2');
    });

    it('shows the step count', () => {
        renderReview({ steps: [{ instruction: 'Toast.' }, { instruction: 'Stir.' }, { instruction: 'Rest.' }] });

        expect(valueFor('Steps')).toBe('3');
    });

    it('shows the visibility, in words rather than the wire value', () => {
        renderReview({ visibility: 'private' });

        expect(valueFor('Visibility')).toBe('Private');
    });

    it('shows public visibility too, so the row is never ambiguous by omission', () => {
        renderReview({ visibility: 'public' });

        expect(valueFor('Visibility')).toBe('Public');
    });
});

describe('RecipeReviewFields (web) — the rest of the draft, which Preview never showed', () => {
    it('shows the cuisine, the difficulty and the meal type when stated', () => {
        renderReview({ cuisine: 'Italian', difficulty: 'medium', mealType: 'dinner' });

        expect(valueFor('Cuisine')).toBe('Italian');
        expect(valueFor('Difficulty')).toBe('Medium');
        expect(valueFor('Meal type')).toBe('Dinner');
    });

    // ⛔ Absence is STATED, never rendered as a missing row — a row that vanishes is indistinguishable from
    // a row the cook has not reached, and "did I set that?" is the question this step answers.
    it('states an unstated cuisine, difficulty and meal type rather than dropping the rows', () => {
        renderReview({ cuisine: '', difficulty: undefined, mealType: undefined });

        expect(valueFor('Cuisine')).toBe('Not stated');
        expect(valueFor('Difficulty')).toBe('Not stated');
        expect(valueFor('Meal type')).toBe('Not stated');
    });

    it('states an empty description rather than showing a blank row', () => {
        renderReview({ description: '' });

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
        expect(valueFor('Tags')).toContain('one pot');
        expect(valueFor('Dietary flags')).toBe('vegan');
    });

    it('states an empty tag or dietary list rather than leaving the row blank', () => {
        renderReview({ tags: [], dietaryFlags: [] });

        expect(valueFor('Tags')).toBe('None');
        expect(valueFor('Dietary flags')).toBe('None');
    });

    it('names each ingredient, because "did I get the ingredients right" is what a cook re-reads', () => {
        renderReview({
            ingredients: [
                { ingredientId: 'a', name: 'Arborio rice', quantity: 300, unit: 'g' },
                { ingredientId: 'b', name: 'Parmesan', quantity: 50, unit: 'g' },
            ],
        });

        const list = screen.getByRole('list', { name: 'Ingredients' });

        expect(within(list).getByText(/Arborio rice/u)).toBeTruthy();
        expect(within(list).getByText(/Parmesan/u)).toBeTruthy();
    });

    it('shows the empty ingredient state instead of an empty list a cook could mistake for a render bug', () => {
        renderReview({ ingredients: [] });

        expect(screen.getByText('No ingredients yet.')).toBeTruthy();
        expect(screen.queryByRole('list', { name: 'Ingredients' })).toBeNull();
    });
});

describe('RecipeReviewFields (web) — photos are a field here, not a step (U33)', () => {
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
        // ⚠️ The ONE row that may disappear, and deliberately: "0 photos to upload" is chrome about an
        // operation that is not going to happen, on the step whose job is to be scannable.
        renderReview({ photos: [] });

        expect(screen.queryByText('Photos to upload')).toBeNull();
    });
});
