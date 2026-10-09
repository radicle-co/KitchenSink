// @vitest-environment jsdom
/**
 * Tests for {@link useIngredientsFields}: the ingredients field group's state and the views both
 * `RecipeIngredientsFields` leaves draw. Each case names the design line it holds: `docs/design/rowEditorOpenDecisions.md`
 * (items 1, 3 and 4, O3, R7), the resolution plan's U27, plan 002 B5 and R38, and the V1 sign-off. One row's own
 * view is `ingredientRowView.test.ts`; the copy builders and the nutrition total have their own suites, so this one
 * holds what the hook wires them to, and what a row's actions do to the hook's own focus levels and settled failure.
 */
import { act, renderHook } from '@testing-library/react';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { describe, expect, it, vi } from 'vitest';

import {
    makeIngredientEntry,
    makeIngredientNutrition,
    makeIngredientRowEditor,
    makeLookupRetry,
    makeRecipeFormValues,
    withLineKeys,
    type UnkeyedFormIngredient,
} from '../../__fixtures__/index.js';
import type { IngredientEntry } from '../../hooks/useIngredientEntry.js';
import type { LineCommitTarget } from '../../hooks/lineCommit.js';
import type { IngredientRowEditor, RowDetailsTarget, SettledRowCommit } from '../../hooks/useIngredientRowEditor.js';
import { recipeMessages } from '../../messages.js';
import { trailingCommitFailureId, trailingEntryDescribedBy } from '../fieldErrorIds.js';
import type { LookupRetry } from '../ingredientStatus.js';
import { lookupSettledMessage } from '../lookupSettledMessage.js';
import { recipeFormMessages } from '../messages.js';
import { recipeNutritionTotal } from '../nutrition.js';
import type { LookupEntry } from '../nutritionLookup.js';
import type { IngredientRowView } from '../ingredientRowView.js';
import type { IngredientLineKey } from '../lineKey.js';
import type { RecipeIngredientsFieldsProps } from '../props.js';
import { useIngredientsFields } from '../useIngredientsFields.js';
import type { RecipeFormErrors } from '../validate.js';

const m = recipeFormMessages.en;
const shared = recipeMessages.en;
const TRAILING = { kind: 'newLine' } as const satisfies LineCommitTarget;

/** A line bound to a catalog food, named. */
const bound = (name: string, over: Partial<UnkeyedFormIngredient> = {}): UnkeyedFormIngredient => ({
    ingredientId: `ing_${name}`,
    foodId: `food_${name}`,
    isUserEntered: false,
    name,
    quantity: 100,
    unit: 'g',
    resolutionStatus: FoodResolutionStatus.RESOLVED,
    ...over,
});

interface Setup {
    readonly lines: readonly UnkeyedFormIngredient[];
    readonly entry?: Partial<IngredientEntry>;
    readonly editor?: Partial<Omit<IngredientRowEditor, 'entry'>>;
    readonly errors?: RecipeFormErrors;
    readonly lookup?: LookupEntry;
    readonly lookupRetry?: Partial<LookupRetry>;
}

/** The field group's props over a draft holding `lines`. */
const propsOf = (setup: Setup): RecipeIngredientsFieldsProps => {
    const answer = setup.lookup;

    return {
        values: makeRecipeFormValues({ ingredients: withLineKeys(setup.lines) }),
        errors: setup.errors,
        onChange: () => undefined,
        nutrition: makeIngredientNutrition(answer === undefined ? {} : { lookup: () => answer }),
        lookupRetry: makeLookupRetry(setup.lookupRetry),
        rowEditor: makeIngredientRowEditor({ ...setup.editor, entry: makeIngredientEntry(setup.entry) }),
    };
};

/** Render the hook over props a test can replace between renders. */
const renderFields = (initial: RecipeIngredientsFieldsProps) =>
    renderHook((props: RecipeIngredientsFieldsProps) => useIngredientsFields(props), { initialProps: initial });

const keyAt = (props: RecipeIngredientsFieldsProps, index: number): IngredientLineKey => {
    const line = props.values.ingredients[index];

    if (line === undefined) {
        throw new Error(`no line at ${index}`);
    }

    return line.key;
};

/** Every row of the model, in draft order. */
const rowsOf = (model: ReturnType<typeof useIngredientsFields>): readonly IngredientRowView[] =>
    model.sections.flatMap((section) => section.rows);

/** A pick on `target` that did not take. */
const failedPick = (target: LineCommitTarget): SettledRowCommit => ({
    origin: { kind: 'entry' },
    target,
    outcome: { kind: 'failed' },
    pick: { kind: 'name', text: 'smoked flour' },
});

describe('useIngredientsFields — sections (U27)', () => {
    it('an ungrouped recipe is one section with no label, so it draws no section chrome', () => {
        const { result } = renderFields(propsOf({ lines: [bound('flour'), bound('sugar'), bound('salt')] }));

        expect(result.current.sections).toHaveLength(1);
        expect(result.current.sections[0]?.label).toBeUndefined();
        expect(result.current.sections[0]?.rows.map((row) => row.displayName)).toEqual(['flour', 'sugar', 'salt']);
    });

    it('a grouped recipe draws its runs in stored order under their labels, numbering rows across them', () => {
        const { result } = renderFields(
            propsOf({
                lines: [
                    bound('flour', { groupLabel: 'Dry' }),
                    bound('salt', { groupLabel: 'Dry' }),
                    bound('milk', { groupLabel: 'Wet' }),
                    bound('egg', { groupLabel: 'Wet' }),
                ],
            }),
        );

        expect(
            result.current.sections.map((section) => ({
                label: section.label,
                rows: section.rows.map((row) => [row.number, row.displayName]),
            })),
        ).toEqual([
            {
                label: 'Dry',
                rows: [
                    [1, 'flour'],
                    [2, 'salt'],
                ],
            },
            {
                label: 'Wet',
                rows: [
                    [3, 'milk'],
                    [4, 'egg'],
                ],
            },
        ]);
    });

    it('keys each section by its first line, so a heading keeps its identity while lines are edited', () => {
        const props = propsOf({ lines: [bound('flour', { groupLabel: 'Dry' }), bound('milk', { groupLabel: 'Wet' })] });
        const { result } = renderFields(props);

        expect(result.current.sections.map((section) => section.key)).toEqual([
            `section-${keyAt(props, 0)}`,
            `section-${keyAt(props, 1)}`,
        ]);
    });

    it('an empty draft has no rows', () => {
        const { result } = renderFields(propsOf({ lines: [] }));

        expect(result.current.sections.flatMap((section) => section.rows)).toEqual([]);
    });
});

describe('useIngredientsFields — the trailing add row (item 3, item 1, O3)', () => {
    it('Create my own food opens the form on the text the cook typed, for a new line', () => {
        const open = vi.fn<IngredientRowEditor['authoredFood']['open']>();
        const { result } = renderFields(
            propsOf({ lines: [], editor: { authoredFood: { ...makeIngredientRowEditor().authoredFood, open } } }),
        );

        result.current.trailing.entryField.onCreateOwnFood?.('smoked paprika');

        expect(open).toHaveBeenCalledWith('smoked paprika', TRAILING);
    });

    it('a pick in flight on the trailing row makes it busy and says what it is doing', () => {
        const { result } = renderFields(
            propsOf({
                lines: [bound('flour')],
                editor: {
                    pickInFlight: (target) => (target.kind === 'newLine' ? { kind: 'name', text: 'kale' } : undefined),
                },
            }),
        );

        expect(result.current.trailing.busyText).toBe('Finding nutrition');
        expect(result.current.sections[0]?.rows[0]?.busy).toBe(false);
    });

    it('a failed pick on the trailing row shows its alert there, naming the text that stays', () => {
        const failed: SettledRowCommit = {
            origin: { kind: 'entry' },
            target: TRAILING,
            outcome: { kind: 'failed' },
            pick: { kind: 'name', text: 'smoked flour' },
        };
        const before = propsOf({ lines: [bound('flour')], entry: { textOf: () => 'smoked flour' } });
        const { result, rerender } = renderFields(before);

        rerender({ ...before, rowEditor: { ...before.rowEditor, settled: failed } });

        const sentence = 'We couldn’t add “smoked flour”. Try again, or use it as written.';

        expect(result.current.trailing.failure).toBe(sentence);
        expect(result.current.trailing.entryField.pickFailure).toBe(sentence);
        expect(result.current.trailing.entryField.describedBy).toBe(trailingCommitFailureId);
        expect(result.current.sections[0]?.rows[0]?.failure).toBeUndefined();
    });

    it('R7: after a refused save, pending text on the trailing row is its invalid field’s description', () => {
        const { result } = renderFields(
            propsOf({
                lines: [bound('flour')],
                entry: { isPending: (target) => target.kind === 'newLine', textOf: () => 'smoked flour' },
                editor: { pendingRefused: true },
            }),
        );

        expect(result.current.trailing.pendingText).toBe(
            '“smoked flour” isn’t in the recipe yet. Choose a food for it, or clear the box.',
        );
        expect(result.current.trailing.entryField.invalid).toBe(true);
        expect(result.current.trailing.entryField.describedBy).toBe(
            trailingEntryDescribedBy({ pending: true, failure: false }),
        );
    });

    it('numbers the ingredient its list would add after the last row (`ingredientSuggestionsLabel`)', () => {
        const { result } = renderFields(propsOf({ lines: [bound('flour'), bound('sugar')] }));

        expect(result.current.trailing.entryField.nextNumber).toBe(3);
    });

    it('R7: before any refusal, the trailing row says nothing and is valid', () => {
        const { result } = renderFields(
            propsOf({
                lines: [bound('flour')],
                entry: { isPending: (target) => target.kind === 'newLine', textOf: () => 'smoked flour' },
            }),
        );

        expect(result.current.trailing.pendingText).toBeUndefined();
        expect(result.current.trailing.entryField.invalid).toBe(false);
    });
});

describe('useIngredientsFields — what a settled pick says (item 1, item 4)', () => {
    it('a trailing pick that lands UNRESOLVED says, politely, that the new line needs a choice', () => {
        const props = propsOf({ lines: [bound('flour'), bound('kale')] });
        const appended = keyAt(props, 1);
        const settled: SettledRowCommit = {
            origin: { kind: 'entry' },
            target: TRAILING,
            outcome: {
                kind: 'committed',
                key: appended,
                binding: {
                    ingredientId: 'ing_kale',
                    isUserEntered: false,
                    name: 'kale',
                    resolutionStatus: FoodResolutionStatus.UNRESOLVED,
                },
            },
            pick: { kind: 'name', text: 'kale' },
        };
        const { result } = renderFields({ ...props, rowEditor: makeIngredientRowEditor({ settled }) });

        expect(result.current.settledMessage).toBe(
            'Added kale. It could be more than one food. Use “About kale” to choose one.',
        );
        expect(result.current.trailing.failure).toBeUndefined();
    });

    it('a refused Change food shows its alert on that row, naming the food the line still uses', () => {
        const props = propsOf({ lines: [bound('flour'), bound('sugar')] });
        const sugar = keyAt(props, 1);
        const settled: SettledRowCommit = {
            origin: { kind: 'entry' },
            target: { kind: 'line', key: sugar },
            outcome: { kind: 'failed' },
            pick: { kind: 'catalogFood', foodId: 'food_honey', name: 'honey' },
        };
        const changing = makeIngredientRowEditor({
            entry: makeIngredientEntry({ changing: new Set([sugar]), textOf: () => 'honey' }),
        });
        const { result, rerender } = renderFields({ ...props, rowEditor: changing });

        rerender({ ...props, rowEditor: { ...changing, settled } });

        const [flourRow, sugarRow] = result.current.sections[0]?.rows ?? [];

        expect(sugarRow?.failure).toBe('The change didn’t save. This ingredient still uses sugar.');
        expect(flourRow?.failure).toBeUndefined();
        expect(result.current.trailing.failure).toBeUndefined();
    });
});

/**
 * E2 (`docs/design/rowEditorOpenDecisions.md`): two facts, two lifetimes. Whether the cook moved past a failure is the
 * host's (`IngredientRowEditor.movedPast`, which outlives the step) and controls the LINE. Whether it settled before
 * this field group mounted is the field group's own and controls the ALERT: an alert reports an event, and on return
 * the failure is a state. REWRITTEN: the moved-past fact used to be seeded here at mount, for both, so every failure
 * that settled, or was seen, while the step was away read as moved past on return and its line was gone.
 */
describe('useIngredientsFields — a settled failure, across the step’s lifetime (E2)', () => {
    /** The row editor of `props`, with a failed pick settled on its first row. */
    const failing = (props: RecipeIngredientsFieldsProps, over: Partial<IngredientRowEditor> = {}) => ({
        ...props,
        rowEditor: {
            ...props.rowEditor,
            entry: makeIngredientEntry({ textOf: () => 'smoked flour' }),
            settled: failedPick({ kind: 'line', key: keyAt(props, 0) }),
            ...over,
        },
    });

    it('a failure that settled while the step was away shows its line on mount, and says nothing', () => {
        const props = propsOf({ lines: [bound('flour')] });

        const { result } = renderFields(failing(props));
        const row = rowsOf(result.current)[0];

        expect(row?.failure).toBeDefined();
        expect(row?.entryField.pickFailure).toBeUndefined();
    });

    it('a failure seen, left and returned to still shows its line, silently', () => {
        const props = propsOf({ lines: [bound('flour')] });
        const seen = renderFields(props);

        seen.rerender(failing(props));
        expect(rowsOf(seen.result.current)[0]?.entryField.pickFailure).toBeDefined();
        seen.unmount();

        const { result } = renderFields(failing(props));
        const row = rowsOf(result.current)[0];

        expect(row?.failure).toBeDefined();
        expect(row?.entryField.pickFailure).toBeUndefined();
    });

    it('the trailing row too: a failure found on mount shows its line, silently', () => {
        const props = propsOf({ lines: [bound('flour')], entry: { textOf: () => 'smoked flour' } });

        const { result } = renderFields({ ...props, rowEditor: { ...props.rowEditor, settled: failedPick(TRAILING) } });

        expect(result.current.trailing.failure).toBeDefined();
        expect(result.current.trailing.entryField.describedBy).toBe(trailingCommitFailureId);
        expect(result.current.trailing.entryField.pickFailure).toBeUndefined();
    });

    it('a failure moved past, then left and returned to, stays hidden', () => {
        const props = propsOf({ lines: [bound('flour')] });

        const { result } = renderFields(failing(props, { movedPast: true }));
        const row = rowsOf(result.current)[0];

        expect(row?.failure).toBeUndefined();
        expect(row?.entryField.pickFailure).toBeUndefined();
    });

    it('a failure that settles while mounted shows its line and is spoken, until the cook moves past it', () => {
        const props = propsOf({ lines: [bound('flour')] });
        const { result, rerender } = renderFields(props);

        rerender(failing(props));
        const row = rowsOf(result.current)[0];

        expect(row?.failure).toBeDefined();
        expect(row?.entryField.pickFailure).toBe(row?.failure);

        rerender(failing(props, { movedPast: true }));

        expect(rowsOf(result.current)[0]?.failure).toBeUndefined();
        expect(rowsOf(result.current)[0]?.entryField.pickFailure).toBeUndefined();
    });

    it('the cook moves past it through the host: by typing, by Change food, and by cancelling', () => {
        const moveOn = vi.fn<IngredientRowEditor['moveOn']>();
        const props = propsOf({ lines: [bound('flour')] });
        const { result } = renderFields(failing(props, { moveOn }));
        const row = (): IngredientRowView | undefined => rowsOf(result.current)[0];

        act(() => row()?.entryField.onTextChange());
        act(() =>
            row()
                ?.actions.find((item) => item.id === 'changeFood')
                ?.onSelect(),
        );
        act(() => row()?.entryField.onCancel());
        act(() => result.current.trailing.entryField.onTextChange());

        expect(moveOn).toHaveBeenCalledTimes(4);
    });

    it('Change food also asks the name field to take focus', () => {
        const beginChange = vi.fn<IngredientEntry['beginChange']>();
        const props = propsOf({ lines: [bound('flour')], entry: { beginChange } });
        const key = keyAt(props, 0);
        const { result } = renderFields(props);

        act(() =>
            rowsOf(result.current)[0]
                ?.actions.find((item) => item.id === 'changeFood')
                ?.onSelect(),
        );

        expect(beginChange).toHaveBeenCalledExactlyOnceWith(key);
        expect(rowsOf(result.current)[0]?.entryField.focusRequested).toBe(true);
    });

    it('a committed pick on a row is said politely', () => {
        const props = propsOf({ lines: [bound('flour')] });
        const key = keyAt(props, 0);
        const { result, rerender } = renderFields(props);

        rerender({
            ...props,
            rowEditor: makeIngredientRowEditor({
                settled: {
                    origin: { kind: 'entry' },
                    target: { kind: 'line', key },
                    pick: { kind: 'catalogFood', foodId: 'food_flour', name: 'flour' },
                    outcome: { kind: 'committed', key, binding: { ingredientId: 'ing_flour', isUserEntered: false } },
                },
            }),
        });

        expect(result.current.settledMessage).toBe(m.statusResolvedConfirmation.replace('{food}', 'flour'));
    });
});

describe('useIngredientsFields — where a row’s actions send focus (§2d, V1 sign-off item 11)', () => {
    it('Remove hands focus to the next row’s glyph, and after the last row to the trailing field', () => {
        const props = propsOf({ lines: [bound('flour'), bound('sugar')] });
        const { result } = renderFields(props);

        act(() => rowsOf(result.current)[0]?.onRemove());

        expect(rowsOf(result.current)[1]?.glyphFocus.requested).toBe(true);
        expect(result.current.trailing.entryField.focusRequested).toBe(false);

        act(() => rowsOf(result.current)[1]?.onRemove());

        expect(result.current.trailing.entryField.focusRequested).toBe(true);
    });

    it('None of these sends focus to the name field only once the glyph’s panel has gone', () => {
        const props = propsOf({ lines: [bound('flour', { resolutionStatus: FoodResolutionStatus.AMBIGUOUS })] });
        const { result } = renderFields(props);

        act(() =>
            rowsOf(result.current)[0]
                ?.shortlist(() => undefined)
                .onNoneOfThese(),
        );

        expect(rowsOf(result.current)[0]?.entryField.focusRequested).toBe(false);

        act(() => rowsOf(result.current)[0]?.glyphFocus.onPanelDismissed());

        expect(rowsOf(result.current)[0]?.entryField.focusRequested).toBe(true);
    });
});

describe('useIngredientsFields — the list’s own error (R7)', () => {
    it('a refused save’s form-level sentence is the list’s error', () => {
        const { result } = renderFields(
            propsOf({ lines: [bound('flour')], errors: { ingredients: 'ingredientsPendingText' } }),
        );

        expect(result.current.listError).toBe(
            'An ingredient you typed isn’t in the recipe yet. Choose a food for it, or delete what you typed.',
        );
    });

    it('a valid list has no error', () => {
        const { result } = renderFields(propsOf({ lines: [bound('flour')] }));

        expect(result.current.listError).toBeUndefined();
    });
});

describe('useIngredientsFields — the details dialog (blueprint decision 7)', () => {
    it('is open on the line whose ⋮ opened it, under the root’s name', () => {
        const props = propsOf({ lines: [bound('brisket')] });
        const target = {
            key: keyAt(props, 0),
            rootId: 'food_brisket',
            foodName: 'brisket',
            entry: { mode: 'add' },
        } as const;
        const { result } = renderFields({
            ...props,
            rowEditor: makeIngredientRowEditor({ details: { ...makeIngredientRowEditor().details, target } }),
        });

        expect(result.current.details).toEqual({ open: true, foodName: 'brisket', line: target });
    });

    it('is closed while no line opened it', () => {
        const { result } = renderFields(propsOf({ lines: [bound('brisket')] }));

        expect(result.current.details).toEqual({ open: false, foodName: '', line: undefined });
    });

    it('keeps its line while it closes, so its heading never goes blank', () => {
        const props = propsOf({ lines: [bound('brisket')] });
        const target: RowDetailsTarget = {
            key: keyAt(props, 0),
            rootId: 'food_brisket',
            foodName: 'brisket',
            entry: { mode: 'add' },
        };
        const closed = props.rowEditor;
        const { result, rerender } = renderFields(props);

        rerender({ ...props, rowEditor: { ...closed, details: { ...closed.details, target } } });
        rerender({ ...props, rowEditor: closed });

        expect(result.current.details).toEqual({ open: false, foodName: 'brisket', line: target });
    });
});

describe('useIngredientsFields — the total and the settled retry (plan 002 B5, R38, V1 sign-off 3c)', () => {
    const FOUND: LookupEntry = {
        state: 'found',
        catalog: { caloriesPer100g: 364, proteinGPer100g: 10, carbsGPer100g: 76, fatGPer100g: 1 },
    };

    it('the total reads the same background read as every row’s panel', () => {
        const props = propsOf({ lines: [bound('flour')], lookup: FOUND });
        const { result } = renderFields(props);

        expect(result.current.total).toEqual(recipeNutritionTotal(props.values, props.nutrition.lookup));
        expect(result.current.total).not.toEqual(recipeNutritionTotal(props.values, () => ({ state: 'absent' })));
    });

    it('R38: a line that states a range makes the total disclose which bound it used', () => {
        const { result: ranged } = renderFields(
            propsOf({ lines: [bound('flour', { quantity: 100, quantityHigh: 200 })], lookup: FOUND }),
        );
        const { result: plain } = renderFields(propsOf({ lines: [bound('flour')], lookup: FOUND }));

        expect([m.nutritionRangeDerivedLow, m.nutritionRangeDerivedHigh]).toContain(ranged.current.rangeNotice);
        expect(plain.current.rangeNotice).toBeUndefined();
    });

    it('a settled Try again is said politely', () => {
        const props = propsOf({ lines: [bound('flour', { resolutionStatus: FoodResolutionStatus.FAILED })] });
        const settled = { lineKey: keyAt(props, 0), status: FoodResolutionStatus.RESOLVED };
        const { result } = renderFields({ ...props, lookupRetry: makeLookupRetry({ settled }) });
        const expected = lookupSettledMessage(m, props.values, settled, shared.ingredientLineName);

        expect(expected).not.toBe('');
        expect(result.current.lookupSettledMessage).toBe(expected);
    });
});
