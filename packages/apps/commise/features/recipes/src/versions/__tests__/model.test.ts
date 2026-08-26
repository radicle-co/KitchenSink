/**
 * Unit tests for the version-surface model layer — the pure ordering, timestamp, and conflict-field
 * projections shared by the web and native leaves. Assert exact outputs (and non-mutation) so a broken
 * sort, a drifted format, or a dropped/reordered conflict field fails.
 */
import { describe, expect, it } from 'vitest';

import type { RecipeIngredient, RecipeSnapshot, VersionConflictSide } from '@kitchensink/recipe-core';

import type { RecipeFormIngredient, RecipeFormStep } from '../../form/model.js';
import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import { makeRecipeVersion, makeVersionConflictSide } from '../__fixtures__/index.js';
import type { ConflictFieldRow } from '../conflictDiff.js';
import type { SnapshotDiff } from '../diff.js';
import { recipeVersionMessages } from '../messages.js';
import {
    changedFromCurrentCounts,
    changeSummaryForVersion,
    composeConflictMerge,
    composeMergedRecipe,
    conflictFieldKindLabel,
    conflictMarkerGlyph,
    conflictMarkerLabel,
    conflictRowLabel,
    countMergeSelections,
    draftToSnapshot,
    findPriorVersion,
    formatChangedFieldNames,
    formatChangedFromCurrent,
    formatMergeSummary,
    formatRelativeTimeAgo,
    formatServerBanner,
    formatServerCardHeading,
    formatVersionAttribution,
    formatVersionCardSavedLine,
    formatVersionTimestamp,
    formatYourCardHeading,
    isConflictBaseStale,
    resolveVersionPreview,
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
    quantity: { kind: 'exact', value: 200 },
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

/**
 * REWRITTEN for the 2026-08-26 owner ruling that deleted device attribution (`deviceLabel`). The banner
 * used to have two branches — with and without a device suffix — and the pair of cases below it existed to
 * pin both. There is now ONE rendering, so the surviving case asserts the WHOLE string (never `toContain`),
 * which is what makes it fail if the version number, the relative time, or the template wording moves.
 */
describe('formatServerBanner (W7 Task 3 / X3)', () => {
    it('renders "Server version (vN): Saved {time} ago" — version and relative time, and nothing else', () => {
        const server = makeVersionConflictSide({
            versionNumber: 6,
            updatedAt: '2026-05-09T14:30:00.000Z',
        });

        expect(formatServerBanner(server, new Date('2026-05-09T14:32:00.000Z'), conflict, 'en')).toBe(
            'Server version (v6): Saved 2 minutes ago',
        );
    });

    it('carries no device clause even when the caller hands it a stray deviceLabel-shaped property', () => {
        // The field is gone from `VersionConflictSide`, but an OLD server (or a stale cache) can still put
        // the key on the wire. The banner must ignore it rather than resurrect the deleted suffix.
        const server = { ...makeVersionConflictSide({ versionNumber: 6, updatedAt: '2026-05-09T14:30:00.000Z' }) };

        expect(
            formatServerBanner(
                { ...server, deviceLabel: 'iPhone' } as typeof server,
                new Date('2026-05-09T14:32:00.000Z'),
                conflict,
                'en',
            ),
        ).toBe('Server version (v6): Saved 2 minutes ago');
    });
});

describe('two-column per-side summary cards (wireframe gap #2)', () => {
    const server = makeVersionConflictSide({
        versionNumber: 6,
        updatedAt: '2026-05-09T14:30:00.000Z',
    });

    it('formatServerCardHeading renders "Server version (v{n})"', () => {
        expect(formatServerCardHeading(server, conflict)).toBe('Server version (v6)');
    });

    it('formatYourCardHeading renders "Your version (v{n})" when base is known', () => {
        const base = makeVersionConflictSide({ versionNumber: 5 });

        expect(formatYourCardHeading(base, conflict)).toBe('Your version (v5)');
    });

    it('formatYourCardHeading falls back to the version-less heading when base is undefined (evicted)', () => {
        expect(formatYourCardHeading(undefined, conflict)).toBe('Your version');
    });

    it('formatVersionCardSavedLine renders an ABSOLUTE date, distinct from the banner’s relative time', () => {
        expect(formatVersionCardSavedLine(server, 'en', conflict)).toContain('Saved: May 9, 2026');
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

describe('isConflictBaseStale (W7 Task 5 / X6)', () => {
    const base: VersionConflictSide = makeVersionConflictSide({ versionNumber: 5 });

    it('is false when a base is present and within the 10-version threshold', () => {
        expect(isConflictBaseStale(base, 10)).toBe(false);
        expect(isConflictBaseStale(base, 1)).toBe(false);
    });

    it('is true when the server is more than 10 versions ahead of the base', () => {
        expect(isConflictBaseStale(base, 11)).toBe(true);
    });

    it('is true when the base is absent, REGARDLESS of what versionsBehind reads (unreliable without a base)', () => {
        expect(isConflictBaseStale(undefined, 1)).toBe(true);
        expect(isConflictBaseStale(undefined, 0)).toBe(true);
    });
});

describe('countMergeSelections / formatMergeSummary (W7 Task 5 — running "Summary of choices")', () => {
    it('counts zero of both sides for empty selections', () => {
        expect(countMergeSelections({})).toEqual({ server: 0, mine: 0 });
        expect(formatMergeSummary({}, conflict, 'en')).toBe(
            'Summary: 0 choices from server, 0 choices from your version',
        );
    });

    it('tallies each side’s explicit picks, correctly pluralized', () => {
        const selections: RecipeMergeSelections = {
            title: 'theirs',
            servings: 'theirs',
            'steps[1]': 'mine',
        };

        expect(countMergeSelections(selections)).toEqual({ server: 2, mine: 1 });
        expect(formatMergeSummary(selections, conflict, 'en')).toBe(
            'Summary: 2 choices from server, 1 choice from your version',
        );
    });

    it('does not count an absent key — only EXPLICIT selections, not the implied default', () => {
        // `composeMergedRecipe`/`composeConflictMerge` still default an absent key to "mine", but the running
        // summary reports what the user actively picked, not the composed result.
        expect(countMergeSelections({ title: 'theirs' })).toEqual({ server: 1, mine: 0 });
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

/**
 * REWRITTEN for the 2026-08-26 owner ruling that deleted device attribution (`deviceLabel`). The function
 * used to take a device label and branch on it; two of the four cases here existed only to pin that branch.
 * What survives is the editor-only rendering, and it is asserted as a WHOLE string on purpose — the two
 * deleted cases were the only ones that pinned the `by @` prefix and the handle's position, so asserting
 * merely "contains clara" here would let the surviving format rot unnoticed.
 */
describe('formatVersionAttribution (W6 Task 2)', () => {
    it('renders exactly "by @{handle}" — the prefix, the sigil and the handle, with no suffix', () => {
        expect(formatVersionAttribution('clara', versionList)).toBe('by @clara');
    });

    it('renders undefined when the editor is unknown (never "by @undefined")', () => {
        expect(formatVersionAttribution(undefined, versionList)).toBeUndefined();
    });

    it('attributes to the handle it was GIVEN, not to a fixed one', () => {
        // Guards the template's `{handle}` substitution: a formatter that ignored its argument and returned
        // a constant would pass the case above and fail here.
        expect(formatVersionAttribution('devon', versionList)).toBe('by @devon');
    });
});

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
