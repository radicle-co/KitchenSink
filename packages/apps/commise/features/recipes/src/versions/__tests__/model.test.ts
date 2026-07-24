/**
 * Unit tests for the version-surface model layer — the pure ordering, timestamp, and conflict-field
 * projections shared by the web and native leaves. Assert exact outputs (and non-mutation) so a broken
 * sort, a drifted format, or a dropped/reordered conflict field fails.
 */
import { describe, expect, it } from 'vitest';

import type { RecipeIngredient, RecipeSnapshot } from '@kitchensink/recipe-core';

import type { RecipeFormValues } from '../../form/model.js';
import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import { makeRecipeVersion, makeVersionConflictSide } from '../__fixtures__/index.js';
import type { ConflictFieldRow } from '../conflictDiff.js';
import type { SnapshotDiff } from '../diff.js';
import { recipeVersionMessages } from '../messages.js';
import {
    buildRecipeMergeFields,
    changedFromCurrentCounts,
    changeSummaryForVersion,
    composeMergedRecipe,
    conflictFieldKindLabel,
    conflictMarkerGlyph,
    conflictMarkerLabel,
    conflictRowLabel,
    findPriorVersion,
    formatChangedFieldNames,
    formatChangedFromCurrent,
    formatRelativeTimeAgo,
    formatServerBanner,
    formatVersionAttribution,
    formatVersionTimestamp,
    sortVersionsDescending,
    toVersionPreviewIngredientLines,
    type RecipeMergeSelections,
} from '../model.js';

const conflict = recipeVersionMessages.en.conflict;
const versionList = recipeVersionMessages.en.versionList;
const preview = recipeVersionMessages.en.preview;

/** A default {@link RecipeIngredient} snapshot line, overridable per field. */
const makeIngredient = (overrides: Partial<RecipeIngredient> = {}): RecipeIngredient => ({
    id: 'ri_1',
    recipeId: 'rec_1',
    ingredientId: 'ing_1',
    quantity: 200,
    unit: 'g',
    sortOrder: 1,
    ingredientName: 'Pasta',
    isUserEntered: false,
    ...overrides,
});

/** A default {@link RecipeSnapshot}, overridable per field — mirrors the default `makeRecipeVersion` shape. */
const makeSnapshot = (overrides: Partial<RecipeSnapshot> = {}): RecipeSnapshot => ({
    version: 1,
    title: 'Weeknight Pasta',
    description: 'A fast, comforting weeknight dinner.',
    steps: [],
    ingredients: [],
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    ...overrides,
});

describe('sortVersionsDescending', () => {
    it('orders versions newest-first by version number', () => {
        const ordered = sortVersionsDescending([
            makeRecipeVersion({ versionNumber: 1 }),
            makeRecipeVersion({ versionNumber: 3 }),
            makeRecipeVersion({ versionNumber: 2 }),
        ]);

        expect(ordered.map((version) => version.versionNumber)).toEqual([3, 2, 1]);
    });

    it('does not mutate the input array', () => {
        const input = [makeRecipeVersion({ versionNumber: 1 }), makeRecipeVersion({ versionNumber: 2 })];

        sortVersionsDescending(input);

        expect(input.map((version) => version.versionNumber)).toEqual([1, 2]);
    });
});

describe('formatVersionTimestamp', () => {
    it('formats an ISO instant in UTC (timezone-independent) for the locale', () => {
        expect(formatVersionTimestamp('2026-04-01T09:00:00.000Z', 'en')).toContain('Apr 1, 2026');
    });
});

describe('formatRelativeTimeAgo (W7 Task 3 / X3)', () => {
    it('buckets to minutes under an hour', () => {
        expect(formatRelativeTimeAgo('2026-05-09T14:30:00.000Z', new Date('2026-05-09T14:32:00.000Z'), 'en')).toBe(
            '2 minutes ago',
        );
    });

    it('floors sub-minute elapsed time to "0 minutes ago" rather than surfacing seconds', () => {
        expect(formatRelativeTimeAgo('2026-05-09T14:30:00.000Z', new Date('2026-05-09T14:30:45.000Z'), 'en')).toBe(
            '0 minutes ago',
        );
    });

    it('buckets to hours once an hour has elapsed', () => {
        expect(formatRelativeTimeAgo('2026-05-09T12:00:00.000Z', new Date('2026-05-09T14:30:00.000Z'), 'en')).toBe(
            '2 hours ago',
        );
    });

    it('buckets to days once a day has elapsed', () => {
        expect(formatRelativeTimeAgo('2026-05-07T14:30:00.000Z', new Date('2026-05-09T14:30:00.000Z'), 'en')).toBe(
            '2 days ago',
        );
    });

    it('never reports a negative/future elapsed time (clock skew degrades to "0 minutes ago")', () => {
        expect(formatRelativeTimeAgo('2026-05-09T14:35:00.000Z', new Date('2026-05-09T14:30:00.000Z'), 'en')).toBe(
            '0 minutes ago',
        );
    });
});

describe('formatServerBanner (W7 Task 3 / X3)', () => {
    it('renders "Server version (vN): Saved {time} ago on {device}" when a device is known', () => {
        const server = makeVersionConflictSide({
            versionNumber: 6,
            deviceLabel: 'iPhone',
            updatedAt: '2026-05-09T14:30:00.000Z',
        });

        expect(formatServerBanner(server, new Date('2026-05-09T14:32:00.000Z'), conflict, 'en')).toBe(
            'Server version (v6): Saved 2 minutes ago on iPhone',
        );
    });

    it('omits the device clause when deviceLabel is absent', () => {
        const server = makeVersionConflictSide({
            versionNumber: 6,
            deviceLabel: undefined,
            updatedAt: '2026-05-09T14:30:00.000Z',
        });

        expect(formatServerBanner(server, new Date('2026-05-09T14:32:00.000Z'), conflict, 'en')).toBe(
            'Server version (v6): Saved 2 minutes ago',
        );
    });
});

describe('conflictFieldKindLabel (W7 Task 1 → Task 3)', () => {
    it('resolves each scalar field kind to its shared field label', () => {
        expect(conflictFieldKindLabel('title', conflict)).toBe('Title');
        expect(conflictFieldKindLabel('description', conflict)).toBe('Description');
        expect(conflictFieldKindLabel('servings', conflict)).toBe('Servings');
        expect(conflictFieldKindLabel('prepTimeMinutes', conflict)).toBe('Prep time');
        expect(conflictFieldKindLabel('cookTimeMinutes', conflict)).toBe('Cook time');
    });

    it('resolves the per-element step/ingredient row kinds to the shared PLURAL field labels', () => {
        expect(conflictFieldKindLabel('step', conflict)).toBe('Steps');
        expect(conflictFieldKindLabel('ingredient', conflict)).toBe('Ingredients');
    });
});

describe('conflictMarkerGlyph / conflictMarkerLabel (W7 Task 4 / X1)', () => {
    it('resolves each marker to its ASCII glyph', () => {
        expect(conflictMarkerGlyph('unchanged', conflict)).toBe('[=]');
        expect(conflictMarkerGlyph('changed', conflict)).toBe('[→]');
        expect(conflictMarkerGlyph('conflict', conflict)).toBe('[!!]');
    });

    it('resolves each marker to a DISTINCT accessible label — never colour alone', () => {
        expect(conflictMarkerLabel('unchanged', conflict)).toBe('unchanged');
        expect(conflictMarkerLabel('changed', conflict)).toBe('changed');
        expect(conflictMarkerLabel('conflict', conflict)).toBe('conflict');
    });
});

describe('conflictRowLabel (W7 Task 4 / X1)', () => {
    const baseRow: ConflictFieldRow = {
        key: 'title',
        fieldKind: 'title',
        marker: 'changed',
        mine: 'My Draft Title',
        theirs: 'Latest Saved Title',
        mineChanged: true,
        theirsChanged: false,
    };

    it('resolves a scalar row to its shared field label (no position/identity to add)', () => {
        expect(conflictRowLabel(baseRow, conflict)).toBe('Title');
        expect(conflictRowLabel({ ...baseRow, key: 'servings', fieldKind: 'servings' }, conflict)).toBe('Servings');
    });

    it('resolves a step row to its 1-based position, decoded from the `steps[N]` key', () => {
        const row: ConflictFieldRow = {
            ...baseRow,
            key: 'steps[2]',
            fieldKind: 'step',
            mine: 'Add spinach and cook until wilted',
            theirs: 'Add kale and cook until wilted',
        };

        expect(conflictRowLabel(row, conflict)).toBe('Step 3');
        expect(conflictRowLabel({ ...row, key: 'steps[0]' }, conflict)).toBe('Step 1');
    });

    it('resolves an ingredient row to its identity — the SERVER-FIRST (X7) non-empty formatted value', () => {
        const row: ConflictFieldRow = {
            ...baseRow,
            key: 'ingredients:ing_1',
            fieldKind: 'ingredient',
            mine: '250g Pasta',
            theirs: '200g Pasta',
        };

        expect(conflictRowLabel(row, conflict)).toBe('Ingredient: 200g Pasta');
    });

    it('falls back to mine’s value for an ingredient row when theirs is empty (removed on their side)', () => {
        const row: ConflictFieldRow = {
            ...baseRow,
            key: 'ingredients:ing_1',
            fieldKind: 'ingredient',
            mine: '250g Pasta',
            theirs: '',
            theirsChanged: true,
        };

        expect(conflictRowLabel(row, conflict)).toBe('Ingredient: 250g Pasta');
    });

    it('falls back to base’s value for an ingredient row when both mine and theirs are empty (removed by both)', () => {
        const row: ConflictFieldRow = {
            ...baseRow,
            key: 'ingredients:ing_1',
            fieldKind: 'ingredient',
            base: '200g Pasta',
            mine: '',
            theirs: '',
        };

        expect(conflictRowLabel(row, conflict)).toBe('Ingredient: 200g Pasta');
    });
});

describe('buildRecipeMergeFields (T070 / FR-007c field-by-field merge)', () => {
    it('projects every editable field with each side’s formatted value', () => {
        const mine = makeRecipeFormValues({
            title: 'My Title',
            description: 'My description',
            cuisine: 'Thai',
            tags: ['spicy'],
            dietaryFlags: ['vegan'],
            servings: 6,
            prepTimeMinutes: 15,
            cookTimeMinutes: 25,
            visibility: 'public',
            ingredients: [
                { ingredientId: 'a', name: 'A', quantity: 1 },
                { ingredientId: 'b', name: 'B', quantity: 1 },
                { ingredientId: 'c', name: 'C', quantity: 1 },
            ],
            steps: [{ instruction: 'One' }, { instruction: 'Two' }],
        });
        const theirs = makeRecipeFormValues({
            title: 'Their Title',
            description: '',
            cuisine: 'Italian',
            tags: [],
            dietaryFlags: ['vegetarian', 'gluten-free'],
            servings: 4,
            prepTimeMinutes: 10,
            cookTimeMinutes: 20,
            visibility: 'private',
            ingredients: [{ ingredientId: 'x', name: 'X', quantity: 1 }],
            steps: [{ instruction: 'Only' }],
        });

        const fields = buildRecipeMergeFields(mine, theirs, conflict, 'en');
        const byKey = Object.fromEntries(fields.map((field) => [field.key, field]));

        // Field set + order is driven by the form shape.
        expect(fields.map((field) => field.key)).toEqual([
            'title',
            'description',
            'cuisine',
            'servings',
            'prepTimeMinutes',
            'cookTimeMinutes',
            'visibility',
            'tags',
            'dietaryFlags',
            'ingredients',
            'steps',
        ]);

        expect(byKey['title']).toMatchObject({ label: 'Title', mineValue: 'My Title', theirsValue: 'Their Title' });
        // An empty free-text field renders the localized empty marker, not a blank.
        expect(byKey['description']?.theirsValue).toBe('None');
        expect(byKey['servings']).toMatchObject({ mineValue: '6', theirsValue: '4' });
        expect(byKey['prepTimeMinutes']).toMatchObject({ mineValue: '15 min', theirsValue: '10 min' });
        expect(byKey['visibility']).toMatchObject({ mineValue: 'Public', theirsValue: 'Private' });
        expect(byKey['tags']).toMatchObject({ mineValue: 'spicy', theirsValue: 'None' });
        expect(byKey['dietaryFlags']?.theirsValue).toBe('vegetarian, gluten-free');
        expect(byKey['ingredients']).toMatchObject({ mineValue: '3 ingredients', theirsValue: '1 ingredient' });
        expect(byKey['steps']).toMatchObject({ mineValue: '2 steps', theirsValue: '1 step' });
    });

    it('renders EVERY field even when both sides are identical (no field is hidden)', () => {
        const same = makeRecipeFormValues();

        const fields = buildRecipeMergeFields(same, same, conflict, 'en');

        // The whole editable field set is present — nothing is silently dropped because it happens to match.
        expect(fields).toHaveLength(11);
        expect(fields.every((field) => field.mineValue === field.theirsValue)).toBe(true);
    });

    it('includes a field the form gains later that has no curated descriptor (never silently omitted)', () => {
        // Simulate a future `RecipeFormValues` field (e.g. CR-001's `difficulty`) not yet in the registry.
        const mine = { ...makeRecipeFormValues(), difficulty: 'hard' } as unknown as RecipeFormValues;
        const theirs = { ...makeRecipeFormValues(), difficulty: 'easy' } as unknown as RecipeFormValues;

        const fields = buildRecipeMergeFields(mine, theirs, conflict, 'en');
        const difficulty = fields.find((field) => field.key === 'difficulty');

        expect(difficulty).toBeDefined();
        expect(difficulty?.mineValue).toBe('hard');
        expect(difficulty?.theirsValue).toBe('easy');
    });
});

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

describe('findPriorVersion (W6 Task 2)', () => {
    it('returns undefined for the earliest version in the set', () => {
        const versions = [makeRecipeVersion({ versionNumber: 1 }), makeRecipeVersion({ versionNumber: 2 })];

        expect(findPriorVersion(versions, 1)).toBeUndefined();
    });

    it('returns the immediately-prior version (greatest versionNumber strictly less than the target)', () => {
        const versions = [
            makeRecipeVersion({ versionNumber: 1 }),
            makeRecipeVersion({ versionNumber: 2 }),
            makeRecipeVersion({ versionNumber: 3 }),
        ];

        expect(findPriorVersion(versions, 3)?.versionNumber).toBe(2);
    });

    it('degrades gracefully across a gap in the given set (not versionNumber - 1 arithmetic)', () => {
        const versions = [makeRecipeVersion({ versionNumber: 1 }), makeRecipeVersion({ versionNumber: 5 })];

        expect(findPriorVersion(versions, 5)?.versionNumber).toBe(1);
    });

    it('does not mutate the input array', () => {
        const versions = [makeRecipeVersion({ versionNumber: 1 }), makeRecipeVersion({ versionNumber: 2 })];
        const snapshot = [...versions];

        findPriorVersion(versions, 2);

        expect(versions).toEqual(snapshot);
    });
});

describe('changeSummaryForVersion (W6 Task 2)', () => {
    it('reports no prior for the earliest version, with no changed fields', () => {
        const v1 = makeRecipeVersion({ versionNumber: 1, snapshot: makeSnapshot() });

        expect(changeSummaryForVersion([v1], v1)).toEqual({ hasPrior: false, changedFields: [] });
    });

    it('reports the changed fields versus the immediately-prior version', () => {
        const v1 = makeRecipeVersion({ versionNumber: 1, snapshot: makeSnapshot({ version: 1 }) });
        const v2 = makeRecipeVersion({
            versionNumber: 2,
            snapshot: makeSnapshot({ version: 2, title: 'Weeknight Pasta, Revised' }),
        });

        expect(changeSummaryForVersion([v1, v2], v2)).toEqual({ hasPrior: true, changedFields: ['title'] });
    });

    it('reports hasPrior true with no changed fields when the prior snapshot is identical', () => {
        const v1 = makeRecipeVersion({ versionNumber: 1, snapshot: makeSnapshot({ version: 1 }) });
        const v2 = makeRecipeVersion({ versionNumber: 2, snapshot: makeSnapshot({ version: 2 }) });

        expect(changeSummaryForVersion([v1, v2], v2)).toEqual({ hasPrior: true, changedFields: [] });
    });
});

describe('formatChangedFieldNames (W6 Task 2)', () => {
    it('localizes and joins the changed field names, preserving declared order', () => {
        expect(formatChangedFieldNames(['title', 'steps'], conflict)).toBe('Title, Steps');
    });

    it('renders a single field with no separator', () => {
        expect(formatChangedFieldNames(['ingredients'], conflict)).toBe('Ingredients');
    });

    it('renders an empty string for no changed fields', () => {
        expect(formatChangedFieldNames([], conflict)).toBe('');
    });
});

describe('formatVersionAttribution (W6 Task 2)', () => {
    it('renders the editor + device when both are present', () => {
        expect(formatVersionAttribution('clara', 'iPhone', versionList)).toBe('by @clara (from iPhone)');
    });

    it('renders the editor alone when the device is absent', () => {
        expect(formatVersionAttribution('clara', undefined, versionList)).toBe('by @clara');
    });

    it('renders undefined when neither the editor nor the device is present (never "by @undefined")', () => {
        expect(formatVersionAttribution(undefined, undefined, versionList)).toBeUndefined();
    });

    it('renders undefined when only the device is present (no editor to attribute to)', () => {
        expect(formatVersionAttribution(undefined, 'iPhone', versionList)).toBeUndefined();
    });
});

describe('toVersionPreviewIngredientLines (W6 Task 3)', () => {
    it('maps snapshot ingredients to formatted display lines, in order', () => {
        const lines = toVersionPreviewIngredientLines(
            [
                makeIngredient({ id: 'ri_1', quantity: 200, unit: 'g', ingredientName: 'Pasta' }),
                makeIngredient({ id: 'ri_2', quantity: 1, unit: 'cup', ingredientName: 'Cherry tomatoes' }),
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
        // exactly what {@link RecipeIngredient.userCalories} is for — this test MUST fail in that case.
        const [line] = toVersionPreviewIngredientLines([makeIngredient({ userCalories: 0 })], preview, 'en');

        expect(line).toBeDefined();
        expect('calories' in (line as object)).toBe(true);
        expect(line?.calories).toBe('0 cal');
    });

    it('omits the calorie chip entirely when the ingredient has no userCalories', () => {
        const [line] = toVersionPreviewIngredientLines([makeIngredient({ userCalories: undefined })], preview, 'en');

        expect(line).toBeDefined();
        expect('calories' in (line as object)).toBe(false);
        expect(line?.calories).toBeUndefined();
    });

    it('appends displayText as a parenthesized suffix to the ingredient name', () => {
        const [line] = toVersionPreviewIngredientLines(
            [makeIngredient({ quantity: 2, unit: 'tbsp', ingredientName: 'Olive oil', displayText: 'extra virgin' })],
            preview,
            'en',
        );

        expect(line?.text).toBe('2 tbsp Olive oil (extra virgin)');
    });

    it('renders the bare ingredient name when displayText is absent', () => {
        const [line] = toVersionPreviewIngredientLines(
            [makeIngredient({ quantity: 3, unit: 'oz', ingredientName: 'Basil' })],
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
