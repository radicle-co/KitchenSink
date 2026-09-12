/**
 * Unit tests for the 409 merge: per-field composition, per-element selection, and the snapshot projections (`versions/merge.ts`).
 *
 * ⚠️ These 3 describe blocks came from `model.test.ts`, which covered all of
 * `versions/model.ts` before it was split into one module per concern. No assertion was
 * changed, added or dropped in the move — the suite is redistributed, not rewritten.
 */
import { describe, expect, it } from 'vitest';
import type { RecipeFormIngredient, RecipeFormStep } from '../../form/values.js';
import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import { makeIngredient } from '../__fixtures__/index.js';
import { type RecipeMergeSelections, composeConflictMerge, composeMergedRecipe, draftToSnapshot } from '../merge.js';
import { toVersionPreviewIngredientLines } from '../preview.js';
import { recipeVersionMessages } from '../messages.js';

const preview = recipeVersionMessages.en.preview;

describe('composeMergedRecipe (FR-007c — per-field, never last-write-wins)', () => {
    const mine = makeRecipeFormValues({
        title: 'My Title',
        servings: 6,
        cuisine: 'Thai',
        ingredients: [{ ingredientId: 'mine', name: 'Mine', quantity: 1 }],
    });
    const theirs = makeRecipeFormValues({
        title: 'Their Title',
        servings: 4,
        cuisine: 'Italian',
        ingredients: [
            { ingredientId: 'x', name: 'X', quantity: 1 },
            { ingredientId: 'y', name: 'Y', quantity: 2 },
        ],
    });

    it('all-mine selections reproduce the draft exactly (an absent key defaults to "mine")', () => {
        expect(composeMergedRecipe(mine, theirs, {})).toEqual(mine);
    });

    it('takes each field from its chosen side — a real merge, not one whole side (mutation lens)', () => {
        // Keep my title + my cuisine, but pull in THEIR servings and THEIR ingredients.
        const selections: RecipeMergeSelections = {
            title: 'mine',
            servings: 'theirs',
            cuisine: 'mine',
            ingredients: 'theirs',
        };

        const merged = composeMergedRecipe(mine, theirs, selections);

        // A merge that ignored per-field choice and took one whole side would fail at least one of these.
        expect(merged.title).toBe('My Title');
        expect(merged.cuisine).toBe('Thai');
        expect(merged.servings).toBe(4);
        expect(merged.ingredients).toEqual(theirs.ingredients);
        // And it must equal NEITHER pure side.
        expect(merged).not.toEqual(mine);
        expect(merged).not.toEqual(theirs);
    });

    it('a field left at its default (absent from selections) resolves to the user’s draft', () => {
        const merged = composeMergedRecipe(mine, theirs, { servings: 'theirs' });

        expect(merged.servings).toBe(4);
        expect(merged.title).toBe('My Title');
        expect(merged.cuisine).toBe('Thai');
    });

    it('does not mutate either input', () => {
        const mineSnapshot = structuredClone(mine);
        const theirsSnapshot = structuredClone(theirs);

        composeMergedRecipe(mine, theirs, { title: 'theirs', servings: 'theirs' });

        expect(mine).toEqual(mineSnapshot);
        expect(theirs).toEqual(theirsSnapshot);
    });
});

describe('composeConflictMerge (W7 Task 5 — per-element merge, mutation lens)', () => {
    const mineStep = (n: number): RecipeFormStep => ({ instruction: `Mine step ${n}` });
    const theirsStep = (n: number): RecipeFormStep => ({ instruction: `Theirs step ${n}` });
    const mineIngredient = (id: string): RecipeFormIngredient => ({
        ingredientId: id,
        name: `Mine ${id}`,
        quantity: 1,
    });
    const theirsIngredient = (id: string): RecipeFormIngredient => ({
        ingredientId: id,
        name: `Theirs ${id}`,
        quantity: 2,
    });

    const mine = makeRecipeFormValues({
        title: 'My Title',
        servings: 6,
        steps: [mineStep(1), mineStep(2), mineStep(3)],
        ingredients: [mineIngredient('a'), mineIngredient('b'), mineIngredient('c')],
    });
    const theirs = makeRecipeFormValues({
        title: 'Their Title',
        servings: 4,
        steps: [theirsStep(1), theirsStep(2), theirsStep(3)],
        ingredients: [theirsIngredient('a'), theirsIngredient('b'), theirsIngredient('c')],
    });

    it('a scalar selection swaps ONLY that scalar (delegates to composeMergedRecipe)', () => {
        const merged = composeConflictMerge(mine, theirs, { title: 'theirs' });

        expect(merged.title).toBe('Their Title');
        // Every OTHER top-level field — including the untouched whole arrays — stays mine's.
        expect(merged.servings).toBe(6);
        expect(merged.steps).toEqual(mine.steps);
        expect(merged.ingredients).toEqual(mine.ingredients);
    });

    it('a `steps[N]` selection swaps ONLY that index — every other step is untouched (mutation lens)', () => {
        const merged = composeConflictMerge(mine, theirs, { 'steps[1]': 'theirs' });

        // A merge that swapped the whole array, the wrong index, or dropped a step would fail one of these.
        expect(merged.steps).toEqual([mineStep(1), theirsStep(2), mineStep(3)]);
        expect(merged.steps).toHaveLength(3);
        // Unrelated top-level fields are untouched.
        expect(merged.title).toBe('My Title');
        expect(merged.ingredients).toEqual(mine.ingredients);
    });

    it('multiple `steps[N]` selections each swap only their own index', () => {
        const merged = composeConflictMerge(mine, theirs, { 'steps[0]': 'theirs', 'steps[2]': 'theirs' });

        expect(merged.steps).toEqual([theirsStep(1), mineStep(2), theirsStep(3)]);
    });

    it('an `ingredients:<id>` selection swaps ONLY that identity — every other ingredient is untouched', () => {
        const merged = composeConflictMerge(mine, theirs, { 'ingredients:b': 'theirs' });

        expect(merged.ingredients).toEqual([mineIngredient('a'), theirsIngredient('b'), mineIngredient('c')]);
        expect(merged.ingredients).toHaveLength(3);
        expect(merged.steps).toEqual(mine.steps);
    });

    it('combines per-element step AND ingredient selections independently', () => {
        const merged = composeConflictMerge(mine, theirs, { 'steps[2]': 'theirs', 'ingredients:a': 'theirs' });

        expect(merged.steps).toEqual([mineStep(1), mineStep(2), theirsStep(3)]);
        expect(merged.ingredients).toEqual([theirsIngredient('a'), mineIngredient('b'), mineIngredient('c')]);
    });

    it('with NO per-element key, steps/ingredients stay the whole-array default (mine) — identical to composeMergedRecipe', () => {
        const merged = composeConflictMerge(mine, theirs, { title: 'theirs' });

        expect(merged.steps).toEqual(composeMergedRecipe(mine, theirs, { title: 'theirs' }).steps);
        expect(merged.ingredients).toEqual(composeMergedRecipe(mine, theirs, { title: 'theirs' }).ingredients);
    });

    it('does not mutate either input', () => {
        const mineSnapshot = structuredClone(mine);
        const theirsSnapshot = structuredClone(theirs);

        composeConflictMerge(mine, theirs, { 'steps[1]': 'theirs', 'ingredients:a': 'theirs' });

        expect(mine).toEqual(mineSnapshot);
        expect(theirs).toEqual(theirsSnapshot);
    });
});

/**
 * U26/U27 — the version layer's three mappers, each of which loses data silently if a field is missed.
 *
 * ⛔ `draftToSnapshot` is the LOCAL side of the three-way conflict merge, and `toConflictSideDetail` builds
 * the SERVER and BASE sides. A field one side cannot REPRESENT is a field the merge can never report a
 * conflict about — so the cook's edit is dropped in favour of the other side, with no conflict banner and
 * nothing to notice.
 */
describe('U26/U27 — the preparation and the section survive the version layer', () => {
    it('draftToSnapshot carries both onto the local side of the merge', () => {
        const snapshot = draftToSnapshot(
            makeRecipeFormValues({
                ingredients: [
                    {
                        ingredientId: 'ing-1',
                        name: 'Onion',
                        quantity: 2,
                        preparation: 'finely chopped',
                        groupLabel: 'For the marinade',
                    },
                ],
            }),
            1,
        );

        expect(snapshot.ingredients[0]).toMatchObject({
            preparation: 'finely chopped',
            groupLabel: 'For the marinade',
        });
    });

    it('draftToSnapshot OMITS both for a line stating neither, and TRIMS a padded one', () => {
        const snapshot = draftToSnapshot(
            makeRecipeFormValues({
                ingredients: [
                    { ingredientId: 'ing-1', name: 'Onion', quantity: 2, preparation: '  ', groupLabel: ' Dry ' },
                ],
            }),
            1,
        );

        expect(snapshot.ingredients[0]).not.toHaveProperty('preparation');
        expect(snapshot.ingredients[0]?.groupLabel).toBe('Dry');
    });

    /**
     * ⛔ U26's headline rule, at the ONE place in this package that already folds a field into the name.
     * `displayText` is an author-chosen DISPLAY override and is parenthesised beside the name deliberately;
     * a preparation is a field of its own and is appended as a trailing CLAUSE instead. A name carrying a
     * preparation matches no catalog row.
     */
    it('⛔ the preview appends the preparation as a CLAUSE and never folds it into the name', () => {
        const [line] = toVersionPreviewIngredientLines(
            [
                makeIngredient({
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cups',
                    ingredientName: 'Onion',
                    preparation: 'finely chopped',
                }),
            ],
            preview,
            'en',
        );

        expect(line?.text).toBe('2 cups Onion, finely chopped');
        // ⛔ Never the parenthesised `displayText` form — that idiom is one copy-paste away at all times.
        expect(line?.text).not.toContain('(finely chopped)');
    });

    // ⛔ F4 — the SECTION is on the same footing as the preparation: `diffSnapshots` counts a section-only
    // edit as `modified`, so a preview that omitted it would show two identical lines beside a history entry
    // claiming one changed.
    it('⛔ the preview shows the SECTION too, so a section-only edit is visible in the history', () => {
        const [line] = toVersionPreviewIngredientLines(
            [makeIngredient({ ingredientName: 'Flour', unit: 'cups', groupLabel: 'Dry' })],
            preview,
            'en',
        );

        expect(line?.text).toContain('[Dry]');
    });

    it('the preview renders a line with NO preparation exactly as it did before U26', () => {
        const [line] = toVersionPreviewIngredientLines(
            [makeIngredient({ quantity: { kind: 'exact', value: 2 }, unit: 'cups', ingredientName: 'Onion' })],
            preview,
            'en',
        );

        expect(line?.text).toBe('2 cups Onion');
    });
});
