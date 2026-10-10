/**
 * Tests for {@link ingredientRowViewOf}: one ingredient row's view, as both `RecipeIngredientsFields` leaves draw it.
 *
 * REWRITTEN for the UI overhaul's read rows (build spec §7.5.1, §7.5.2): a row reads quietly (amount, name · prep, ⋯)
 * and its fields live in a row editor, so the glyph's name and busy state, the row-level group field, and the direct
 * Remove button went; the cases that pinned them now pin the open control, the attention line, the full ⋯ and the
 * row editor's view. Where a case still holds the same design line, it names it as before.
 * Each case names the design line it holds: `docs/design/rowEditorOpenDecisions.md` (items 1, 4 and 6, R7, system
 * change 5), `docs/design/ingredientStatusExplanation.md` (§2d and its rows 1, 6 and 7), `docs/design/namelessLineCopy.md`
 * (§6c and §7), and the resolution plan's U25 and U28. The row policy, the copy builders and the focus levels have
 * their own suites; this one holds what the row view wires them to.
 */
import { FoodResolutionStatus, type IngredientVariant } from '@kitchensink/recipe-core';
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
import type { IngredientRowEditor } from '../../hooks/useIngredientRowEditor.js';
import { recipeMessages } from '../../messages.js';
import {
    ingredientAmountNoteId,
    ingredientNoFoodNoteId,
    ingredientsErrorId,
    ingredientUnitNoteId,
} from '../fieldErrorIds.js';
import { ingredientRowViewOf, type IngredientRowContext, type IngredientRowView } from '../ingredientRowView.js';
import type { IngredientLineKey } from '../lineKey.js';
import type { LookupEntry } from '../nutritionLookup.js';
import { recipeFormMessages } from '../messages.js';
import { applyDraftAction } from '../props.js';
import type { RowFocus } from '../useRowFocus.js';
import type { RecipeFormErrors } from '../validate.js';
import type { RecipeFormIngredient } from '../values.js';

const m = recipeFormMessages.en;
const shared = recipeMessages.en;

const BRISKET = 'beef brisket';
const FLAT_SELECT: IngredientVariant = {
    id: 'var_flat_select',
    parts: [
        { attribute: 'cut', text: 'flat half' },
        { attribute: 'grade', text: 'select' },
    ],
};

/** A line bound to a catalog root, named. */
const bound = (over: Partial<UnkeyedFormIngredient> = {}): UnkeyedFormIngredient => ({
    ingredientId: 'ing_brisket',
    foodId: 'food_brisket',
    isUserEntered: false,
    name: BRISKET,
    quantity: 1,
    unit: 'lb',
    resolutionStatus: FoodResolutionStatus.RESOLVED,
    ...over,
});

/** Row 2: a name with no food behind it. */
const nameless = (over: Partial<UnkeyedFormIngredient> = {}): UnkeyedFormIngredient => ({
    ingredientId: null,
    isUserEntered: false,
    name: 'smoked paprika',
    quantity: 1,
    unit: 'tsp',
    ...over,
});

/** The field group's focus requests, each a spy. */
const makeFocus = () => {
    const level = { requested: false, onHandled: () => undefined };

    return {
        name: () => ({ ...level, listRequested: false }),
        open: () => level,
        actions: () => level,
        trailing: { ...level, listRequested: false },
        request: vi.fn<RowFocus['request']>(),
        requestTrailing: vi.fn<RowFocus['requestTrailing']>(),
        authoredSheetDismissed: () => false,
    } satisfies RowFocus;
};

interface Setup {
    readonly lines: readonly UnkeyedFormIngredient[];
    readonly entry?: Partial<IngredientEntry>;
    readonly editor?: Partial<Omit<IngredientRowEditor, 'entry'>>;
    readonly errors?: RecipeFormErrors;
    /** What the nutrition read answers for every ref. */
    readonly lookup?: LookupEntry;
    readonly retrying?: ReadonlySet<string>;
    readonly failure?: string;
    readonly alert?: string;
    /** The row whose editor is open. */
    readonly openKey?: IngredientLineKey;
    /** How many named groups the list has (its own and the cook's new, empty ones). */
    readonly groupCount?: number;
    /** The text the cook typed in each amount bound while the editor is open (`LineEditorState.amountText`). */
    readonly typed?: { readonly low?: string; readonly high?: string };
}

/** Every row of a draft, with the spies a test reads. */
const rowsOf = (setup: Setup) => {
    const values = makeRecipeFormValues({ ingredients: withLineKeys(setup.lines) });
    const focus = makeFocus();
    const retry = vi.fn<(ingredientId: string, key: string) => void>();
    const moveOn = vi.fn<() => void>();
    const entry = makeIngredientEntry(setup.entry);
    // A spy that calls through to a test's own dispatch, when it gives one.
    const dispatch = vi.fn<IngredientRowEditor['dispatch']>(setup.editor?.dispatch);
    const rowEditor = makeIngredientRowEditor({ ...setup.editor, dispatch, entry });
    const answer = setup.lookup;
    const lineEditor = {
        openKey: setup.openKey,
        open: vi.fn<(key: IngredientLineKey) => void>(),
        close: vi.fn<() => void>(),
        rangeShown: () => false,
        showRange: vi.fn<(key: IngredientLineKey) => void>(),
        hideRange: vi.fn<(key: IngredientLineKey) => void>(),
        detailsOpen: false,
        toggleDetails: vi.fn<() => void>(),
        amountText: (_key: IngredientLineKey, bound: 'low' | 'high') => setup.typed?.[bound],
        setAmountText: vi.fn<(key: IngredientLineKey, bound: 'low' | 'high', text: string) => void>(),
    };
    const openFoodDetails = vi.fn<(key: IngredientLineKey) => void>();
    const openMoveToGroup = vi.fn<(key: IngredientLineKey) => void>();
    const ctx: IngredientRowContext = {
        values,
        errors: setup.errors,
        nutrition: makeIngredientNutrition(answer === undefined ? {} : { lookup: () => answer }),
        lookupRetry: makeLookupRetry({ retry, retrying: setup.retrying ?? new Set() }),
        rowEditor,
        focus,
        m,
        shared,
        locale: 'en',
        commitCopy: {
            form: m,
            added: shared.ingredientPickerStatus.added,
            details: shared.ingredientDetails,
            remote: shared.ingredientRemoteSearch,
        },
        failureOf: () => setup.failure,
        alertOf: () => setup.alert,
        moveOn,
        lineEditor,
        openFoodDetails,
        openMoveToGroup,
        groupCount: setup.groupCount ?? 0,
    };
    const rows: readonly IngredientRowView[] = values.ingredients.map((line, index) =>
        ingredientRowViewOf(line, index, ctx),
    );

    return { rows, values, focus, dispatch, retry, entry, rowEditor, lineEditor, openFoodDetails, openMoveToGroup };
};

/** The one row of a single-line draft. */
const onlyRow = (setup: Setup) => {
    const built = rowsOf(setup);
    const [row] = built.rows;

    if (row === undefined) {
        throw new Error('the draft has no row');
    }

    return { ...built, row };
};

/** The action a row's `⋯` menu offers under `key`: one of its actions, or its destructive one. */
const actionOf = (row: IngredientRowView, key: string) => {
    const action = [...row.actions, ...(row.destructiveAction === undefined ? [] : [row.destructiveAction])].find(
        (each) => each.id === key,
    );

    if (action === undefined) {
        throw new Error(`the row offers no ${key}`);
    }

    return action;
};

const keyOf = (line: RecipeFormIngredient | undefined): IngredientLineKey => {
    if (line === undefined) {
        throw new Error('no such line');
    }

    return line.key;
};

describe('ingredientRowViewOf — the row’s control names (item 6, namelessLineCopy §6c and §7)', () => {
    it('a root-bound row names its food alone', () => {
        const { row } = onlyRow({ lines: [bound()] });

        expect(row.labels).toEqual({
            panelClose: 'Close details for beef brisket',
            actionsTrigger: 'Actions for beef brisket',
            actionsClose: 'Close actions for beef brisket',
        });
        expect(row.openLabel).toBe('Edit 1 lb beef brisket');
    });

    it('a variant-bound row names its parts after the food, joined as the dotted line speaks them', () => {
        const { row } = onlyRow({ lines: [bound({ variant: FLAT_SELECT })] });

        expect(row.variantParts).toEqual(['flat half', 'select']);
        expect(row.labels).toEqual({
            panelClose: 'Close details for beef brisket, flat half, select',
            actionsTrigger: 'Actions for beef brisket, flat half, select',
            actionsClose: 'Close actions for beef brisket, flat half, select',
        });
    });

    it('two rows on one root with different variants have different names', () => {
        const { rows } = rowsOf({
            lines: [
                bound({ variant: FLAT_SELECT }),
                bound({
                    variant: {
                        id: 'var_point_choice',
                        parts: [
                            { attribute: 'cut', text: 'point half' },
                            { attribute: 'grade', text: 'choice' },
                        ],
                    },
                }),
            ],
        });

        expect(rows.map((row) => row.labels.actionsTrigger)).toEqual([
            'Actions for beef brisket, flat half, select',
            'Actions for beef brisket, point half, choice',
        ]);
    });

    it('a name never mentions parts the row does not show', () => {
        const { row } = onlyRow({
            lines: [bound({ variant: FLAT_SELECT, resolutionStatus: FoodResolutionStatus.PENDING })],
        });

        expect(row.variantParts).toBeUndefined();
        expect(row.labels.panelClose).toBe('Close details for beef brisket');
        expect(row.labels.actionsTrigger).toBe('Actions for beef brisket');
    });

    it('a stand-in row is named by its amount and its stand-in, so two private rows differ (1.1.1, 2.5.3)', () => {
        const privateLine = (quantity: number, unit: string): UnkeyedFormIngredient =>
            bound({ name: undefined, quantity, unit, resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE });
        const { rows } = rowsOf({ lines: [privateLine(2, 'tbsp'), privateLine(1, 'cup')] });
        const [first, second] = rows;

        expect(first?.standIn).toBe(true);
        expect(first?.displayName).toBe('Private ingredient');
        expect(first?.labels.actionsTrigger).toBe('Actions for 2 tbsp Private ingredient');
        expect(first?.openLabel).toBe('Edit 2 tbsp Private ingredient');
        expect(second?.labels.actionsTrigger).toBe('Actions for 1 cup Private ingredient');
    });
});

describe('ingredientRowViewOf — Change food (item 4, system change 5)', () => {
    it('Change food turns the name into an entry field and asks that field to take focus (§2d)', () => {
        const beginChange = vi.fn<IngredientEntry['beginChange']>();
        const { row, focus, values } = onlyRow({ lines: [bound()], entry: { beginChange } });
        const key = keyOf(values.ingredients[0]);

        actionOf(row, 'changeFood').onSelect();

        expect(beginChange).toHaveBeenCalledWith(key);
        expect(focus.request).toHaveBeenCalledWith(key, 'name');
    });

    it('during Change food the ⋯ offers no Change food, Food details, Add details or Edit details', () => {
        const values = withLineKeys([bound({ variant: FLAT_SELECT })]);
        const key = keyOf(values[0]);
        const { row } = onlyRow({ lines: [bound({ variant: FLAT_SELECT })], entry: { changing: new Set([key]) } });

        expect(row.changing).toBe(true);
        expect(row.presentation.nameMode).toBe('entry');
        expect(row.actions.map((action) => action.id)).toEqual(['edit']);
        expect(row.destructiveAction?.id).toBe('remove');
        expect(row.secondLine).toEqual({ kind: 'none' });
    });

    it('Cancel abandons the entry and hands focus back to the row’s open control', () => {
        const abandon = vi.fn<IngredientEntry['abandon']>();
        const key = keyOf(withLineKeys([bound()])[0]);
        const { row, focus } = onlyRow({ lines: [bound()], entry: { changing: new Set([key]), abandon } });

        row.entryField.onCancel?.();

        expect(abandon).toHaveBeenCalledWith({ kind: 'line', key });
        expect(focus.request).toHaveBeenCalledWith(key, 'open');
    });

    it('Escape on rows 1 and 2 in entry puts back what the line holds and returns focus to the row', () => {
        const abandon = vi.fn<IngredientEntry['abandon']>();
        const lines = [bound({ isUserEntered: true, resolutionStatus: undefined, name: 'pinch of love' }), nameless()];
        const keys = withLineKeys(lines).map((line) => line.key);
        const { rows, focus, values } = rowsOf({ lines, entry: { abandon, changing: new Set(keys) } });

        for (const [index, row] of rows.entries()) {
            row.entryField.onAbandon?.();

            expect(abandon).toHaveBeenLastCalledWith({ kind: 'line', key: keyOf(values.ingredients[index]) });
            expect(focus.request).toHaveBeenLastCalledWith(keyOf(values.ingredients[index]), 'open');
        }
    });

    it('focus leaving a row in Change food ends the entry without moving focus', () => {
        const leave = vi.fn<IngredientEntry['leave']>();
        const key = keyOf(withLineKeys([bound()])[0]);
        const { row, focus } = onlyRow({ lines: [bound()], entry: { changing: new Set([key]), leave } });

        row.onFocusLeft();

        expect(leave).toHaveBeenCalledWith({ kind: 'line', key });
        expect(focus.request).not.toHaveBeenCalled();
    });

    it('focus leaving a row that is not in Change food ends nothing', () => {
        const leave = vi.fn<IngredientEntry['leave']>();
        const { row } = onlyRow({ lines: [bound()], entry: { leave } });

        row.onFocusLeft();

        expect(leave).not.toHaveBeenCalled();
    });
});

describe('ingredientRowViewOf — the ⋮ items on the other rows (ingredientStatusExplanation rows 1, 2; item 1)', () => {
    it('row 1’s Find a food for this puts the quiet row into its food search, on the cook’s own words', () => {
        const beginChange = vi.fn<IngredientEntry['beginChange']>();
        const { row, focus, values } = onlyRow({
            lines: [bound({ isUserEntered: true, resolutionStatus: undefined, name: 'pinch of love' })],
            entry: { beginChange },
        });
        const key = keyOf(values.ingredients[0]);
        const find = actionOf(row, 'findFood');

        expect(find.label).toBe('Find a food for this');
        expect(row.presentation.nameMode).toBe('entry');
        expect(row.inEntry).toBe(false);

        find.onSelect();

        expect(beginChange).toHaveBeenCalledWith(key);
        expect(focus.request).toHaveBeenCalledWith(key, 'name');
    });

    it('Create my own food opens the form on the name the cook typed, trimmed, for that line (§5a)', () => {
        const open = vi.fn<IngredientRowEditor['authoredFood']['open']>();
        const { row, values } = onlyRow({
            lines: [nameless()],
            entry: { textOf: () => ' smoked paprika ' },
            editor: {
                authoredFood: { ...makeIngredientRowEditor().authoredFood, open },
            },
        });
        const create = actionOf(row, 'createOwnFood');

        expect(create.label).toBe('Create my own food');

        create.onSelect();

        expect(open).toHaveBeenCalledWith('smoked paprika', { kind: 'line', key: keyOf(values.ingredients[0]) });
    });
});

describe('ingredientRowViewOf — Add details and Edit details (blueprint decisions 4 and 7)', () => {
    it('Add details on a root with a live variant opens the dialog on that root, in add mode', () => {
        const open = vi.fn<IngredientRowEditor['details']['open']>();
        const { row, values } = onlyRow({
            lines: [bound()],
            lookup: { state: 'found', catalog: { caloriesPer100g: 200 }, hasVariants: true },
            editor: { details: { ...makeIngredientRowEditor().details, open } },
        });
        const add = actionOf(row, 'addDetails');

        expect(add.label).toBe('Add details');

        add.onSelect();

        expect(open).toHaveBeenCalledWith({
            key: keyOf(values.ingredients[0]),
            rootId: 'food_brisket',
            foodName: BRISKET,
            entry: { mode: 'add' },
        });
    });

    it('Edit details on a variant-bound line opens the dialog on its current variant', () => {
        const open = vi.fn<IngredientRowEditor['details']['open']>();
        const { row, values } = onlyRow({
            lines: [bound({ variant: FLAT_SELECT })],
            editor: { details: { ...makeIngredientRowEditor().details, open } },
        });
        const edit = actionOf(row, 'editDetails');

        expect(edit.label).toBe('Edit details');

        edit.onSelect();

        expect(open).toHaveBeenCalledWith({
            key: keyOf(values.ingredients[0]),
            rootId: 'food_brisket',
            foodName: BRISKET,
            entry: { mode: 'edit', current: FLAT_SELECT },
        });
    });
});

describe('ingredientRowViewOf — Remove (§2d, V1 sign-off item 11, item 4’s busy rule)', () => {
    const three = [bound({ name: 'flour' }), bound({ name: 'sugar' }), bound({ name: 'salt' })];

    it('removes that line and hands focus to the next row’s open control', () => {
        const dispatch = vi.fn<IngredientRowEditor['dispatch']>();
        const { rows, focus, values } = rowsOf({ lines: three, editor: { dispatch } });

        rows[1]?.onRemove();

        expect(dispatch).toHaveBeenCalledWith({ kind: 'removeIngredient', key: keyOf(values.ingredients[1]) });
        expect(focus.request).toHaveBeenCalledWith(keyOf(values.ingredients[2]), 'open');
        expect(focus.requestTrailing).not.toHaveBeenCalled();
    });

    it('removing the last row hands focus to the trailing combobox', () => {
        const dispatch = vi.fn<IngredientRowEditor['dispatch']>();
        const { rows, focus, values } = rowsOf({ lines: three, editor: { dispatch } });

        rows[2]?.onRemove();

        expect(dispatch).toHaveBeenCalledWith({ kind: 'removeIngredient', key: keyOf(values.ingredients[2]) });
        expect(focus.requestTrailing).toHaveBeenCalledOnce();
        expect(focus.request).not.toHaveBeenCalled();
    });

    // UI-overhaul slice 2: the design-system menu draws its destructive action last, after a divider, as its own field.
    it('offers the ⋯ menu’s Remove ingredient as its destructive action, never among its actions', () => {
        const { rows } = rowsOf({ lines: three });
        const [first] = rows;

        if (first === undefined) {
            throw new Error('no first row');
        }

        expect(first.destructiveAction?.id).toBe('remove');
        expect(first.actions.map((action) => action.id)).not.toContain('remove');
    });

    it('the ⋯ menu’s Remove ingredient removes the line: Remove is never a row button', () => {
        const dispatch = vi.fn<IngredientRowEditor['dispatch']>();
        const { rows, values } = rowsOf({ lines: three, editor: { dispatch } });
        const [first] = rows;

        if (first === undefined) {
            throw new Error('the draft has no row');
        }

        const remove = actionOf(first, 'remove');

        expect(remove.label).toBe('Remove ingredient');

        remove.onSelect();

        expect(dispatch).toHaveBeenCalledWith({ kind: 'removeIngredient', key: keyOf(values.ingredients[0]) });
    });

    it('while a pick on the row is in flight the row is busy and Remove does nothing', () => {
        const dispatch = vi.fn<IngredientRowEditor['dispatch']>();
        const { row, focus } = onlyRow({
            lines: [bound()],
            editor: {
                dispatch,
                pickInFlight: () => ({ kind: 'name', text: 'brisket' }),
            },
        });

        row.onRemove();

        expect(row.busy).toBe(true);
        expect(row.busyText).toBe('Finding nutrition');
        expect(dispatch).not.toHaveBeenCalled();
        expect(focus.request).not.toHaveBeenCalled();
        expect(focus.requestTrailing).not.toHaveBeenCalled();
    });
});

describe('ingredientRowViewOf — rows 6 and 7: None of these (ingredientStatusExplanation §721-728)', () => {
    it.each([
        ['row 6, UNRESOLVED', FoodResolutionStatus.UNRESOLVED, 'unresolved'],
        ['row 7, AMBIGUOUS', FoodResolutionStatus.AMBIGUOUS, 'ambiguous'],
    ] as const)(
        '%s: the panel’s None of these returns the line to entry mode and closes the panel',
        (_, status, reason) => {
            const beginChange = vi.fn<IngredientEntry['beginChange']>();
            const close = vi.fn<() => void>();
            const { row, focus, values } = onlyRow({
                lines: [bound({ resolutionStatus: status })],
                entry: { beginChange },
            });
            const key = keyOf(values.ingredients[0]);
            const panel = row.shortlist(close);

            expect(panel).toMatchObject({ reason, food: BRISKET, phrase: BRISKET });
            expect(panel.onSettled).toBe(close);

            panel.onNoneOfThese();

            expect(beginChange).toHaveBeenCalledWith(key);
            expect(focus.request).toHaveBeenCalledWith(key, 'name');
            expect(close).toHaveBeenCalledOnce();
        },
    );
});

describe('ingredientRowViewOf — the notes the line itself carries (U25, U28)', () => {
    it('U28: a row with no food says so before any submit: its attention line, and its entry field when open', () => {
        const { row } = onlyRow({ lines: [nameless()] });

        expect(row.secondLine).toMatchObject({ kind: 'attention', text: m.rowStateNoMatch, opens: 'entry' });
        expect(row.noFoodNote).toBe(m.ingredientNoFoodNote);
        expect(row.entryField.invalid).toBe(true);
        expect(row.entryField.describedBy).toContain(ingredientNoFoodNoteId(0));
    });

    it('U28: a row bound to a food carries no such note', () => {
        const { row } = onlyRow({ lines: [bound()] });

        expect(row.noFoodNote).toBeUndefined();
        expect(row.secondLine).toEqual({ kind: 'none' });
        expect(row.entryField.invalid).toBe(false);
    });

    it('U25: a unit the vocabulary does not know is accepted, noted as text that describes the field', () => {
        const { row } = onlyRow({ lines: [bound({ unit: 'blorp' })] });

        expect(row.unitNote).toEqual(expect.any(String));
        expect(row.describedBy.unit).toBe(ingredientUnitNoteId(0));
    });

    // The row editor no longer styles an unknown unit (the inline strip's italic went with it): the note is the mark.
    it('U25: a canonical unit has no note; a subjective one is told apart from an unknown one, in words', () => {
        const { rows } = rowsOf({ lines: [bound({ unit: 'cup' }), bound({ unit: 'handful' })] });
        const [cup, handful] = rows;

        expect(cup?.unitNote).toBeUndefined();
        expect(cup?.describedBy.unit).toBeUndefined();
        expect(handful?.unitNote).toEqual(expect.any(String));
        expect(handful?.unitNote).not.toBe(onlyRow({ lines: [bound({ unit: 'blorp' })] }).row.unitNote);
    });
});

describe('ingredientRowViewOf — what a refusal and a pick say on the row (R7, item 1, item 4)', () => {
    it('R7: after a refused save, a pending row-2 field says its trimmed text and is invalid, keeping no food', () => {
        const key = keyOf(withLineKeys([nameless()])[0]);
        const { row } = onlyRow({
            lines: [nameless()],
            entry: { isPending: () => true, textOf: () => '  smoked flour ', changing: new Set([key]) },
            editor: { pendingRefused: true },
        });

        expect(row.pendingText).toBe('“smoked flour” isn’t in the recipe yet. Choose a food for it, or clear the box.');
        expect(row.entryField.invalid).toBe(true);
    });

    it('R7: a pending Change food row names the food Cancel keeps', () => {
        const key = keyOf(withLineKeys([bound()])[0]);
        const { row } = onlyRow({
            lines: [bound()],
            entry: { isPending: () => true, textOf: () => 'brisket point', changing: new Set([key]) },
            editor: { pendingRefused: true },
        });

        expect(row.pendingText).toBe(
            '“brisket point” isn’t in the recipe yet. Choose a food for it, or press Cancel to keep beef brisket.',
        );
        expect(row.entryField.invalid).toBe(true);
    });

    it('R7: before any refusal, pending text says nothing', () => {
        const { row } = onlyRow({
            lines: [bound()],
            entry: { isPending: () => true, textOf: () => 'brisket point' },
        });

        expect(row.pendingText).toBeUndefined();
        expect(row.entryField.invalid).toBe(false);
    });

    // REWRITTEN for E2 (`docs/design/rowEditorOpenDecisions.md`): the row's line and its field's alert are two facts.
    // The line is `failureOf`; the field says only what `alertOf` says, which is silent for a failure found on return.
    it('a pick that did not take on this row shows its line on the row, and its field says the alert alone', () => {
        const found = onlyRow({ lines: [bound()], failure: 'The change didn’t save.' }).row;
        const spoken = onlyRow({
            lines: [bound()],
            failure: 'The change didn’t save.',
            alert: 'The change didn’t save.',
        }).row;

        expect(found.failure).toBe('The change didn’t save.');
        expect(found.entryField.pickFailure).toBeUndefined();
        expect(spoken.entryField.pickFailure).toBe('The change didn’t save.');
    });
});

describe('ingredientRowViewOf — Try again for a failed lookup (V1 sign-off item 4)', () => {
    it('asks the retry for the row’s binding, and the row says it is looking it up while it runs', () => {
        const { row, retry, values, focus } = onlyRow({
            lines: [bound({ resolutionStatus: FoodResolutionStatus.FAILED })],
            retrying: new Set(['ing_brisket']),
        });

        row.onRetryLookup();

        expect(retry).toHaveBeenCalledWith('ing_brisket', keyOf(values.ingredients[0]));
        // The attention line gives way while the ask runs: focus goes to the row's open control, never the page.
        expect(focus.request).toHaveBeenCalledWith(keyOf(values.ingredients[0]), 'open');
        expect(row.retrying).toBe(true);
        expect(row.secondLine).toEqual({ kind: 'working', text: m.rowStateLookingUp });
    });
});

describe('ingredientRowViewOf — the row’s field edits', () => {
    // §7.5.2: no group field in the row editor; groups are set at the section level (`ingredientGroups.test.ts`).
    it('each edit changes that line’s own field and nothing else (U26)', () => {
        const { rows, dispatch, values } = rowsOf({ lines: [bound({ name: 'flour' }), bound({ name: 'sugar' })] });
        const second = rows[1];

        second?.edit.unit('cup');
        second?.edit.preparation('sifted');
        second?.edit.quantityLow('3');

        const [unit, preparation, quantity] = dispatch.mock.calls.map(
            ([action]) => applyDraftAction(values, action).ingredients,
        );

        expect(unit?.[1]).toEqual({ ...values.ingredients[1], unit: 'cup' });
        expect(preparation?.[1]).toEqual({ ...values.ingredients[1], preparation: 'sifted' });
        expect(quantity?.[1]?.quantity).toBe(3);

        for (const next of [unit, preparation, quantity]) {
            expect(next?.[0]).toEqual(values.ingredients[0]);
        }
    });
});

describe('ingredientRowViewOf — a quantity pair the submit refused (U9)', () => {
    it.each([
        ['a pair the wire cannot store, under the submit’s error', { quantity: 2, quantityHigh: 1e8 }, true, true],
        ['a pair the wire cannot store, with no such error', { quantity: 2, quantityHigh: 1e8 }, false, false],
        ['a valid pair under the error', { quantity: 2, quantityHigh: 3 }, true, false],
    ] as const)('marks both bounds for %s', (_case, amounts, withError, invalid) => {
        const { row } = onlyRow({
            lines: [bound(amounts)],
            ...(withError ? { errors: { ingredients: 'ingredientsQuantityInvalid' } } : {}),
        });

        expect(row.quantityInvalid).toBe(invalid);
        expect(row.describedBy.quantityHigh).toBe(invalid ? ingredientsErrorId : undefined);
    });
});

/**
 * REWRITTEN (2026-10-09 review, Medium 4): an edit used to call `onChange(applyDraftAction(values, …))` with the values
 * of the render that built the handler, so a settle or a held rebind that landed before the click was overwritten. Each
 * edit is now the editor's own transition (`rowEditor.dispatch`), which meets the draft as it is when it runs.
 */
describe('ingredientRowViewOf — each field edit is one draft transition', () => {
    it.each([
        ['quantityLow', '2.5', { kind: 'setIngredientQuantityLow', index: 1, value: 2.5 }],
        ['quantityHigh', '', { kind: 'setIngredientQuantityHigh', index: 1, value: undefined }],
        ['unit', 'tbsp', { kind: 'updateIngredientAt', index: 1, patch: { unit: 'tbsp' } }],
        ['preparation', 'sliced', { kind: 'updateIngredientAt', index: 1, patch: { preparation: 'sliced' } }],
    ] as const)('the %s field edits its own line', (field, text, action) => {
        const { rows, dispatch } = rowsOf({ lines: [bound({ name: 'flour' }), bound({ name: 'sugar' })] });

        rows[1]?.edit[field](text);

        expect(dispatch).toHaveBeenCalledExactlyOnceWith(action);
    });

    it('an edit pressed after a settle landed keeps the settle, because it meets the draft as it is then', () => {
        // A store the way `useRecipeEditor` holds the draft: each transition applies to the CURRENT value.
        let draft = makeRecipeFormValues({
            ingredients: withLineKeys([bound({ name: 'flour' }), bound({ name: 'sugar' })]),
        });

        const dispatch = (action: Parameters<IngredientRowEditor['dispatch']>[0]): void => {
            draft = applyDraftAction(draft, action);
        };

        const { rows } = rowsOf({ lines: [bound({ name: 'flour' }), bound({ name: 'sugar' })], editor: { dispatch } });

        dispatch({ kind: 'updateIngredientAt', index: 0, patch: { preparation: 'sifted' } });
        rows[1]?.edit.unit('cup');
        actionOf(rows[1] as IngredientRowView, 'moveUp').onSelect();

        expect(draft.ingredients.map((line) => [line.name, line.unit, line.preparation])).toEqual([
            ['sugar', 'cup', undefined],
            ['flour', 'lb', 'sifted'],
        ]);
    });
});

/**
 * 2026-10-09 review, High 3: the Amount field parsed with `Number(text)`, so "1/2", "½" and "1,5" stored no amount and
 * the field emptied. It reads with the add field's own amount rules, and text it cannot read stays in the field, marked
 * invalid with its note, while the draft keeps the last amount it could read.
 */
describe('ingredientRowViewOf — the row editor’s Amount field reads like the add field', () => {
    it.each([
        { typed: '1/2', value: 0.5 },
        { typed: '½', value: 0.5 },
        { typed: '1,5', value: 1.5 },
        { typed: '1 1/2', value: 1.5 },
        { typed: '٣', value: 3 },
        { typed: '', value: undefined },
    ])('"$typed" states $value', ({ typed, value }) => {
        const { row, dispatch, lineEditor, values } = onlyRow({ lines: [bound({ quantity: 2 })] });

        row.lineEditor.onAmountLow(typed);
        row.lineEditor.onAmountHigh(typed);

        expect(dispatch.mock.calls).toEqual([
            [{ kind: 'setIngredientQuantityLow', index: 0, value }],
            [{ kind: 'setIngredientQuantityHigh', index: 0, value }],
        ]);
        expect(lineEditor.setAmountText).toHaveBeenCalledWith(keyOf(values.ingredients[0]), 'low', typed);
        expect(lineEditor.setAmountText).toHaveBeenCalledWith(keyOf(values.ingredients[0]), 'high', typed);
    });

    it.each(['abc', '1/', '0', '2 cups'])('"%s" changes nothing in the draft', (typed) => {
        const { row, dispatch } = onlyRow({ lines: [bound({ quantity: 2 })] });

        row.lineEditor.onAmountLow(typed);

        expect(dispatch).not.toHaveBeenCalled();
    });

    it('text it cannot read stays in the field, marked invalid and described by its note', () => {
        const { row, values } = onlyRow({ lines: [bound({ quantity: 2 })], typed: { low: 'abc' } });
        const noteId = ingredientAmountNoteId(keyOf(values.ingredients[0]));

        expect(row.lineEditor).toMatchObject({
            amountLow: 'abc',
            amountInvalid: true,
            amountNote: { id: noteId, text: m.rowAmountInvalid },
        });
        expect(row.lineEditor.describedBy.quantity?.split(' ')).toContain(noteId);
    });

    it('an unreadable upper bound marks the amount invalid and is described by the same note', () => {
        const { row, values } = onlyRow({ lines: [bound({ quantity: 2, quantityHigh: 3 })], typed: { high: '3 ish' } });

        expect(row.lineEditor).toMatchObject({ amountHigh: '3 ish', amountInvalid: true });
        expect(row.lineEditor.describedBy.quantityHigh?.split(' ')).toContain(
            ingredientAmountNoteId(keyOf(values.ingredients[0])),
        );
    });

    it('keeps the text as typed while it states the draft’s amount ("1." while typing "1.5")', () => {
        const { row } = onlyRow({ lines: [bound({ quantity: 1 })], typed: { low: '1.' } });

        expect(row.lineEditor).toMatchObject({ amountLow: '1.', amountInvalid: false, amountNote: undefined });
    });

    it('typed text the draft has since moved past gives way to the draft', () => {
        const { row } = onlyRow({ lines: [bound({ quantity: 2 })], typed: { low: '3' } });

        expect(row.lineEditor.amountLow).toBe('2');
    });
});

describe('ingredientRowViewOf — the read row (build spec §7.5.1)', () => {
    it('reads amount first, then the name and the preparation; a healthy row has no second line', () => {
        const { row } = onlyRow({
            lines: [bound({ quantity: 2, quantityHigh: 2.5, unit: 'kg', preparation: 'trimmed' })],
        });

        expect(row.amountText).toBe('2–2.5 kg');
        expect(row.prepText).toBe('trimmed');
        expect(row.secondLine).toEqual({ kind: 'none' });
        expect(row.openLabel).toBe('Edit 2–2.5 kg beef brisket');
    });

    it('a line with no amount leaves the amount column empty: never an invented "1" (F5)', () => {
        const { row } = onlyRow({ lines: [bound({ quantity: Number.NaN, unit: undefined, preparation: '  ' })] });

        expect(row.amountText).toBe('');
        expect(row.prepText).toBeUndefined();
        expect(row.openLabel).toBe('Edit beef brisket');
    });

    it('a row that needs the cook says why in an attention line named for its food (SC 2.5.3)', () => {
        const { row } = onlyRow({ lines: [bound({ resolutionStatus: FoodResolutionStatus.AMBIGUOUS })] });

        expect(row.secondLine).toEqual({
            kind: 'attention',
            text: m.rowStateChooseMatch,
            label: 'Choose a match: beef brisket',
            opens: 'panel',
        });
    });

    it('a line with no food: its attention line starts the food search in the row', () => {
        const beginChange = vi.fn<IngredientEntry['beginChange']>();
        const { row, focus, values } = onlyRow({ lines: [nameless()], entry: { beginChange } });
        const key = keyOf(values.ingredients[0]);

        expect(row.secondLine.kind === 'attention' && row.secondLine.opens).toBe('entry');

        row.onBeginEntry();

        expect(beginChange).toHaveBeenCalledWith(key);
        expect(focus.request).toHaveBeenCalledWith(key, 'name');
    });

    it('a row being looked up says so, as words and not a control', () => {
        const { row } = onlyRow({ lines: [bound({ resolutionStatus: FoodResolutionStatus.PENDING })] });

        expect(row.secondLine).toEqual({ kind: 'working', text: m.rowStateLookingUp });
    });

    it('a quantity pair the submit refused shows a note under the row', () => {
        const { row } = onlyRow({
            lines: [bound({ quantity: 2, quantityHigh: 1e8 })],
            errors: { ingredients: 'ingredientsQuantityInvalid' },
        });

        expect(row.amountInvalidNote).toBe(m.rowAmountInvalid);
    });

    it('the open control opens THAT row’s editor', () => {
        const { rows, values, lineEditor } = rowsOf({ lines: [bound({ name: 'flour' }), bound({ name: 'sugar' })] });

        rows[1]?.onOpen();

        expect(lineEditor.open).toHaveBeenCalledWith(keyOf(values.ingredients[1]));
        expect(rows[1]?.editorOpen).toBe(false);
    });

    it('marks the row whose editor is open', () => {
        const key = keyOf(withLineKeys([bound()])[0]);
        const { row } = onlyRow({ lines: [bound()], openKey: key });

        expect(row.editorOpen).toBe(true);
    });
});

describe('ingredientRowViewOf — the singular name for a count of one (D21)', () => {
    it('reads "1 large onion" for one with a size word, in the name and in the open label', () => {
        const { row } = onlyRow({
            lines: [bound({ name: 'onions', quantity: 1, unit: 'large', preparation: 'diced' })],
        });

        expect(row.displayName).toBe('onion');
        expect(row.openLabel).toBe('Edit 1 large onion');
        expect(row.line.name).toBe('onions');
    });

    it('keeps the catalog\u2019s own spelling for two, for a canonical unit and for a range', () => {
        expect(onlyRow({ lines: [bound({ name: 'onions', quantity: 2, unit: '' })] }).row.displayName).toBe('onions');
        expect(onlyRow({ lines: [bound({ name: 'onions', quantity: 1, unit: 'cup' })] }).row.displayName).toBe(
            'onions',
        );
        expect(
            onlyRow({ lines: [bound({ name: 'onions', quantity: 1, quantityHigh: 2, unit: '' })] }).row.displayName,
        ).toBe('onions');
    });

    it('never singularizes a stand-in', () => {
        const { row } = onlyRow({
            lines: [
                nameless({
                    name: undefined,
                    resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE,
                    quantity: 1,
                    unit: '',
                }),
            ],
        });

        expect(row.displayName).toBe('Private ingredient');
    });
});

describe('ingredientRowViewOf — the ⋯ (build spec §7.5.1)', () => {
    const SAUCE = [
        bound({ name: 'salt' }),
        bound({ name: 'oil', groupLabel: 'Sauce' }),
        bound({ name: 'garlic', groupLabel: 'Sauce' }),
        bound({ name: 'lemon', groupLabel: 'Sauce' }),
    ];
    const ids = (row: IngredientRowView | undefined): string[] => [
        ...(row?.actions.map((action) => action.id) ?? []),
        ...(row?.destructiveAction === undefined ? [] : [row.destructiveAction.id]),
    ];

    it('a resolved row mid-group: Edit · Food details · Change food · Move to group… · Move up · Move down · Remove', () => {
        const { rows } = rowsOf({
            lines: SAUCE,
            groupCount: 1,
            lookup: { state: 'found', catalog: { caloriesPer100g: 9 } },
        });

        expect(ids(rows[2])).toEqual([
            'edit',
            'foodDetails',
            'changeFood',
            'moveToGroup',
            'moveUp',
            'moveDown',
            'remove',
        ]);
        expect(rows[2]?.actions.map((action) => action.label)).toEqual([
            m.rowEdit,
            m.rowFoodDetails,
            m.statusActionChangeFood,
            m.rowMoveToGroup,
            m.rowMoveUp,
            m.rowMoveDown,
        ]);
    });

    it('offers each move only where it moves the row: never greyed, never across a group', () => {
        const { rows } = rowsOf({ lines: SAUCE, groupCount: 1 });

        expect(ids(rows[0])).not.toContain('moveUp');
        expect(ids(rows[0])).not.toContain('moveDown');
        expect(ids(rows[1])).not.toContain('moveUp');
        expect(ids(rows[1])).toContain('moveDown');
        expect(ids(rows[3])).toContain('moveUp');
        expect(ids(rows[3])).not.toContain('moveDown');
    });

    it('an ungrouped list with no group offers no Move to group…', () => {
        const { rows } = rowsOf({ lines: [bound({ name: 'a' }), bound({ name: 'b' })] });

        expect(ids(rows[0])).not.toContain('moveToGroup');
    });

    it('a row that needs a choice offers no Food details: its attention line opens its panel', () => {
        const { row } = onlyRow({ lines: [bound({ resolutionStatus: FoodResolutionStatus.AMBIGUOUS })] });

        expect(ids(row)).toEqual(['edit', 'remove']);
    });

    it('a resolved food with no figures offers no Food details (§7.5.1 "Resolved, no figures")', () => {
        const { row } = onlyRow({ lines: [bound()], lookup: { state: 'found', catalog: {} } });

        expect(ids(row)).not.toContain('foodDetails');
        expect(ids(row)).toContain('changeFood');
    });

    it('each item does its job on THAT row', () => {
        const { rows, values, dispatch, lineEditor, openFoodDetails, openMoveToGroup, focus } = rowsOf({
            lines: SAUCE,
            groupCount: 1,
        });
        const row = rows[2];
        const key = keyOf(values.ingredients[2]);

        if (row === undefined) {
            throw new Error('no row');
        }

        actionOf(row, 'edit').onSelect();
        expect(lineEditor.open).toHaveBeenCalledWith(key);

        actionOf(row, 'foodDetails').onSelect();
        expect(openFoodDetails).toHaveBeenCalledWith(key);

        actionOf(row, 'moveToGroup').onSelect();
        expect(openMoveToGroup).toHaveBeenCalledWith(key);

        actionOf(row, 'moveUp').onSelect();
        expect(dispatch).toHaveBeenLastCalledWith({ kind: 'moveIngredient', key, direction: 'up' });
        expect(focus.request).toHaveBeenLastCalledWith(key, 'actions');

        actionOf(row, 'moveDown').onSelect();
        expect(dispatch).toHaveBeenLastCalledWith({ kind: 'moveIngredient', key, direction: 'down' });
    });
});

describe('ingredientRowViewOf — the row editor (build spec §7.5.2)', () => {
    it('names the food with its calories per 100 g when food publishes them', () => {
        const { row } = onlyRow({ lines: [bound()], lookup: { state: 'found', catalog: { caloriesPer100g: 282 } } });

        expect(row.lineEditor.food).toBe('beef brisket · 282 cal per 100 g');
        expect(row.lineEditor.title).toBe('beef brisket');
    });

    it('names the food alone while its figures are not known', () => {
        expect(onlyRow({ lines: [bound()] }).row.lineEditor.food).toBe('beef brisket');
    });

    it('holds the amount, the unit and the preparation as the cook typed them; an absent amount is empty', () => {
        const { row } = onlyRow({ lines: [bound({ quantity: Number.NaN, unit: 'handful', preparation: 'torn' })] });

        expect(row.lineEditor).toMatchObject({ amountLow: '', amountHigh: '', unit: 'handful', prep: 'torn' });
        expect(row.lineEditor.unitNote).toEqual(expect.any(String));
    });

    it('shows the range when the line states one, or once the cook asks for one', () => {
        expect(onlyRow({ lines: [bound({ quantity: 2, quantityHigh: 3 })] }).row.lineEditor.rangeShown).toBe(true);
        expect(onlyRow({ lines: [bound()] }).row.lineEditor.rangeShown).toBe(false);
    });

    it('Remove range clears the upper bound and hides the field', () => {
        const { row, dispatch, values, lineEditor } = onlyRow({ lines: [bound({ quantity: 2, quantityHigh: 3 })] });
        const key = keyOf(values.ingredients[0]);

        row.lineEditor.onRemoveRange();

        expect(dispatch).toHaveBeenCalledWith({ kind: 'setIngredientQuantityHigh', index: 0, value: undefined });
        expect(lineEditor.hideRange).toHaveBeenCalledWith(key);
    });

    it('typing in the upper bound keeps it shown, so emptying it mid-edit does not take the field away', () => {
        const { row, values, lineEditor } = onlyRow({ lines: [bound({ quantity: 2, quantityHigh: 3 })] });

        row.lineEditor.onAmountHigh('');

        expect(lineEditor.showRange).toHaveBeenCalledWith(keyOf(values.ingredients[0]));
    });

    it('suggests the units that start with what the unit field holds', () => {
        expect(onlyRow({ lines: [bound({ unit: 'tabl' })] }).row.lineEditor.unitSuggestions).toContain('tablespoon');
    });

    it('Change closes the editor and puts the row into its food search', () => {
        const beginChange = vi.fn<IngredientEntry['beginChange']>();
        const { row, values, lineEditor, focus } = onlyRow({ lines: [bound()], entry: { beginChange } });
        const key = keyOf(values.ingredients[0]);

        row.lineEditor.onChangeFood?.();

        expect(lineEditor.close).toHaveBeenCalled();
        expect(beginChange).toHaveBeenCalledWith(key);
        expect(focus.request).toHaveBeenCalledWith(key, 'name');
    });

    it('offers no Change where the row’s own state forbids it (a shortlist row: its panel is the remedy)', () => {
        expect(
            onlyRow({ lines: [bound({ resolutionStatus: FoodResolutionStatus.AMBIGUOUS })] }).row.lineEditor
                .onChangeFood,
        ).toBeUndefined();
    });

    it('Done closes the editor and returns focus to the row', () => {
        const { row, values, lineEditor, focus } = onlyRow({ lines: [bound()] });

        row.lineEditor.onDone();

        expect(lineEditor.close).toHaveBeenCalled();
        expect(focus.request).toHaveBeenCalledWith(keyOf(values.ingredients[0]), 'open');
    });

    it('gives each field an id of its own line, so two rows never share a label target', () => {
        const { rows } = rowsOf({ lines: [bound({ name: 'a' }), bound({ name: 'b' })] });
        const [first, second] = rows;

        expect(first?.lineEditor.ids.amount).not.toBe(second?.lineEditor.ids.amount);
        expect(new Set(Object.values(first?.lineEditor.ids ?? {})).size).toBe(4);
    });
});
