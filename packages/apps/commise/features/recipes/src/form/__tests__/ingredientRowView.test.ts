/**
 * Tests for {@link ingredientRowViewOf}: one ingredient row's view, as both `RecipeIngredientsFields` leaves draw it.
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
import { ingredientNoFoodNoteId, ingredientsErrorId, ingredientUnitNoteId } from '../fieldErrorIds.js';
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
        glyph: () => ({ ...level, onPanelDismissed: () => undefined }),
        actions: () => level,
        trailing: { ...level, listRequested: false },
        request: vi.fn<RowFocus['request']>(),
        requestTrailing: vi.fn<RowFocus['requestTrailing']>(),
        requestAfterGlyphPanel: vi.fn<RowFocus['requestAfterGlyphPanel']>(),
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
}

/** Every row of a draft, with the spies a test reads. */
const rowsOf = (setup: Setup) => {
    const values = makeRecipeFormValues({ ingredients: withLineKeys(setup.lines) });
    const focus = makeFocus();
    const onChange = vi.fn<(next: typeof values) => void>();
    const retry = vi.fn<(ingredientId: string, key: string) => void>();
    const moveOn = vi.fn<() => void>();
    const entry = makeIngredientEntry(setup.entry);
    const rowEditor = makeIngredientRowEditor({ ...setup.editor, entry });
    const answer = setup.lookup;
    const ctx: IngredientRowContext = {
        values,
        errors: setup.errors,
        onChange,
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
    };
    const rows: readonly IngredientRowView[] = values.ingredients.map((line, index) =>
        ingredientRowViewOf(line, index, ctx),
    );

    return { rows, values, focus, onChange, retry, entry, rowEditor };
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

/** The action a row's `⋮` menu offers under `key`. */
const actionOf = (row: IngredientRowView, key: string) => {
    const action = row.actions.find((each) => each.key === key);

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

describe('ingredientRowViewOf — the glyph and ⋮ names (item 6, namelessLineCopy §6c and §7)', () => {
    it('a root-bound row names its food alone', () => {
        const { row } = onlyRow({ lines: [bound()] });

        expect(row.labels).toEqual({
            glyphTrigger: 'About beef brisket',
            glyphClose: 'Close details for beef brisket',
            actionsTrigger: 'Actions for beef brisket',
            actionsClose: 'Close actions for beef brisket',
        });
    });

    it('a variant-bound row names its parts after the food, joined as the dotted line speaks them', () => {
        const { row } = onlyRow({ lines: [bound({ variant: FLAT_SELECT })] });

        expect(row.variantParts).toEqual(['flat half', 'select']);
        expect(row.labels).toEqual({
            glyphTrigger: 'About beef brisket, flat half, select',
            glyphClose: 'Close details for beef brisket, flat half, select',
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

        expect(rows.map((row) => row.labels.glyphTrigger)).toEqual([
            'About beef brisket, flat half, select',
            'About beef brisket, point half, choice',
        ]);
    });

    it('a name never mentions parts the row does not show', () => {
        const { row } = onlyRow({
            lines: [bound({ variant: FLAT_SELECT, resolutionStatus: FoodResolutionStatus.PENDING })],
        });

        expect(row.variantParts).toBeUndefined();
        expect(row.labels.glyphTrigger).toBe('About beef brisket');
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
        expect(first?.labels.glyphTrigger).toBe('About 2 tbsp Private ingredient');
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

    it('during Change food the row has no Change food, Add details or Edit details, so Remove is direct', () => {
        const values = withLineKeys([bound({ variant: FLAT_SELECT })]);
        const key = keyOf(values[0]);
        const { row } = onlyRow({ lines: [bound({ variant: FLAT_SELECT })], entry: { changing: new Set([key]) } });

        expect(row.changing).toBe(true);
        expect(row.presentation.nameMode).toBe('entry');
        expect(row.presentation.slot2).toEqual({ kind: 'direct', action: 'remove' });
        expect(row.actions).toEqual([]);
    });

    it('Cancel abandons the entry and hands focus back to the row’s ⋮, where Change food was chosen', () => {
        const abandon = vi.fn<IngredientEntry['abandon']>();
        const key = keyOf(withLineKeys([bound()])[0]);
        const { row, focus } = onlyRow({ lines: [bound()], entry: { changing: new Set([key]), abandon } });

        row.entryField.onCancel?.();

        expect(abandon).toHaveBeenCalledWith({ kind: 'line', key });
        expect(focus.request).toHaveBeenCalledWith(key, 'actions');
    });

    it('Escape on rows 1 and 2 puts back what the line holds and leaves focus in the field', () => {
        const abandon = vi.fn<IngredientEntry['abandon']>();
        const { rows, focus, values } = rowsOf({
            lines: [bound({ isUserEntered: true, resolutionStatus: undefined, name: 'pinch of love' }), nameless()],
            entry: { abandon },
        });

        for (const [index, row] of rows.entries()) {
            row.entryField.onAbandon?.();

            expect(abandon).toHaveBeenLastCalledWith({ kind: 'line', key: keyOf(values.ingredients[index]) });
        }

        expect(focus.request).not.toHaveBeenCalled();
        expect(focus.requestTrailing).not.toHaveBeenCalled();
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
    it('row 1’s Find a food for this moves into the row’s own entry field', () => {
        const focusEntry = vi.fn<IngredientEntry['focus']>();
        const { row, focus, values } = onlyRow({
            lines: [bound({ isUserEntered: true, resolutionStatus: undefined, name: 'pinch of love' })],
            entry: { focus: focusEntry },
        });
        const key = keyOf(values.ingredients[0]);
        const find = actionOf(row, 'findFood');

        expect(find.label).toBe('Find a food for this');

        find.onSelect();

        expect(focusEntry).toHaveBeenCalledWith({ kind: 'line', key });
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

    it('removes that line and hands focus to the next row’s glyph', () => {
        const dispatch = vi.fn<IngredientRowEditor['dispatch']>();
        const { rows, focus, values } = rowsOf({ lines: three, editor: { dispatch } });

        rows[1]?.onRemove();

        expect(dispatch).toHaveBeenCalledWith({ kind: 'removeIngredient', key: keyOf(values.ingredients[1]) });
        expect(focus.request).toHaveBeenCalledWith(keyOf(values.ingredients[2]), 'glyph');
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

    it('the ⋮ menu’s Remove ingredient does the same as the direct one', () => {
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
            expect(focus.requestAfterGlyphPanel).toHaveBeenCalledWith({ key, control: 'name' });
            expect(close).toHaveBeenCalledOnce();
        },
    );
});

describe('ingredientRowViewOf — the notes the line itself carries (U25, U28)', () => {
    it('U28: a row with no food says so before any submit, and marks its name invalid', () => {
        const { row } = onlyRow({ lines: [nameless()] });

        expect(row.noFoodNote).toBe(m.ingredientNoFoodNote);
        expect(row.nameInvalid).toBe(true);
        expect(row.describedBy.name).toContain(ingredientNoFoodNoteId(0));
        expect(row.entryField.invalid).toBe(true);
        expect(row.entryField.describedBy).toContain(ingredientNoFoodNoteId(0));
    });

    it('U28: a row bound to a food carries no such note', () => {
        const { row } = onlyRow({ lines: [bound()] });

        expect(row.noFoodNote).toBeUndefined();
        expect(row.nameInvalid).toBe(false);
        expect(row.entryField.invalid).toBe(false);
    });

    it('U25: a unit the vocabulary does not know is accepted, noted as text that describes the field', () => {
        const { row } = onlyRow({ lines: [bound({ unit: 'blorp' })] });

        expect(row.unitNote).toEqual(expect.any(String));
        expect(row.unitCanonical).toBe(false);
        expect(row.describedBy.unit).toBe(ingredientUnitNoteId(0));
    });

    it('U25: a canonical unit has no note; a subjective one is told apart from canonical', () => {
        const { rows } = rowsOf({ lines: [bound({ unit: 'cup' }), bound({ unit: 'handful' })] });
        const [cup, handful] = rows;

        expect(cup?.unitNote).toBeUndefined();
        expect(cup?.unitCanonical).toBe(true);
        expect(cup?.describedBy.unit).toBeUndefined();
        expect(handful?.unitCanonical).toBe(false);
    });
});

describe('ingredientRowViewOf — what a refusal and a pick say on the row (R7, item 1, item 4)', () => {
    it('R7: after a refused save, a pending row-2 field says its trimmed text and is invalid', () => {
        const { row } = onlyRow({
            lines: [nameless()],
            entry: { isPending: () => true, textOf: () => '  smoked flour ' },
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
    it('asks the retry for the row’s binding, and the glyph is busy while it runs', () => {
        const { row, retry, values } = onlyRow({
            lines: [bound({ resolutionStatus: FoodResolutionStatus.FAILED })],
            retrying: new Set(['ing_brisket']),
        });

        row.onRetryLookup();

        expect(retry).toHaveBeenCalledWith('ing_brisket', keyOf(values.ingredients[0]));
        expect(row.retrying).toBe(true);
        expect(row.glyphBusy).toBe(true);
    });
});

describe('ingredientRowViewOf — the row’s field edits', () => {
    it('each edit changes that line’s own field and nothing else (U26, U27)', () => {
        const { rows, onChange, values } = rowsOf({ lines: [bound({ name: 'flour' }), bound({ name: 'sugar' })] });
        const second = rows[1];

        second?.edit.unit('cup');
        second?.edit.preparation('sifted');
        second?.edit.groupLabel('For the crust');
        second?.edit.quantityLow('3');

        const [unit, preparation, group, quantity] = onChange.mock.calls.map(([next]) => next.ingredients);

        expect(unit?.[1]).toEqual({ ...values.ingredients[1], unit: 'cup' });
        expect(preparation?.[1]).toEqual({ ...values.ingredients[1], preparation: 'sifted' });
        expect(group?.[1]).toEqual({ ...values.ingredients[1], groupLabel: 'For the crust' });
        expect(quantity?.[1]?.quantity).toBe(3);

        for (const next of [unit, preparation, group, quantity]) {
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

describe('ingredientRowViewOf — each field edit is one draft transition', () => {
    it.each([
        ['quantityLow', '2.5', { kind: 'setIngredientQuantityLow', index: 1, value: 2.5 }],
        ['quantityHigh', '', { kind: 'setIngredientQuantityHigh', index: 1, value: undefined }],
        ['unit', 'tbsp', { kind: 'updateIngredientAt', index: 1, patch: { unit: 'tbsp' } }],
        ['preparation', 'sliced', { kind: 'updateIngredientAt', index: 1, patch: { preparation: 'sliced' } }],
        ['groupLabel', 'Sauce', { kind: 'updateIngredientAt', index: 1, patch: { groupLabel: 'Sauce' } }],
    ] as const)('the %s field edits its own line', (field, text, action) => {
        const { rows, onChange, values } = rowsOf({ lines: [bound({ name: 'flour' }), bound({ name: 'sugar' })] });

        rows[1]?.edit[field](text);

        expect(onChange).toHaveBeenCalledExactlyOnceWith(applyDraftAction(values, action));
    });
});
