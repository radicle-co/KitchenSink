/**
 * Unit tests for {@link computeConflictDiff} (W7 Task 1) — the pure 3-way (base/mine/theirs) conflict diff
 * the W7 conflict-resolution UI consumes. Mutation-lens: every assertion is exact (not "truthy") so a
 * swapped `changed`/`conflict` marker, a mis-attributed `mineChanged`/`theirsChanged`, an unchanged field
 * leaking into `rows`, or a naive "both changed = conflict" would fail a case here.
 */
import { describe, expect, it } from 'vitest';

import type { RecipeIngredient, RecipeSnapshot, RecipeStep } from '@kitchensink/recipe-core';

import { computeConflictDiff } from '../conflictDiff.js';

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
    quantity: { kind: 'exact', value: 2 },
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

describe('computeConflictDiff', () => {
    it('reports isEmpty/no rows/no conflict when mine and theirs both equal base', () => {
        const base = makeSnapshot();
        const mine = makeSnapshot();
        const theirs = makeSnapshot();

        const diff = computeConflictDiff(base, mine, theirs, 'en');

        expect(diff).toEqual({ rows: [], hasConflict: false, isEmpty: true });
    });

    it('reports one changed row when only mine changed the title', () => {
        const base = makeSnapshot({ title: 'Weeknight Pasta' });
        const mine = makeSnapshot({ title: 'Weeknight Pasta, Revised' });
        const theirs = makeSnapshot({ title: 'Weeknight Pasta' });

        const diff = computeConflictDiff(base, mine, theirs, 'en');

        expect(diff.rows).toEqual([
            {
                key: 'title',
                fieldKind: 'title',
                marker: 'changed',
                base: 'Weeknight Pasta',
                mine: 'Weeknight Pasta, Revised',
                theirs: 'Weeknight Pasta',
                mineChanged: true,
                theirsChanged: false,
            },
        ]);
        expect(diff.hasConflict).toBe(false);
        expect(diff.isEmpty).toBe(false);
    });

    it('reports one changed row when only theirs changed servings', () => {
        const base = makeSnapshot({ servings: 4 });
        const mine = makeSnapshot({ servings: 4 });
        const theirs = makeSnapshot({ servings: 6 });

        const diff = computeConflictDiff(base, mine, theirs, 'en');

        expect(diff.rows).toEqual([
            {
                key: 'servings',
                fieldKind: 'servings',
                marker: 'changed',
                base: '4',
                mine: '4',
                theirs: '6',
                mineChanged: false,
                theirsChanged: true,
            },
        ]);
        expect(diff.hasConflict).toBe(false);
    });

    it('reports a conflict row when both sides changed the title DIFFERENTLY', () => {
        const base = makeSnapshot({ title: 'Weeknight Pasta' });
        const mine = makeSnapshot({ title: 'Weeknight Pasta, Mine' });
        const theirs = makeSnapshot({ title: 'Weeknight Pasta, Theirs' });

        const diff = computeConflictDiff(base, mine, theirs, 'en');

        expect(diff.rows).toEqual([
            {
                key: 'title',
                fieldKind: 'title',
                marker: 'conflict',
                base: 'Weeknight Pasta',
                mine: 'Weeknight Pasta, Mine',
                theirs: 'Weeknight Pasta, Theirs',
                mineChanged: true,
                theirsChanged: true,
            },
        ]);
        expect(diff.hasConflict).toBe(true);
    });

    it('reports `changed` (NOT conflict) when both sides changed the title to the SAME value', () => {
        const base = makeSnapshot({ title: 'Weeknight Pasta' });
        const mine = makeSnapshot({ title: 'Weeknight Pasta, Revised' });
        const theirs = makeSnapshot({ title: 'Weeknight Pasta, Revised' });

        const diff = computeConflictDiff(base, mine, theirs, 'en');

        // A naive "both changed = conflict" implementation would report `conflict` and hasConflict:true here.
        expect(diff.rows).toEqual([
            {
                key: 'title',
                fieldKind: 'title',
                marker: 'changed',
                base: 'Weeknight Pasta',
                mine: 'Weeknight Pasta, Revised',
                theirs: 'Weeknight Pasta, Revised',
                mineChanged: true,
                theirsChanged: true,
            },
        ]);
        expect(diff.hasConflict).toBe(false);
    });

    it('flags each changed scalar field independently, in declared order, excluding unchanged ones', () => {
        const base = makeSnapshot();
        const mine = makeSnapshot({ description: 'New description', cookTimeMinutes: 25 });
        const theirs = makeSnapshot();

        const diff = computeConflictDiff(base, mine, theirs, 'en');

        expect(diff.rows.map((row) => row.key)).toEqual(['description', 'cookTimeMinutes']);
        expect(diff.rows.every((row) => row.marker === 'changed')).toBe(true);
    });

    it('reports a changed row for a step changed at a single index, other steps absent', () => {
        const steps = [
            makeStep({ id: 'step_1', instruction: 'Preheat the oven.' }),
            makeStep({ id: 'step_2', instruction: 'Mix the dry ingredients.' }),
            makeStep({ id: 'step_3', instruction: 'Combine wet and dry.' }),
        ];
        const base = makeSnapshot({ steps });
        const mine = makeSnapshot({
            steps: [steps[0]!, steps[1]!, makeStep({ id: 'step_3', instruction: 'Fold wet into dry gently.' })],
        });
        const theirs = makeSnapshot({ steps });

        const diff = computeConflictDiff(base, mine, theirs, 'en');

        expect(diff.rows).toEqual([
            {
                key: 'steps[2]',
                fieldKind: 'step',
                marker: 'changed',
                base: 'Combine wet and dry.',
                mine: 'Fold wet into dry gently.',
                theirs: 'Combine wet and dry.',
                mineChanged: true,
                theirsChanged: false,
            },
        ]);
    });

    it('reports a changed row for an ingredient changed on one side, keyed by its ingredientId', () => {
        const ingredients = [
            makeIngredient({ ingredientId: 'ing_1', quantity: { kind: 'exact', value: 2 }, unit: 'tbsp' }),
        ];
        const base = makeSnapshot({ ingredients });
        const mine = makeSnapshot({
            ingredients: [
                makeIngredient({ ingredientId: 'ing_1', quantity: { kind: 'exact', value: 3 }, unit: 'tbsp' }),
            ],
        });
        const theirs = makeSnapshot({ ingredients });

        const diff = computeConflictDiff(base, mine, theirs, 'en');

        expect(diff.rows).toEqual([
            {
                key: 'ingredients:ing_1',
                fieldKind: 'ingredient',
                marker: 'changed',
                base: '2 tbsp Olive oil',
                mine: '3 tbsp Olive oil',
                theirs: '2 tbsp Olive oil',
                mineChanged: true,
                theirsChanged: false,
            },
        ]);
    });

    it('reports an added step (present only on mine) with the base/theirs side empty', () => {
        const base = makeSnapshot({ steps: [makeStep({ id: 'step_1', instruction: 'Preheat the oven.' })] });
        const mine = makeSnapshot({
            steps: [
                makeStep({ id: 'step_1', instruction: 'Preheat the oven.' }),
                makeStep({ id: 'step_2', instruction: 'Grease the pan.' }),
            ],
        });
        const theirs = makeSnapshot({ steps: [makeStep({ id: 'step_1', instruction: 'Preheat the oven.' })] });

        const diff = computeConflictDiff(base, mine, theirs, 'en');

        expect(diff.rows).toEqual([
            {
                key: 'steps[1]',
                fieldKind: 'step',
                marker: 'changed',
                mine: 'Grease the pan.',
                theirs: '',
                mineChanged: true,
                theirsChanged: false,
            },
        ]);
    });

    it('reports a removed step (present only in base/theirs, absent from mine) with the mine side empty', () => {
        const steps = [
            makeStep({ id: 'step_1', instruction: 'Preheat the oven.' }),
            makeStep({ id: 'step_2', instruction: 'Grease the pan.' }),
        ];
        const base = makeSnapshot({ steps });
        const mine = makeSnapshot({ steps: [steps[0]!] });
        const theirs = makeSnapshot({ steps });

        const diff = computeConflictDiff(base, mine, theirs, 'en');

        expect(diff.rows).toEqual([
            {
                key: 'steps[1]',
                fieldKind: 'step',
                marker: 'changed',
                base: 'Grease the pan.',
                mine: '',
                theirs: 'Grease the pan.',
                mineChanged: true,
                theirsChanged: false,
            },
        ]);
    });

    it('reports an added ingredient (present only on theirs) with the base/mine side empty', () => {
        const ingredients = [makeIngredient({ ingredientId: 'ing_1' })];
        const base = makeSnapshot({ ingredients });
        const mine = makeSnapshot({ ingredients });
        const theirs = makeSnapshot({
            ingredients: [
                makeIngredient({ ingredientId: 'ing_1' }),
                makeIngredient({
                    id: 'ri_2',
                    ingredientId: 'ing_2',
                    ingredientName: 'Garlic',
                    quantity: { kind: 'exact', value: 1 },
                    unit: 'clove',
                }),
            ],
        });

        const diff = computeConflictDiff(base, mine, theirs, 'en');

        expect(diff.rows).toEqual([
            {
                key: 'ingredients:ing_2',
                fieldKind: 'ingredient',
                marker: 'changed',
                mine: '',
                theirs: '1 clove Garlic',
                mineChanged: false,
                theirsChanged: true,
            },
        ]);
    });

    it('reports a removed ingredient (absent from theirs) with the theirs side empty', () => {
        const ingredients = [
            makeIngredient({ ingredientId: 'ing_1' }),
            makeIngredient({
                id: 'ri_2',
                ingredientId: 'ing_2',
                ingredientName: 'Garlic',
                quantity: { kind: 'exact', value: 1 },
                unit: 'clove',
            }),
        ];
        const base = makeSnapshot({ ingredients });
        const mine = makeSnapshot({ ingredients });
        const theirs = makeSnapshot({ ingredients: [ingredients[0]!] });

        const diff = computeConflictDiff(base, mine, theirs, 'en');

        expect(diff.rows).toEqual([
            {
                key: 'ingredients:ing_2',
                fieldKind: 'ingredient',
                marker: 'changed',
                base: '1 clove Garlic',
                mine: '1 clove Garlic',
                theirs: '',
                mineChanged: false,
                theirsChanged: true,
            },
        ]);
    });

    describe('base evicted (undefined) — 2-way fallback', () => {
        it('classifies any mine !== theirs scalar field as conflict, with base absent', () => {
            const mine = makeSnapshot({ title: 'Mine Title', servings: 4 });
            const theirs = makeSnapshot({ title: 'Theirs Title', servings: 4 });

            const diff = computeConflictDiff(undefined, mine, theirs, 'en');

            expect(diff.rows).toEqual([
                {
                    key: 'title',
                    fieldKind: 'title',
                    marker: 'conflict',
                    mine: 'Mine Title',
                    theirs: 'Theirs Title',
                    mineChanged: true,
                    theirsChanged: true,
                },
            ]);
            expect(diff.hasConflict).toBe(true);
            expect(diff.rows[0]).not.toHaveProperty('base');
        });

        it('omits a scalar field entirely when mine and theirs already agree', () => {
            const mine = makeSnapshot({ title: 'Same Title' });
            const theirs = makeSnapshot({ title: 'Same Title' });

            const diff = computeConflictDiff(undefined, mine, theirs, 'en');

            expect(diff.rows).toEqual([]);
            expect(diff.isEmpty).toBe(true);
        });

        it('classifies a per-element step difference as conflict, with base absent', () => {
            const mine = makeSnapshot({ steps: [makeStep({ instruction: 'Mine instruction.' })] });
            const theirs = makeSnapshot({ steps: [makeStep({ instruction: 'Theirs instruction.' })] });

            const diff = computeConflictDiff(undefined, mine, theirs, 'en');

            expect(diff.rows).toEqual([
                {
                    key: 'steps[0]',
                    fieldKind: 'step',
                    marker: 'conflict',
                    mine: 'Mine instruction.',
                    theirs: 'Theirs instruction.',
                    mineChanged: true,
                    theirsChanged: true,
                },
            ]);
        });

        it('classifies a per-element ingredient difference as conflict, with base absent', () => {
            const mine = makeSnapshot({
                ingredients: [makeIngredient({ ingredientId: 'ing_1', quantity: { kind: 'exact', value: 2 } })],
            });
            const theirs = makeSnapshot({
                ingredients: [makeIngredient({ ingredientId: 'ing_1', quantity: { kind: 'exact', value: 5 } })],
            });

            const diff = computeConflictDiff(undefined, mine, theirs, 'en');

            expect(diff.rows).toEqual([
                {
                    key: 'ingredients:ing_1',
                    fieldKind: 'ingredient',
                    marker: 'conflict',
                    mine: '2 tbsp Olive oil',
                    theirs: '5 tbsp Olive oil',
                    mineChanged: true,
                    theirsChanged: true,
                },
            ]);
            expect(diff.hasConflict).toBe(true);
        });
    });
});
