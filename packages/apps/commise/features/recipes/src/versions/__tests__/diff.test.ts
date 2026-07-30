/**
 * Unit tests for {@link diffSnapshots} (W6 Task 1) — the pure snapshot comparison every other
 * version-history surface consumes. Mutation-lens: every assertion is exact (not "truthy") so a swapped
 * added/removed, a step wrongly counted as remove+add, or a leaked structural field (`id`, `stepNumber`)
 * would fail a case here.
 */
import { describe, expect, it } from 'vitest';

import type { RecipeIngredient, RecipeSnapshot, RecipeStep } from '@kitchensink/recipe-core';

import { diffSnapshots } from '../diff.js';

/** Build a {@link RecipeStep} with sensible defaults, overridable per field. */
const makeStep = (overrides: Partial<RecipeStep> = {}): RecipeStep => ({
    id: 'step_1',
    recipeId: 'rec_1',
    stepNumber: 1,
    instruction: 'Combine the ingredients.',
    ...overrides,
});

/** Build a {@link RecipeIngredient} with sensible defaults, overridable per field. */
const makeIngredient = (overrides: Partial<RecipeIngredient> = {}): RecipeIngredient => ({
    id: 'ri_1',
    recipeId: 'rec_1',
    ingredientId: 'ing_1',
    quantity: 2,
    unit: 'tbsp',
    sortOrder: 1,
    ingredientName: 'Olive oil',
    isUserEntered: false,
    ...overrides,
});

/** Build a {@link RecipeSnapshot} with sensible defaults, overridable per field. */
const makeSnapshot = (overrides: Partial<RecipeSnapshot> = {}): RecipeSnapshot => ({
    version: 1,
    title: 'Weeknight Pasta',
    description: 'A fast, comforting weeknight dinner.',
    steps: [makeStep()],
    ingredients: [makeIngredient()],
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    ...overrides,
});

const ZERO_TALLY = { added: 0, removed: 0, modified: 0 };

describe('diffSnapshots', () => {
    it('reports no changes for identical snapshots', () => {
        const base = makeSnapshot();
        const target = makeSnapshot();

        const diff = diffSnapshots(base, target);

        expect(diff).toEqual({
            changedFields: [],
            steps: ZERO_TALLY,
            ingredients: ZERO_TALLY,
            summary: ZERO_TALLY,
        });
    });

    it('flags a changed title only, leaving steps/ingredients untouched', () => {
        const base = makeSnapshot({ title: 'Weeknight Pasta' });
        const target = makeSnapshot({ title: 'Weeknight Pasta, Revised' });

        const diff = diffSnapshots(base, target);

        expect(diff.changedFields).toEqual(['title']);
        expect(diff.steps).toEqual(ZERO_TALLY);
        expect(diff.ingredients).toEqual(ZERO_TALLY);
        expect(diff.summary).toEqual({ added: 0, removed: 0, modified: 1 });
    });

    it('flags each changed scalar field independently, in declared order', () => {
        const base = makeSnapshot();
        const target = makeSnapshot({ description: 'New description', servings: 6 });

        const diff = diffSnapshots(base, target);

        expect(diff.changedFields).toEqual(['description', 'servings']);
        expect(diff.summary).toEqual({ added: 0, removed: 0, modified: 2 });
    });

    it('counts an added step (target longer than base) as added, not modified', () => {
        const base = makeSnapshot({ steps: [makeStep({ instruction: 'Preheat the oven.' })] });
        const target = makeSnapshot({
            steps: [makeStep({ instruction: 'Preheat the oven.' }), makeStep({ id: 'step_2', instruction: 'Mix.' })],
        });

        const diff = diffSnapshots(base, target);

        expect(diff.steps).toEqual({ added: 1, removed: 0, modified: 0 });
        expect(diff.changedFields).toContain('steps');
        expect(diff.summary).toEqual({ added: 1, removed: 0, modified: 0 });
    });

    it('counts a removed step (base longer than target) as removed, not modified', () => {
        const base = makeSnapshot({
            steps: [makeStep({ instruction: 'Preheat the oven.' }), makeStep({ id: 'step_2', instruction: 'Mix.' })],
        });
        const target = makeSnapshot({ steps: [makeStep({ instruction: 'Preheat the oven.' })] });

        const diff = diffSnapshots(base, target);

        expect(diff.steps).toEqual({ added: 0, removed: 1, modified: 0 });
        expect(diff.changedFields).toContain('steps');
        expect(diff.summary).toEqual({ added: 0, removed: 1, modified: 0 });
    });

    it('counts a step changed at the same index as modified, NOT as a remove+add pair', () => {
        const base = makeSnapshot({ steps: [makeStep({ instruction: 'Preheat the oven to 350F.' })] });
        const target = makeSnapshot({ steps: [makeStep({ instruction: 'Preheat the oven to 400F.' })] });

        const diff = diffSnapshots(base, target);

        // A naive remove+add implementation would report { added: 1, removed: 1, modified: 0 } here.
        expect(diff.steps).toEqual({ added: 0, removed: 0, modified: 1 });
        expect(diff.changedFields).toContain('steps');
    });

    it('counts a step whose timer changed (same instruction) as modified', () => {
        const base = makeSnapshot({ steps: [makeStep({ timerSeconds: 60 })] });
        const target = makeSnapshot({ steps: [makeStep({ timerSeconds: 90 })] });

        const diff = diffSnapshots(base, target);

        expect(diff.steps).toEqual({ added: 0, removed: 0, modified: 1 });
    });

    it('counts an added ingredient (new ingredientId in target) as added', () => {
        const base = makeSnapshot({ ingredients: [makeIngredient({ ingredientId: 'ing_1' })] });
        const target = makeSnapshot({
            ingredients: [
                makeIngredient({ ingredientId: 'ing_1' }),
                makeIngredient({ id: 'ri_2', ingredientId: 'ing_2', ingredientName: 'Garlic' }),
            ],
        });

        const diff = diffSnapshots(base, target);

        expect(diff.ingredients).toEqual({ added: 1, removed: 0, modified: 0 });
        expect(diff.changedFields).toContain('ingredients');
        expect(diff.summary).toEqual({ added: 1, removed: 0, modified: 0 });
    });

    it('counts a removed ingredient (ingredientId absent from target) as removed', () => {
        const base = makeSnapshot({
            ingredients: [
                makeIngredient({ ingredientId: 'ing_1' }),
                makeIngredient({ id: 'ri_2', ingredientId: 'ing_2', ingredientName: 'Garlic' }),
            ],
        });
        const target = makeSnapshot({ ingredients: [makeIngredient({ ingredientId: 'ing_1' })] });

        const diff = diffSnapshots(base, target);

        expect(diff.ingredients).toEqual({ added: 0, removed: 1, modified: 0 });
        expect(diff.changedFields).toContain('ingredients');
        expect(diff.summary).toEqual({ added: 0, removed: 1, modified: 0 });
    });

    it('counts an ingredient with the same ingredientId but a changed quantity as modified', () => {
        const base = makeSnapshot({ ingredients: [makeIngredient({ ingredientId: 'ing_1', quantity: 2 })] });
        const target = makeSnapshot({ ingredients: [makeIngredient({ ingredientId: 'ing_1', quantity: 3 })] });

        const diff = diffSnapshots(base, target);

        expect(diff.ingredients).toEqual({ added: 0, removed: 0, modified: 1 });
        expect(diff.changedFields).toContain('ingredients');
        expect(diff.summary).toEqual({ added: 0, removed: 0, modified: 1 });
    });

    it('does NOT count an ingredient as changed when only its row id differs (regenerated per save)', () => {
        const base = makeSnapshot({ ingredients: [makeIngredient({ id: 'ri_old', ingredientId: 'ing_1' })] });
        const target = makeSnapshot({ ingredients: [makeIngredient({ id: 'ri_new', ingredientId: 'ing_1' })] });

        const diff = diffSnapshots(base, target);

        expect(diff.ingredients).toEqual(ZERO_TALLY);
        expect(diff.changedFields).not.toContain('ingredients');
    });

    it('rolls up multiple simultaneous changes correctly, with all changed field keys in stable order', () => {
        const base = makeSnapshot({
            title: 'Weeknight Pasta',
            steps: [makeStep({ instruction: 'Preheat the oven.' })],
            ingredients: [makeIngredient({ ingredientId: 'ing_1', quantity: 2 })],
        });
        const target = makeSnapshot({
            title: 'Weeknight Pasta, Revised',
            steps: [makeStep({ instruction: 'Preheat the oven.' }), makeStep({ id: 'step_2', instruction: 'Mix.' })],
            ingredients: [makeIngredient({ ingredientId: 'ing_1', quantity: 3 })],
        });

        const diff = diffSnapshots(base, target);

        // Declared field order (title, description, servings, prepTimeMinutes, cookTimeMinutes, steps,
        // ingredients) must be preserved regardless of the order changes were made in.
        expect(diff.changedFields).toEqual(['title', 'steps', 'ingredients']);
        expect(diff.steps).toEqual({ added: 1, removed: 0, modified: 0 });
        expect(diff.ingredients).toEqual({ added: 0, removed: 0, modified: 1 });
        expect(diff.summary).toEqual({ added: 1, removed: 0, modified: 2 });
    });

    it('ignores a stray non-snapshot field (e.g. tags) carried on the input objects', () => {
        const base = { ...makeSnapshot(), tags: ['quick', 'weeknight'] } as RecipeSnapshot & { tags: string[] };
        const target = { ...makeSnapshot(), tags: ['quick'] } as RecipeSnapshot & { tags: string[] };

        const diff = diffSnapshots(base, target);

        expect(diff).toEqual({
            changedFields: [],
            steps: ZERO_TALLY,
            ingredients: ZERO_TALLY,
            summary: ZERO_TALLY,
        });
    });

    it('does not mutate either input snapshot or its nested arrays', () => {
        const base = makeSnapshot({ steps: [makeStep({ instruction: 'Preheat the oven.' })] });
        const target = makeSnapshot({
            title: 'Changed',
            steps: [makeStep({ instruction: 'Preheat the oven.' }), makeStep({ id: 'step_2', instruction: 'Mix.' })],
        });
        const baseSnapshot = JSON.parse(JSON.stringify(base)) as RecipeSnapshot;
        const targetSnapshot = JSON.parse(JSON.stringify(target)) as RecipeSnapshot;

        diffSnapshots(base, target);

        expect(base).toEqual(baseSnapshot);
        expect(target).toEqual(targetSnapshot);
    });
});
