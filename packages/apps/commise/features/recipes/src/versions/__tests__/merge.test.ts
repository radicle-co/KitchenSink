/**
 * Unit tests for the 409 merge: per-field composition, per-element selection, and the snapshot projections (`versions/merge.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { RecipeFormIngredient, RecipeFormStep } from '../../form/values.js';
import { seedLineKey } from '../../form/lineKey.js';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import {
    makeIngredientView,
    makeRecipeDetail,
    makeRecipeFormValues,
    withLineKeys,
    withLineKey,
} from '../../__fixtures__/index.js';
import { makeIngredient, makeVersionConflictSide } from '../__fixtures__/index.js';
import {
    type RecipeMergeSelections,
    applyServerSnapshotToRecipeDetail,
    composeConflictMerge,
    composeMergedRecipe,
    draftToSnapshot,
} from '../merge.js';
import { computeConflictDiff } from '../conflictDiff.js';
import { toVersionPreviewIngredientLines } from '../preview.js';
import { recipeMessages } from '../../messages.js';
import { recipeVersionMessages } from '../messages.js';

const preview = recipeVersionMessages.en.preview;
const lineNames = recipeMessages.en.ingredientLineName;

describe('composeMergedRecipe (FR-007c — per-field, never last-write-wins)', () => {
    const mine = makeRecipeFormValues({
        title: 'My Title',
        servings: 6,
        cuisine: 'Thai',
        ingredients: withLineKeys([{ isUserEntered: false, ingredientId: 'mine', name: 'Mine', quantity: 1 }]),
    });
    const theirs = makeRecipeFormValues({
        title: 'Their Title',
        servings: 4,
        cuisine: 'Italian',
        ingredients: withLineKeys([
            { isUserEntered: false, ingredientId: 'x', name: 'X', quantity: 1 },
            { isUserEntered: false, ingredientId: 'y', name: 'Y', quantity: 2 },
        ]),
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
    const mineIngredient = (id: string): RecipeFormIngredient =>
        withLineKey({
            isUserEntered: false,
            ingredientId: id,
            name: `Mine ${id}`,
            quantity: 1,
        });
    const theirsIngredient = (id: string): RecipeFormIngredient =>
        withLineKey({
            isUserEntered: false,
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
describe('composeConflictMerge — line keys (plan 002 V1)', () => {
    /** A line as a seed of `version` would key it at `index`. */
    const lineAt = (version: number, index: number, ingredientId: string, name: string): RecipeFormIngredient => ({
        key: seedLineKey(version, index),
        isUserEntered: false,
        ingredientId,
        name,
        quantity: 1,
    });

    it('a line swapped to theirs keeps MINE\u2019s key, so the row the cook was looking at keeps its identity', () => {
        const mine = makeRecipeFormValues({ ingredients: [lineAt(7, 0, 'a', 'Mine a'), lineAt(7, 1, 'b', 'Mine b')] });
        const theirs = makeRecipeFormValues({
            ingredients: [lineAt(8, 0, 'a', 'Theirs a'), lineAt(8, 1, 'b', 'Theirs b')],
        });

        const merged = composeConflictMerge(mine, theirs, { 'ingredients:b': 'theirs' });

        expect(merged.ingredients.map((line) => [line.key, line.name])).toEqual([
            [seedLineKey(7, 0), 'Mine a'],
            [seedLineKey(7, 1), 'Theirs b'],
        ]);
    });

    it('⛔ two of MY lines on one binding, both swapped, stay two distinct keys (no duplicate React keys)', () => {
        const mine = makeRecipeFormValues({
            ingredients: [lineAt(7, 0, 'same', 'Mine 1'), lineAt(7, 1, 'same', 'Mine 2')],
        });
        const theirs = makeRecipeFormValues({ ingredients: [lineAt(8, 0, 'same', 'Theirs')] });

        const merged = composeConflictMerge(mine, theirs, { 'ingredients:same': 'theirs' });
        const keys = merged.ingredients.map((line) => line.key);

        expect(keys).toHaveLength(2);
        expect(new Set(keys).size).toBe(2);
    });

    it('a line only theirs has keeps theirs\u2019 key, which no line of mine can hold (different version)', () => {
        const mine = makeRecipeFormValues({ ingredients: [lineAt(7, 0, 'a', 'Mine a')] });
        const theirs = makeRecipeFormValues({ ingredients: [lineAt(8, 0, 'a', 'Theirs a'), lineAt(8, 1, 'n', 'New')] });

        const merged = composeConflictMerge(mine, theirs, { 'ingredients:n': 'theirs' });

        expect(merged.ingredients.map((line) => line.key)).toEqual([seedLineKey(7, 0), seedLineKey(8, 1)]);
    });
});

/**
 * A line with no food chosen is never stored (`isStoredLine`, `../../form/lineKey.ts`), so the per-element merge never
 * addresses it by identity: it stays on mine's side and is never brought over from theirs. `computeConflictDiff` emits
 * no `ingredients:` key for such a line, because `draftToSnapshot` drops it, so these cases pin the predicate rather
 * than a path the panel can reach.
 */
describe('composeConflictMerge — a line with no food chosen is not stored', () => {
    const noFood = (ingredientId: string | null, name: string, index: number): RecipeFormIngredient =>
        withLineKey({ isUserEntered: false, ingredientId, name, quantity: 1 }, index);
    const stored = (ingredientId: string, name: string, index: number): RecipeFormIngredient =>
        withLineKey({ isUserEntered: false, ingredientId, name, quantity: 2 }, index);

    it.each([
        ['null', null],
        ['an empty string', ''],
    ])('keeps my line whose id is %s, whatever the selections say', (_label, ingredientId) => {
        const mine = makeRecipeFormValues({
            ingredients: [noFood(ingredientId, 'Mine typed', 0), stored('a', 'Mine a', 1)],
        });
        const theirs = makeRecipeFormValues({ ingredients: [stored('a', 'Theirs a', 0)] });

        const merged = composeConflictMerge(mine, theirs, { 'ingredients:': 'theirs', 'ingredients:a': 'theirs' });

        expect(merged.ingredients.map((line) => line.name)).toEqual(['Mine typed', 'Theirs a']);
    });

    it.each([
        ['null', null],
        ['an empty string', ''],
    ])('never brings over a line of theirs whose id is %s', (_label, ingredientId) => {
        const mine = makeRecipeFormValues({ ingredients: [stored('a', 'Mine a', 0)] });
        const theirs = makeRecipeFormValues({
            ingredients: [stored('a', 'Theirs a', 0), noFood(ingredientId, 'Theirs typed', 1)],
        });

        const merged = composeConflictMerge(mine, theirs, { 'ingredients:': 'theirs' });

        expect(merged.ingredients.map((line) => line.name)).toEqual(['Mine a']);
    });
});

describe('draftToSnapshot — a declared line keeps its provenance on the local side of the merge', () => {
    const values = makeRecipeFormValues({
        ingredients: withLineKeys([
            { isUserEntered: true, ingredientId: 'declared-1', name: 'Grandma spice', quantity: 2 },
        ]),
    });

    it('carries the draft line’s isUserEntered instead of a hard-coded false', () => {
        expect(draftToSnapshot(values, 1).ingredients[0]?.isUserEntered).toBe(true);
    });

    it('⛔ reports no ingredient row when only the other side changed something else', () => {
        // The server side of a declared line is `isUserEntered: true`; a draft projected as `false` made every
        // untouched declared line a local edit the cook was asked to reconcile.
        const mine = draftToSnapshot(values, 1);
        const base = { ...mine, ingredients: mine.ingredients.map((line) => ({ ...line, isUserEntered: true })) };
        const theirs = { ...base, title: 'Their title' };

        const diff = computeConflictDiff(base, mine, theirs, 'en', lineNames);

        expect(diff.rows.map((row) => row.fieldKind)).toStrictEqual(['title']);
    });
});

/**
 * Curated U15 (R25): the local side of the merge carries the parts of the variant the draft line is bound to, so the
 * conflict panel can draw the dotted line under "Your version" too. A root-bound line carries none (R28).
 */
describe('draftToSnapshot — a variant-bound line keeps its parts on the local side of the merge', () => {
    const parts = [
        { attribute: 'cut', text: 'flat half' },
        { attribute: 'grade', text: 'select' },
    ];
    const snapshot = draftToSnapshot(
        makeRecipeFormValues({
            ingredients: withLineKeys([
                {
                    isUserEntered: false,
                    ingredientId: 'ing-variant',
                    name: 'beef brisket',
                    quantity: 2,
                    foodId: 'food_beef_brisket',
                    variant: { id: 'var_flat', parts },
                },
                { isUserEntered: false, ingredientId: 'ing-root', name: 'beef brisket', quantity: 1 },
            ]),
        }),
        1,
    );

    it('carries the variant’s parts, in wire order', () => {
        expect(snapshot.ingredients[0]?.variantParts).toEqual(parts);
    });

    it('carries no parts for a root-bound line', () => {
        expect(snapshot.ingredients[1]).not.toHaveProperty('variantParts');
    });
});

describe('U26/U27 — the preparation and the section survive the version layer', () => {
    it('draftToSnapshot carries both onto the local side of the merge', () => {
        const snapshot = draftToSnapshot(
            makeRecipeFormValues({
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing-1',
                        name: 'Onion',
                        quantity: 2,
                        preparation: 'finely chopped',
                        groupLabel: 'For the marinade',
                    },
                ]),
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
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing-1',
                        name: 'Onion',
                        quantity: 2,
                        preparation: '  ',
                        groupLabel: ' Dry ',
                    },
                ]),
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
            lineNames,
            [],
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
            lineNames,
            [],
        );

        expect(line?.text).toContain('[Dry]');
    });

    it('the preview renders a line with NO preparation exactly as it did before U26', () => {
        const [line] = toVersionPreviewIngredientLines(
            [makeIngredient({ quantity: { kind: 'exact', value: 2 }, unit: 'cups', ingredientName: 'Onion' })],
            preview,
            'en',
            lineNames,
            [],
        );

        expect(line?.text).toBe('2 cups Onion');
    });
});

/**
 * The server side of a 409 is a version SNAPSHOT, and a snapshot saves no private food's name and no line status
 * (plan 002 R9, R52). Rebuilt naively, a line on a private or unreachable food reaches the editor with no name and
 * no status — an empty name field. The live recipe the editor already holds knows both for the same binding.
 */
describe('applyServerSnapshotToRecipeDetail — lines the snapshot cannot name', () => {
    const snapshotLine = (ingredientId: string, ingredientName?: string) =>
        makeIngredient({ id: `ri_${ingredientId}`, ingredientId, ingredientName });

    it('⛔ takes the live name and status for a binding the live recipe also has', () => {
        const live = makeRecipeDetail({
            ingredients: [
                makeIngredientView({
                    ingredientId: 'own',
                    name: 'My spice mix',
                    resolutionStatus: FoodResolutionStatus.RESOLVED,
                }),
                makeIngredientView({
                    ingredientId: 'far',
                    name: undefined,
                    resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE,
                }),
            ],
        });
        const side = makeVersionConflictSide({
            snapshot: {
                ...makeVersionConflictSide().snapshot,
                ingredients: [snapshotLine('own'), snapshotLine('far')],
            },
        });

        const [own, far] = applyServerSnapshotToRecipeDetail(live, side).ingredients;

        expect(own).toMatchObject({ name: 'My spice mix', resolutionStatus: FoodResolutionStatus.RESOLVED });
        expect(far?.name).toBeUndefined();
        expect(far?.resolutionStatus).toBe(FoodResolutionStatus.FOOD_UNREACHABLE);
    });

    it('⛔ keeps the live binding (food, variant, hasVariants) for a line the live recipe also holds, so its figures still load', () => {
        const variant = { id: 'var_flat', parts: [{ attribute: 'cut', text: 'flat half' }] };
        const live = makeRecipeDetail({
            ingredients: [
                makeIngredientView({ ingredientId: 'brisket', foodId: 'food_brisket', variant, hasVariants: true }),
            ],
        });
        const side = makeVersionConflictSide({
            snapshot: {
                ...makeVersionConflictSide().snapshot,
                ingredients: [snapshotLine('brisket'), snapshotLine('new')],
            },
        });

        const [held, serverOnly] = applyServerSnapshotToRecipeDetail(live, side).ingredients;

        expect(held).toMatchObject({ foodId: 'food_brisket', variant, hasVariants: true });
        // A line only the server holds has no live binding to borrow; a snapshot stores none.
        expect(serverOnly?.foodId).toBeUndefined();
        expect(serverOnly?.variant).toBeUndefined();
    });

    it('keeps the name the snapshot saved over the live one', () => {
        const live = makeRecipeDetail({ ingredients: [makeIngredientView({ ingredientId: 'salt', name: 'Salt' })] });
        const side = makeVersionConflictSide({
            snapshot: { ...makeVersionConflictSide().snapshot, ingredients: [snapshotLine('salt', 'Sea salt')] },
        });

        expect(applyServerSnapshotToRecipeDetail(live, side).ingredients[0]?.name).toBe('Sea salt');
    });

    it('leaves a line the live recipe does not have as the snapshot saved it', () => {
        const live = makeRecipeDetail({ ingredients: [] });
        const side = makeVersionConflictSide({
            snapshot: { ...makeVersionConflictSide().snapshot, ingredients: [snapshotLine('new')] },
        });

        const [line] = applyServerSnapshotToRecipeDetail(live, side).ingredients;

        expect(line?.name).toBeUndefined();
        expect(line?.resolutionStatus).toBeUndefined();
    });
});
