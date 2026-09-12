/**
 * Unit tests for the version-preview modal model (`versions/preview.ts`).
 *
 * ⚠️ These 4 describe blocks came from `model.test.ts`, which covered all of
 * `versions/model.ts` before it was split into one module per concern. No assertion was
 * changed, added or dropped in the move — the suite is redistributed, not rewritten.
 */
import { describe, expect, it } from 'vitest';
import { makeIngredient, makeRecipeVersion } from '../__fixtures__/index.js';
import type { SnapshotDiff } from '../diff.js';
import { recipeVersionMessages } from '../messages.js';
import {
    changedFromCurrentCounts,
    formatChangedFromCurrent,
    resolveVersionPreview,
    toVersionPreviewIngredientLines,
} from '../preview.js';

const conflict = recipeVersionMessages.en.conflict;
const preview = recipeVersionMessages.en.preview;

describe('toVersionPreviewIngredientLines (W6 Task 3)', () => {
    it('maps snapshot ingredients to formatted display lines, in order', () => {
        const lines = toVersionPreviewIngredientLines(
            [
                makeIngredient({
                    id: 'ri_1',
                    quantity: { kind: 'exact', value: 200 },
                    unit: 'g',
                    ingredientName: 'Pasta',
                }),
                makeIngredient({
                    id: 'ri_2',
                    quantity: { kind: 'exact', value: 1 },
                    unit: 'cup',
                    ingredientName: 'Cherry tomatoes',
                }),
            ],
            preview,
            'en',
        );

        expect(lines).toEqual([
            { key: 'ri_1', text: '200 g Pasta' },
            { key: 'ri_2', text: '1 cup Cherry tomatoes' },
        ]);
    });

    it('renders a calorie chip when the ingredient carries userCalories', () => {
        const [line] = toVersionPreviewIngredientLines([makeIngredient({ userCalories: 420 })], preview, 'en');

        expect(line?.calories).toBe('420 cal');
    });

    it('renders a calorie chip for userCalories: 0 (a real zero override, not "no override")', () => {
        // CRITICAL: guards the `!== undefined` check in the implementation. A regression to a truthy
        // `if (userCalories)` check would silently drop the chip for this real (zero) override, which is
        // exactly what `RecipeIngredient.userCalories` is for — this test MUST fail in that case.
        const [line] = toVersionPreviewIngredientLines([makeIngredient({ userCalories: 0 })], preview, 'en');

        expect(line).toEqual({ key: 'ri_1', text: '200 g Pasta', calories: '0 cal' });
        expect('calories' in (line as object)).toBe(true);
        expect(line?.calories).toBe('0 cal');
    });

    it('omits the calorie chip entirely when the ingredient has no userCalories', () => {
        const [line] = toVersionPreviewIngredientLines([makeIngredient({ userCalories: undefined })], preview, 'en');

        expect(line).toEqual({ key: 'ri_1', text: '200 g Pasta' });
        expect('calories' in (line as object)).toBe(false);
        expect(line?.calories).toBeUndefined();
    });

    it('appends displayText as a parenthesized suffix to the ingredient name', () => {
        const [line] = toVersionPreviewIngredientLines(
            [
                makeIngredient({
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'tbsp',
                    ingredientName: 'Olive oil',
                    displayText: 'extra virgin',
                }),
            ],
            preview,
            'en',
        );

        expect(line?.text).toBe('2 tbsp Olive oil (extra virgin)');
    });

    it('renders the bare ingredient name when displayText is absent', () => {
        const [line] = toVersionPreviewIngredientLines(
            [makeIngredient({ quantity: { kind: 'exact', value: 3 }, unit: 'oz', ingredientName: 'Basil' })],
            preview,
            'en',
        );

        expect(line?.text).toBe('3 oz Basil');
    });
});

describe('changedFromCurrentCounts (W6 Task 3)', () => {
    const zeroTally = { added: 0, removed: 0, modified: 0 };

    it("sums each collection's added+removed+modified into its total count", () => {
        const diff: SnapshotDiff = {
            changedFields: [],
            steps: { added: 1, removed: 2, modified: 3 },
            ingredients: { added: 4, removed: 5, modified: 6 },
            summary: zeroTally,
        };

        expect(changedFromCurrentCounts(diff)).toEqual({ ingredients: 15, steps: 6 });
    });

    it('keeps ingredients and steps distinct — a mapping swap must fail this', () => {
        const diff: SnapshotDiff = {
            changedFields: [],
            steps: { added: 1, removed: 0, modified: 0 },
            ingredients: { added: 0, removed: 0, modified: 2 },
            summary: zeroTally,
        };

        expect(changedFromCurrentCounts(diff)).toEqual({ ingredients: 2, steps: 1 });
    });

    it('reports 0 ingredients, 0 steps for a zero diff', () => {
        const diff: SnapshotDiff = {
            changedFields: [],
            steps: zeroTally,
            ingredients: zeroTally,
            summary: zeroTally,
        };

        expect(changedFromCurrentCounts(diff)).toEqual({ ingredients: 0, steps: 0 });
    });
});

describe('formatChangedFromCurrent (localization-quality fix)', () => {
    const zeroTally = { added: 0, removed: 0, modified: 0 };

    it('pluralizes both counts (2 ingredients, 0 steps) — the "other" category, not a hard-coded plural', () => {
        const diff: SnapshotDiff = {
            changedFields: [],
            steps: zeroTally,
            ingredients: { added: 1, removed: 1, modified: 0 },
            summary: zeroTally,
        };

        expect(formatChangedFromCurrent(diff, preview, conflict, 'en-US')).toBe(
            'Changed from current: 2 ingredients, 0 steps',
        );
    });

    it('singularizes a count of exactly 1 for BOTH ingredients and steps (1 ingredient, 1 step)', () => {
        const diff: SnapshotDiff = {
            changedFields: [],
            steps: { added: 1, removed: 0, modified: 0 },
            ingredients: { added: 1, removed: 0, modified: 0 },
            summary: zeroTally,
        };

        expect(formatChangedFromCurrent(diff, preview, conflict, 'en-US')).toBe(
            'Changed from current: 1 ingredient, 1 step',
        );
    });

    it('singularizes only the field whose count is 1, pluralizing the other independently', () => {
        const diff: SnapshotDiff = {
            changedFields: [],
            steps: { added: 1, removed: 0, modified: 0 },
            ingredients: { added: 4, removed: 5, modified: 6 },
            summary: zeroTally,
        };

        expect(formatChangedFromCurrent(diff, preview, conflict, 'en-US')).toBe(
            'Changed from current: 15 ingredients, 1 step',
        );
    });
});

/**
 * B21 — the version preview's state is derived ONCE, purely, from the container's own inputs. Both call
 * sites (the web `RecipeVersionsContainer` and the native `RecipeVersionsScreen`) previously duplicated this
 * derivation verbatim AND hard-coded `isLoading={false}` while never passing `error`, so a preview target
 * the loaded history does not contain rendered an unrecoverable spinner: no call site could put the modal in
 * the state where it says "this failed". Settled-but-absent is a FAILURE, not a pending fetch.
 */
describe('resolveVersionPreview', () => {
    const v1 = makeRecipeVersion({ versionNumber: 1 });
    const v2 = makeRecipeVersion({ versionNumber: 2 });

    it('is closed, idle, and error-free when nothing is being previewed', () => {
        const state = resolveVersionPreview({
            previewTarget: null,
            versions: [v1, v2],
            currentVersion: 2,
            restoringVersion: null,
        });

        expect(state).toStrictEqual({ open: false, isLoading: false, error: false, isRestoring: false });
    });

    it('resolves the previewed version off the already-loaded list (no fetch, so never loading)', () => {
        const state = resolveVersionPreview({
            previewTarget: 1,
            versions: [v1, v2],
            currentVersion: 2,
            restoringVersion: null,
        });

        expect(state.open).toBe(true);
        expect(state.version).toBe(v1);
        expect(state.isLoading).toBe(false);
        expect(state.error).toBe(false);
    });

    it('computes the changed-from-current diff against the current version in the same list', () => {
        const previewed = makeRecipeVersion({
            versionNumber: 1,
            snapshot: { ...v1.snapshot, title: 'Old title' },
        });
        const current = makeRecipeVersion({
            versionNumber: 2,
            snapshot: { ...v1.snapshot, version: 2, title: 'New title' },
        });
        const state = resolveVersionPreview({
            previewTarget: 1,
            versions: [previewed, current],
            currentVersion: 2,
            restoringVersion: null,
        });

        expect(state.diffFromCurrent?.changedFields).toStrictEqual(['title']);
    });

    it('omits the changed-from-current diff when the current version is not in the list', () => {
        const state = resolveVersionPreview({
            previewTarget: 1,
            versions: [v1],
            currentVersion: 99,
            restoringVersion: null,
        });

        expect(state.version).toBe(v1);
        expect(state.error).toBe(false);
        expect(state.diffFromCurrent).toBeUndefined();
    });

    it('reports ERROR — not loading — when the previewed version is absent from the settled list', () => {
        const state = resolveVersionPreview({
            previewTarget: 7,
            versions: [v1, v2],
            currentVersion: 2,
            restoringVersion: null,
        });

        expect(state.open).toBe(true);
        expect(state.error).toBe(true);
        // The whole defect: this state used to render the spinner, stranding the viewer with no way to learn
        // the lookup had failed.
        expect(state.isLoading).toBe(false);
        expect(state.version).toBeUndefined();
    });

    it('never reports a restore in flight for a version it could not resolve', () => {
        const state = resolveVersionPreview({
            previewTarget: 7,
            versions: [v1, v2],
            currentVersion: 2,
            restoringVersion: 7,
        });

        expect(state.error).toBe(true);
        expect(state.isRestoring).toBe(false);
    });

    it('reports a restore in flight only for the version being previewed', () => {
        const previewingRestored = resolveVersionPreview({
            previewTarget: 1,
            versions: [v1, v2],
            currentVersion: 2,
            restoringVersion: 1,
        });
        const previewingOther = resolveVersionPreview({
            previewTarget: 1,
            versions: [v1, v2],
            currentVersion: 2,
            restoringVersion: 2,
        });

        expect(previewingRestored.isRestoring).toBe(true);
        expect(previewingOther.isRestoring).toBe(false);
    });

    it('does not mutate the versions it was given', () => {
        const versions = [v2, v1];
        resolveVersionPreview({ previewTarget: 1, versions, currentVersion: 2, restoringVersion: null });

        expect(versions).toStrictEqual([v2, v1]);
    });
});
