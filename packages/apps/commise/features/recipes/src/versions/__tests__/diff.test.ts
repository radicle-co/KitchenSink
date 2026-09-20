/**
 * Unit tests for {@link diffSnapshots} (W6 Task 1) — the pure snapshot comparison every other
 * version-history surface consumes. Mutation-lens: every assertion is exact (not "truthy") so a swapped
 * added/removed, a step wrongly counted as remove+add, or a leaked structural field (`id`, `stepNumber`)
 * would fail a case here.
 */
import { describe, expect, it } from 'vitest';

import { statedQuantity, type IngredientQuantity } from '@kitchensink/recipe-core';
import type { RecipeIngredient, RecipeSnapshot, RecipeStep } from '@kitchensink/recipe-core';

import { diffSnapshots } from '../diff.js';

/** A quantity the source stated exactly. */
function exactQuantity(value: number): IngredientQuantity {
    const quantity = statedQuantity(value);

    if (quantity === null) {
        throw new Error(`test fixture: ${value} is not a statable amount`);
    }

    return quantity;
}

/** A quantity the source stated as two bounds. */
function rangeQuantity(low: number, high: number): IngredientQuantity {
    const quantity = statedQuantity(low, high);

    if (quantity === null) {
        throw new Error(`test fixture: ${low}..${high} is not a statable range`);
    }

    return quantity;
}

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
    quantity: exactQuantity(2),
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
        const base = makeSnapshot({
            ingredients: [makeIngredient({ ingredientId: 'ing_1', quantity: exactQuantity(2) })],
        });
        const target = makeSnapshot({
            ingredients: [makeIngredient({ ingredientId: 'ing_1', quantity: exactQuantity(3) })],
        });

        const diff = diffSnapshots(base, target);

        expect(diff.ingredients).toEqual({ added: 0, removed: 0, modified: 1 });
        expect(diff.changedFields).toContain('ingredients');
        expect(diff.summary).toEqual({ added: 0, removed: 0, modified: 1 });
    });

    /**
     * ⚠️ U8 — THE EDIT THE PLAN NAMES AS MOST LIKELY TO GO UNNOTICED.
     *
     * `ingredientContentChanged` is a POSITIVE field-by-field enumeration, so a newly-modelled part of a
     * quantity is invisible to it BY CONSTRUCTION and no compile error catches the omission. Widening
     * `2 tbsp` to `2–3 tbsp` is a change a cook will act on; a diff that reported "no changes" for it would
     * be lying on the version-history screen.
     */
    it('counts a change to ONLY a range’s upper bound as modified', () => {
        const base = makeSnapshot({ ingredients: [makeIngredient({ quantity: rangeQuantity(2, 3) })] });
        const target = makeSnapshot({ ingredients: [makeIngredient({ quantity: rangeQuantity(2, 4) })] });

        expect(diffSnapshots(base, target).ingredients).toEqual({ added: 0, removed: 0, modified: 1 });
    });

    it('counts widening an exact quantity into a range as modified', () => {
        const base = makeSnapshot({ ingredients: [makeIngredient({ quantity: exactQuantity(2) })] });
        const target = makeSnapshot({ ingredients: [makeIngredient({ quantity: rangeQuantity(2, 3) })] });

        expect(diffSnapshots(base, target).ingredients).toEqual({ added: 0, removed: 0, modified: 1 });
    });

    /**
     * ⛔ THE OTHER HALF, and the one that fails LOUDLY if the comparison regresses to `!==`. A quantity is
     * an OBJECT now, so `base.quantity !== target.quantity` is reference identity: it is `true` for every
     * pair of separately-constructed values, and every ingredient of every version would read as modified.
     */
    it('does NOT count an identical range as changed — the comparison is by value, not by reference', () => {
        const base = makeSnapshot({ ingredients: [makeIngredient({ quantity: rangeQuantity(2, 3) })] });
        const target = makeSnapshot({ ingredients: [makeIngredient({ quantity: rangeQuantity(2, 3) })] });

        expect(diffSnapshots(base, target).ingredients).toEqual(ZERO_TALLY);
        expect(diffSnapshots(base, target).changedFields).not.toContain('ingredients');
    });

    it('does NOT count an identical EXACT quantity as changed', () => {
        const base = makeSnapshot({ ingredients: [makeIngredient({ quantity: exactQuantity(2) })] });
        const target = makeSnapshot({ ingredients: [makeIngredient({ quantity: exactQuantity(2) })] });

        expect(diffSnapshots(base, target).ingredients).toEqual(ZERO_TALLY);
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
            ingredients: [makeIngredient({ ingredientId: 'ing_1', quantity: exactQuantity(2) })],
        });
        const target = makeSnapshot({
            title: 'Weeknight Pasta, Revised',
            steps: [makeStep({ instruction: 'Preheat the oven.' }), makeStep({ id: 'step_2', instruction: 'Mix.' })],
            ingredients: [makeIngredient({ ingredientId: 'ing_1', quantity: exactQuantity(3) })],
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

/**
 * U26/U27 — the SAME positive-enumeration trap the range case above records, one migration later.
 *
 * ⛔ A version diff that reports "no changes" for an edit the cook made is a version-history screen that
 * LIES — and `ingredientContentChanged` names its fields one by one, so a new column is invisible to it and
 * nothing fails to compile. `computeConflictDiff` (`../conflictDiff.ts`) reuses the same predicate, so the
 * three-way merge inherits the lie: a concurrent edit to a preparation would read as "no conflict" and one
 * side's value would be lost without anyone being asked.
 */
describe('diffSnapshots — preparation + group label are CONTENT (U26/U27)', () => {
    it('counts a PREPARATION-only change as modified', () => {
        const base = makeSnapshot({ ingredients: [makeIngredient({ preparation: 'finely chopped' })] });
        const target = makeSnapshot({ ingredients: [makeIngredient({ preparation: 'roughly torn' })] });

        expect(diffSnapshots(base, target).ingredients).toEqual({ added: 0, removed: 0, modified: 1 });
    });

    it('counts a GROUP-LABEL-only change as modified — moving a line changes what the recipe says', () => {
        const base = makeSnapshot({ ingredients: [makeIngredient({ groupLabel: 'For the marinade' })] });
        const target = makeSnapshot({ ingredients: [makeIngredient({ groupLabel: 'For the topping' })] });

        expect(diffSnapshots(base, target).ingredients).toEqual({ added: 0, removed: 0, modified: 1 });
    });

    it('counts ADDING a preparation to a line that had none as modified', () => {
        const base = makeSnapshot({ ingredients: [makeIngredient({})] });
        const target = makeSnapshot({ ingredients: [makeIngredient({ preparation: 'melted' })] });

        expect(diffSnapshots(base, target).ingredients).toEqual({ added: 0, removed: 0, modified: 1 });
    });

    it('counts CLEARING a group label (ungrouping a line) as modified', () => {
        const base = makeSnapshot({ ingredients: [makeIngredient({ groupLabel: 'Dry' })] });
        const target = makeSnapshot({ ingredients: [makeIngredient({})] });

        expect(diffSnapshots(base, target).ingredients).toEqual({ added: 0, removed: 0, modified: 1 });
    });

    // ⛔ The other half: two lines that state neither must NOT read as modified. `undefined !== undefined`
    // is false, so this passes trivially today — it is here so a later `?? ''` normalisation on one side
    // only (the shape that breaks the equivalent server-side comparison) reds instead of shipping.
    it('does NOT count two lines that state neither as changed', () => {
        const base = makeSnapshot({ ingredients: [makeIngredient({})] });
        const target = makeSnapshot({ ingredients: [makeIngredient({})] });

        expect(diffSnapshots(base, target).ingredients).toEqual(ZERO_TALLY);
    });

    it('does NOT count two lines carrying the SAME preparation and section as changed', () => {
        const line = { preparation: 'finely chopped', groupLabel: 'For the marinade' };
        const base = makeSnapshot({ ingredients: [makeIngredient(line)] });
        const target = makeSnapshot({ ingredients: [makeIngredient(line)] });

        expect(diffSnapshots(base, target).ingredients).toEqual(ZERO_TALLY);
    });
});
