// @vitest-environment jsdom
/**
 * Component tests for the NATIVE Ingredients section body (build spec §7.5), rendered via react-native-web under
 * jsdom: the one-for-one mirror of `RecipeIngredientsFields.test.tsx`, whose doc says what each block holds and where
 * the previous suite's coverage went. The two leaves are separate files with no compiler edge between them, which is
 * why §14 asks the same assertions of both.
 *
 * REWRITTEN for the UI overhaul's read rows, as the web suite was. Native's own cases: the row editor is a sheet on a
 * phone and inline on a tablet (§7.12, by the window's content width), the amount field keeps the text the cook is
 * typing ("1." on the way to "1.5") rather than the number it parses to, and Android back leaves a row's food search.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dialogTitled, queryDialogTitled } from '@commise/test-utils';
import { cleanup, render as renderBare, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useState, type FC, type ReactElement, type ReactNode } from 'react';
import { BackInterceptProvider } from '@commise/ui/back-intercept';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { ContainerClass } from '@commise/ui/container-class';
import { AccessibilityInfo } from 'react-native';

const layout = vi.hoisted(() => ({ container: 'narrow' as ContainerClass }));

vi.mock('../../layout/useMainContainerClass.native.js', () => ({ useMainContainerClass: () => layout.container }));
// Rows 6 and 7's panel searches the line's words through the progressive food search. This suite pins the panel's frame,
// not that search, which `RecipeIngredientsFields.rowEditor.native` and `rowEditor.integration` own.
vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: () => ({
        read: { kind: 'asking', resumed: false, answer: { database: undefined, sources: [], complete: false } },
        refetch: () => undefined,
    }),
}));
// react-native-web does not implement `sendAccessibilityEvent`, which the sheets call to move the screen-reader cursor.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.native.js';
import type { RecipeFormErrors } from '../validate.js';
import { type RecipeFormIngredient, type RecipeFormValues, defaultRecipeFormValues } from '../values.js';
import { recipeFormMessages } from '../messages.js';
import { editorMessages } from '../../editor/messages.js';
import { recipeMessages } from '../../messages.js';
import {
    makeIngredientNutrition,
    makeLookupRetry,
    makeIngredientRowEditor,
    withLineKeys,
    type UnkeyedFormIngredient,
} from '../../__fixtures__/index.js';
import { useFakeRowEditor } from '../../__fixtures__/useFakeRowEditor.js';
import type { LookupRetry } from '../ingredientStatus.js';
import type { IngredientNutrition, LookupEntry } from '../nutritionLookup.js';
import type { DraftAction } from '../draftAction.js';
import { applyDraftAction } from '../props.js';
import type { IngredientsPasteView } from '../props.js';
import type { IngredientRowEditor } from '../../hooks/useIngredientRowEditor.js';

beforeEach(() => {
    layout.container = 'narrow';
});
afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

const en = recipeFormMessages.en;
const editor = editorMessages.en;
const standIns = recipeMessages.en.ingredientLineName;
const noop = (): void => undefined;
const FOUND: LookupEntry = {
    state: 'found',
    catalog: { caloriesPer100g: 364, proteinGPer100g: 10, carbsGPer100g: 76, fatGPer100g: 1 },
};
const NUTRITION = makeIngredientNutrition();
const LOOKUP_RETRY = makeLookupRetry();

const valuesWith = (ingredients: RecipeFormValues['ingredients']): RecipeFormValues => ({
    ...defaultRecipeFormValues(),
    ingredients,
});

const RICE: UnkeyedFormIngredient = {
    ingredientId: 'ing_1',
    foodId: 'food_rice',
    name: 'Arborio rice',
    quantity: 300,
    unit: 'g',
    isUserEntered: false,
    resolutionStatus: FoodResolutionStatus.RESOLVED,
};
const NO_FOOD: UnkeyedFormIngredient = { ingredientId: null, name: 'Kale', quantity: 1, isUserEntered: false };

interface LeafOverrides {
    readonly values?: RecipeFormValues;
    readonly errors?: RecipeFormErrors;
    readonly nutrition?: IngredientNutrition;
    readonly lookupRetry?: LookupRetry;
    readonly rowEditor?: IngredientRowEditor;
    readonly paste?: IngredientsPasteView;
}

const leafElement = (over: LeafOverrides = {}) => (
    <RecipeIngredientsFields
        values={over.values ?? valuesWith(withLineKeys([RICE]))}
        {...(over.errors === undefined ? {} : { errors: over.errors })}
        onChange={noop}
        nutrition={over.nutrition ?? NUTRITION}
        lookupRetry={over.lookupRetry ?? LOOKUP_RETRY}
        rowEditor={over.rowEditor ?? makeIngredientRowEditor()}
        {...(over.paste === undefined ? {} : { paste: over.paste })}
    />
);

/** A row's food search registers an Android back guard, which throws outside a provider, deliberately. */
const BackChain: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <BackInterceptProvider onUnhandled={() => false}>{children}</BackInterceptProvider>
);
const render = (ui: ReactElement) => renderBare(ui, { wrapper: BackChain });
const renderLeaf = (over: LeafOverrides = {}) => render(leafElement(over));

/** A stateful host: the draft feeds back, and the row editor's entry moves over the real pure model. */
const StatefulLeaf: FC<{
    readonly initial: readonly UnkeyedFormIngredient[];
    readonly seen?: RecipeFormValues[];
    readonly nutrition?: IngredientNutrition;
    readonly dispatched?: DraftAction[];
}> = ({ initial, seen, nutrition, dispatched }) => {
    const [values, setValues] = useState(() => valuesWith(withLineKeys(initial)));

    const change = (next: RecipeFormValues): void => {
        seen?.push(next);
        setValues(next);
    };

    const rowEditor = useFakeRowEditor(values.ingredients, {
        editor: {
            // The editor's own transition, applied to the draft as it is when it runs, as `useRecipeEditor` applies it.
            dispatch: (action) => {
                dispatched?.push(action);
                setValues((current) => {
                    const next = applyDraftAction(current, action);

                    seen?.push(next);

                    return next;
                });
            },
        },
    });

    return (
        <RecipeIngredientsFields
            values={values}
            onChange={change}
            nutrition={nutrition ?? NUTRITION}
            lookupRetry={LOOKUP_RETRY}
            rowEditor={rowEditor}
        />
    );
};

/**
 * No native list is named (N1, N3): the editor's section says "Ingredients" and a group's heading says its name. The
 * ungrouped list is the first; a group's list is the one in the same section as its heading.
 */
const ingredientList = (): HTMLElement => {
    const [list] = screen.getAllByRole('list');

    if (list === undefined) {
        throw new Error('no list');
    }

    return list;
};

const groupList = (label: string): HTMLElement => {
    let node: HTMLElement | null = screen.getByRole('heading', { name: label });

    while (node !== null && node.querySelector('[role="list"]') === null) {
        node = node.parentElement;
    }

    const list = node?.querySelector<HTMLElement>('[role="list"]');

    if (list === null || list === undefined) {
        throw new Error(`no list under ${label}`);
    }

    return list;
};

const rowItems = (list: HTMLElement = ingredientList()): HTMLElement[] => within(list).getAllByRole('listitem');

const press = (name: string | RegExp): void => {
    fireEvent.click(screen.getByRole('button', { name }));
};

const choose = (food: string, item: string): void => {
    press(`Actions for ${food}`);
    fireEvent.click(screen.getByRole('menuitem', { name: item }));
};

const menuNames = (): string[] => screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');

const type = (field: HTMLElement, value: string): void => {
    fireEvent.change(field, { target: { value } });
};

describe('RecipeIngredientsFields (native) — the states (§7.5.1, §7.9)', () => {
    it('EMPTY: says so, and offers the add field named "Add an ingredient"', () => {
        renderLeaf({ values: valuesWith([]) });

        expect(screen.getByText(en.noIngredients)).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();
        expect(screen.getByLabelText(editor.ingredients.addLabel)).toBeTruthy();
    });

    it('POPULATED: one list, unnamed (the section says "Ingredients", N1), one item per line, read amount first', () => {
        renderLeaf({
            values: valuesWith(
                withLineKeys([
                    { ...RICE, preparation: 'rinsed' },
                    { ...RICE, ingredientId: 'ing_2', name: 'Salt', quantity: Number.NaN, unit: '' },
                ]),
            ),
        });

        const [rice, salt] = rowItems();

        expect(within(rice!).getByRole('button', { name: 'Edit 300 g Arborio rice' }).textContent).toBe(
            '300 gArborio rice · rinsed',
        );
        expect(within(salt!).getByRole('button', { name: 'Edit Salt' }).textContent).toBe('Salt');
    });

    it('D21: a count of one reads in the singular, and the stored name stays plural', () => {
        renderLeaf({
            values: valuesWith(
                withLineKeys([
                    { ...RICE, name: 'onions', quantity: 1, unit: 'large', preparation: 'diced' },
                    { ...RICE, ingredientId: 'ing_2', name: 'onions', quantity: 2, unit: '' },
                ]),
            ),
        });

        const [one, two] = rowItems();

        expect(within(one!).getByRole('button', { name: 'Edit 1 large onion' }).textContent).toBe(
            '1 largeonion · diced',
        );
        expect(within(two!).getByRole('button', { name: 'Edit 2 onions' })).toBeTruthy();
    });

    it('a healthy row is QUIET: its open control and its ⋯, nothing else', () => {
        renderLeaf({ nutrition: makeIngredientNutrition({ lookup: () => FOUND }) });

        expect(
            within(rowItems()[0]!)
                .getAllByRole('button')
                .map((button) => button.getAttribute('aria-label')),
        ).toEqual(['Edit 300 g Arborio rice', 'Actions for Arborio rice']);
    });
});

describe('RecipeIngredientsFields (native) — every row state (§7.5.1)', () => {
    it.each([
        {
            state: 'UNRESOLVED',
            status: FoodResolutionStatus.UNRESOLVED,
            text: en.rowStateChooseMatch,
            panel: en.statusExplainUnresolved,
        },
        {
            state: 'AMBIGUOUS',
            status: FoodResolutionStatus.AMBIGUOUS,
            text: en.rowStateChooseMatch,
            panel: en.statusExplainAmbiguous,
        },
        {
            state: 'NEEDS_REVIEW',
            status: FoodResolutionStatus.NEEDS_REVIEW,
            text: en.statusNeedsReview,
            panel: en.statusExplainNeedsReview,
        },
        {
            state: 'NOT_FOUND',
            status: FoodResolutionStatus.NOT_FOUND,
            text: en.rowStateNoMatch,
            panel: en.statusExplainNotFound,
        },
        {
            state: 'FAILED',
            status: FoodResolutionStatus.FAILED,
            text: en.rowStateLookupFailed,
            panel: en.statusExplainFailed,
        },
        {
            state: 'FOOD_REMOVED',
            status: FoodResolutionStatus.FOOD_REMOVED,
            text: en.rowStateFoodRemoved,
            panel: en.statusExplainFoodRemoved,
        },
    ])('$state: an attention line, named for its food, opens the row’s panel in a sheet', ({ status, text, panel }) => {
        renderLeaf({ values: valuesWith(withLineKeys([{ ...RICE, resolutionStatus: status }])) });

        const trigger = screen.getByRole('button', { name: `${text}: Arborio rice` });

        expect(trigger.textContent).toContain(text);
        fireEvent.click(trigger);

        expect(dialogTitled('Arborio rice').textContent).toContain(panel);
    });

    it('PENDING: says "Looking it up…" in words, never as a control', () => {
        renderLeaf({ values: valuesWith(withLineKeys([{ ...RICE, resolutionStatus: FoodResolutionStatus.PENDING }])) });

        expect(screen.getByText(en.rowStateLookingUp)).toBeTruthy();
        expect(screen.queryByRole('button', { name: new RegExp(en.rowStateLookingUp, 'u') })).toBeNull();
    });

    it.each([
        { state: 'RESOLVED', line: RICE, lookup: FOUND, title: 'Arborio rice', actions: 'Arborio rice', panel: '364' },
        {
            state: 'a private food (a stand-in)',
            line: {
                ingredientId: 'ing_9',
                quantity: 2,
                unit: 'tbsp',
                isUserEntered: false,
                resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE,
            },
            lookup: undefined,
            title: standIns.privateFood,
            actions: `2 tbsp ${standIns.privateFood}`,
            panel: en.nutritionNoneUnavailable,
        },
    ])('$state: quiet; ⋯ Food details opens its panel in a sheet', ({ line, lookup, title, actions, panel }) => {
        renderLeaf({
            values: valuesWith(withLineKeys([line])),
            ...(lookup === undefined ? {} : { nutrition: makeIngredientNutrition({ lookup: () => lookup }) }),
        });

        choose(actions, en.rowFoodDetails);

        expect(dialogTitled(title).textContent).toContain(panel);
    });

    it('a line with no food: "No match found" opens the row’s food search on its own words', () => {
        render(<StatefulLeaf initial={[NO_FOOD]} />);

        press(`${en.rowStateNoMatch}: Kale`);

        expect((screen.getByLabelText('Ingredient 1 name') as HTMLInputElement).value).toBe('Kale');
    });

    it('a refused quantity pair says so under the row', () => {
        renderLeaf({
            values: valuesWith(withLineKeys([{ ...RICE, quantity: 2, quantityHigh: 1e8 }])),
            errors: { ingredients: 'ingredientsQuantityInvalid' },
        });

        expect(within(rowItems()[0]!).getByText(en.rowAmountInvalid)).toBeTruthy();
    });
});

describe('RecipeIngredientsFields (native) — the ⋯ (§7.5.1)', () => {
    const THREE = [
        { ...RICE, name: 'Flour', ingredientId: 'a' },
        { ...RICE, name: 'Sugar', ingredientId: 'b' },
        { ...RICE, name: 'Salt', ingredientId: 'c' },
    ];

    it('holds Edit · Food details · Change food · Move up · Move down, then Remove', () => {
        renderLeaf({
            values: valuesWith(withLineKeys(THREE)),
            nutrition: makeIngredientNutrition({ lookup: () => FOUND }),
        });

        press('Actions for Sugar');

        expect(menuNames()).toEqual([
            en.rowEdit,
            en.rowFoodDetails,
            en.statusActionChangeFood,
            en.rowMoveUp,
            en.rowMoveDown,
            en.statusActionRemove,
        ]);
    });

    it('Move up moves the line', () => {
        render(<StatefulLeaf initial={THREE} />);

        choose('Salt', en.rowMoveUp);

        expect(rowItems().map((row) => within(row).getAllByRole('button')[0]?.getAttribute('aria-label'))).toEqual([
            'Edit 300 g Flour',
            'Edit 300 g Salt',
            'Edit 300 g Sugar',
        ]);
    });

    it('Remove removes ONLY that line', () => {
        const dispatched: DraftAction[] = [];
        render(<StatefulLeaf initial={THREE} dispatched={dispatched} />);

        choose('Flour', en.statusActionRemove);

        expect(dispatched).toEqual([{ kind: 'removeIngredient', key: expect.any(String) }]);
        expect(rowItems()).toHaveLength(2);
    });

    it('Remove raises a focus request, and the next row’s open control takes it once (useFocusRequest)', () => {
        const send = vi.mocked(AccessibilityInfo.sendAccessibilityEvent);
        render(<StatefulLeaf initial={THREE} />);
        send.mockClear();

        choose('Flour', en.statusActionRemove);

        const taken = send.mock.calls.filter(([, event]) => event === 'focus').map(([node]) => node as unknown as Node);
        const target = screen.getByRole('button', { name: 'Edit 300 g Sugar' });

        expect(taken.length).toBeGreaterThanOrEqual(1);
        expect(taken.some((node) => node === target || node.contains(target))).toBe(true);
    });
});

describe('RecipeIngredientsFields (native) — the row editor on a phone: a sheet (§7.5.2, §7.12)', () => {
    it('the open control opens a sheet titled by the food, holding Amount, Unit and Preparation; Done closes it', () => {
        const seen: RecipeFormValues[] = [];
        render(<StatefulLeaf initial={[{ ...RICE, preparation: 'rinsed' }]} seen={seen} />);

        press('Edit 300 g Arborio rice');
        const sheet = dialogTitled('Arborio rice');

        expect((within(sheet).getByLabelText(en.rowAmountLabel) as HTMLInputElement).value).toBe('300');
        expect((within(sheet).getByLabelText(en.rowUnitLabel) as HTMLInputElement).value).toBe('g');
        expect((within(sheet).getByLabelText(en.rowPrepLabel) as HTMLInputElement).value).toBe('rinsed');

        type(within(sheet).getByLabelText(en.rowPrepLabel), 'washed');
        expect(seen.at(-1)?.ingredients[0]?.preparation).toBe('washed');

        fireEvent.click(within(sheet).getByRole('button', { name: en.rowDone }));
        expect(queryDialogTitled('Arborio rice')).toBeNull();
    });

    // F11 (`evaluateFinal.md`; `buildSpec.md` §5.1): the phone sheet's one primary fills it, and it has no Cancel.
    it('the line editor sheet’s Done fills the sheet and the sheet has no Cancel', () => {
        render(<StatefulLeaf initial={[RICE]} />);

        press('Edit 300 g Arborio rice');
        const sheet = dialogTitled('Arborio rice');

        expect(within(sheet).getByRole('button', { name: en.rowDone }).style.alignSelf).toBe('stretch');
        expect(within(sheet).queryByRole('button', { name: /cancel/i })).toBeNull();
    });

    /** 2026-10-09 review, High 3: "1/2" stored no amount and the field emptied when it lost focus. */
    it.each([
        { typed: '1/2', quantity: 0.5 },
        { typed: '½', quantity: 0.5 },
        { typed: '1,5', quantity: 1.5 },
    ])('the amount reads "$typed" as $quantity, and keeps the text after it loses focus', ({ typed, quantity }) => {
        const seen: RecipeFormValues[] = [];
        render(<StatefulLeaf initial={[RICE]} seen={seen} />);

        press('Edit 300 g Arborio rice');
        const amount = within(dialogTitled('Arborio rice')).getByLabelText(en.rowAmountLabel) as HTMLInputElement;

        type(amount, typed);
        fireEvent.blur(amount);

        expect(seen.at(-1)?.ingredients[0]?.quantity).toBe(quantity);
        expect(amount.value).toBe(typed);
        expect(amount.getAttribute('aria-invalid')).not.toBe('true');
    });

    it('an amount it cannot read stays in the field, marked invalid with its note; the draft keeps its amount', () => {
        const seen: RecipeFormValues[] = [];
        render(<StatefulLeaf initial={[RICE]} seen={seen} />);

        press('Edit 300 g Arborio rice');
        const sheet = dialogTitled('Arborio rice');
        const amount = within(sheet).getByLabelText(en.rowAmountLabel) as HTMLInputElement;

        type(amount, 'a few');
        fireEvent.blur(amount);

        expect(amount.value).toBe('a few');
        expect(amount.getAttribute('aria-invalid')).toBe('true');
        expect(within(sheet).getByText(en.rowAmountInvalid)).toBeTruthy();
        expect(seen.filter((next) => next.ingredients[0]?.quantity !== 300)).toEqual([]);
    });

    it('the amount keeps the text being typed, so "1." can become "1.5"', () => {
        const seen: RecipeFormValues[] = [];
        render(<StatefulLeaf initial={[RICE]} seen={seen} />);

        press('Edit 300 g Arborio rice');
        const amount = within(dialogTitled('Arborio rice')).getByLabelText(en.rowAmountLabel) as HTMLInputElement;

        type(amount, '1.');
        expect(amount.value).toBe('1.');
        expect(seen.at(-1)?.ingredients[0]?.quantity).toBe(1);

        type(amount, '1.5');
        expect(seen.at(-1)?.ingredients[0]?.quantity).toBe(1.5);
    });

    it('+ Add a range reveals a second field; Remove range clears it', () => {
        const seen: RecipeFormValues[] = [];
        render(<StatefulLeaf initial={[RICE]} seen={seen} />);

        press('Edit 300 g Arborio rice');
        const sheet = dialogTitled('Arborio rice');

        fireEvent.click(within(sheet).getByRole('button', { name: en.rowAddRange }));
        type(within(sheet).getByLabelText(en.rowAmountHighLabel), '400');
        expect(seen.at(-1)?.ingredients[0]?.quantityHigh).toBe(400);

        fireEvent.click(within(sheet).getByRole('button', { name: en.rowRemoveRange }));
        expect(seen.at(-1)?.ingredients[0]).not.toHaveProperty('quantityHigh');
        expect(within(sheet).queryByLabelText(en.rowAmountHighLabel)).toBeNull();
    });

    it('the Unit field suggests known units, and keeps whatever the cook writes', () => {
        const seen: RecipeFormValues[] = [];
        render(<StatefulLeaf initial={[{ ...RICE, unit: '' }]} seen={seen} />);

        press('Edit 300 Arborio rice');
        const unit = within(dialogTitled('Arborio rice')).getByLabelText(en.rowUnitLabel);

        fireEvent.focus(unit);
        type(unit, 'tabl');
        // Native's list is in flow under the field, and each choice is a button (`Combobox.native`).
        fireEvent.click(screen.getByRole('button', { name: 'tablespoon' }));
        expect(seen.at(-1)?.ingredients[0]?.unit).toBe('tablespoon');

        type(unit, 'handful');
        expect(seen.at(-1)?.ingredients[0]?.unit).toBe('handful');
    });

    it('Change closes the editor and opens the row’s food search', () => {
        render(<StatefulLeaf initial={[RICE]} />);

        press('Edit 300 g Arborio rice');
        fireEvent.click(within(dialogTitled('Arborio rice')).getByRole('button', { name: en.rowChange }));

        expect(queryDialogTitled('Arborio rice')).toBeNull();
        expect(screen.getByLabelText('Ingredient 1 name')).toBeTruthy();
    });

    it('Food details opens the food’s panel inside the editor', () => {
        render(<StatefulLeaf initial={[RICE]} nutrition={makeIngredientNutrition({ lookup: () => FOUND })} />);

        press('Edit 300 g Arborio rice');
        const sheet = dialogTitled('Arborio rice');
        const disclosure = within(sheet).getByRole('button', { name: en.rowFoodDetails });

        expect(within(sheet).getByText('Arborio rice · 364 cal per 100 g')).toBeTruthy();
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(disclosure);

        expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    });
});

describe('RecipeIngredientsFields (native) — the row editor on a tablet: inline (§7.12)', () => {
    beforeEach(() => {
        layout.container = 'regular';
    });

    it('opens under its row, one at a time, and Done closes it', () => {
        render(<StatefulLeaf initial={[RICE, { ...RICE, ingredientId: 'b', name: 'Salt' }]} />);

        press('Edit 300 g Arborio rice');
        expect(queryDialogTitled('Arborio rice')).toBeNull();
        expect(within(rowItems()[0]!).getByLabelText(en.rowAmountLabel)).toBeTruthy();

        press('Edit 300 g Salt');
        expect(screen.getAllByLabelText(en.rowAmountLabel)).toHaveLength(1);
        expect(within(rowItems()[1]!).getByLabelText(en.rowAmountLabel)).toBeTruthy();

        press(en.rowDone);
        expect(screen.queryByLabelText(en.rowAmountLabel)).toBeNull();
    });
});

describe('RecipeIngredientsFields (native) — groups (§7.5.5)', () => {
    const GROUPED: UnkeyedFormIngredient[] = [
        { ...RICE, ingredientId: 'a', name: 'Salt' },
        { ...RICE, ingredientId: 'b', name: 'Oil', groupLabel: 'Sauce' },
        { ...RICE, ingredientId: 'c', name: 'Garlic', groupLabel: 'Sauce' },
    ];

    it('an ungrouped recipe shows no group chrome beyond "+ Add a group"', () => {
        renderLeaf();

        expect(screen.queryByRole('heading')).toBeNull();
        expect(screen.getByRole('button', { name: en.groupAdd })).toBeTruthy();
    });

    it('a group is a level-3 heading with its own ⋯ and its own list', () => {
        renderLeaf({ values: valuesWith(withLineKeys(GROUPED)) });

        expect(screen.getByRole('heading', { name: 'Sauce' }).getAttribute('aria-level')).toBe('3');
        expect(rowItems(groupList('Sauce'))).toHaveLength(2);

        press('Actions for Sauce');
        expect(menuNames()).toEqual([en.groupRename, en.groupAddIngredient, en.groupRemove]);
    });

    it('the add field sits under the last group, named for it; the other group offers to take it', () => {
        renderLeaf({ values: valuesWith(withLineKeys(GROUPED)) });

        expect(screen.getByLabelText('Add to Sauce')).toBeTruthy();
        expect(screen.getByRole('button', { name: editor.ingredients.addLabel })).toBeTruthy();
    });

    it('Rename group renames every line of it', () => {
        render(<StatefulLeaf initial={GROUPED} />);

        choose('Sauce', en.groupRename);
        type(screen.getByLabelText(en.groupNameLabel), 'Dressing');
        press(en.groupNameSave);

        expect(screen.getByRole('heading', { name: 'Dressing' })).toBeTruthy();
        expect(rowItems(groupList('Dressing'))).toHaveLength(2);
    });

    it('Remove group keeps its ingredients', () => {
        render(<StatefulLeaf initial={GROUPED} />);

        choose('Sauce', en.groupRemove);

        expect(screen.queryByRole('heading')).toBeNull();
        expect(rowItems()).toHaveLength(3);
    });

    it('+ Add a group asks for a name, and the new group holds the add field', () => {
        render(<StatefulLeaf initial={[RICE]} />);

        press(en.groupAdd);
        type(screen.getByLabelText(en.groupNameLabel), 'Garnish');
        press(en.groupNameSave);

        expect(screen.getByRole('heading', { name: 'Garnish' })).toBeTruthy();
        expect(screen.getByLabelText('Add to Garnish')).toBeTruthy();
    });

    it('⋯ Move to group… lists the groups and No group, and a choice moves the line', () => {
        render(<StatefulLeaf initial={GROUPED} />);

        choose('Salt', en.rowMoveToGroup);
        const sheet = dialogTitled(en.moveToGroupTitle);

        expect(within(sheet).getByRole('button', { name: en.moveToGroupNone }).getAttribute('aria-selected')).toBe(
            'true',
        );
        fireEvent.click(within(sheet).getByRole('button', { name: 'Sauce' }));

        expect(queryDialogTitled(en.moveToGroupTitle)).toBeNull();
        expect(rowItems(groupList('Sauce'))).toHaveLength(3);
    });
});

describe('RecipeIngredientsFields (native) — the running total (§7.5.6)', () => {
    it('reads calories per serving and how many counted', () => {
        renderLeaf({ nutrition: makeIngredientNutrition({ lookup: () => FOUND }) });

        expect(screen.getByText(/cal per serving · 1 of 1 counted/u)).toBeTruthy();
    });

    it('⛔ with no line counted it never says "0 cal"', () => {
        renderLeaf({ nutrition: makeIngredientNutrition({ lookup: () => ({ state: 'absent' }) }) });

        expect(screen.getByText(en.nutritionEmpty)).toBeTruthy();
        expect(screen.queryByText(/\b0 cal/u)).toBeNull();
    });

    it('LOADING is a still placeholder named as loading, with no figure', () => {
        renderLeaf({ nutrition: makeIngredientNutrition({ read: 'loading' }) });

        expect(screen.getByLabelText(en.nutritionLoading)).toBeTruthy();
        expect(screen.queryByText(/cal per serving/u)).toBeNull();
    });

    it('FAILED says so and offers Try again, which reads again', () => {
        const retry = vi.fn();
        renderLeaf({ nutrition: makeIngredientNutrition({ read: 'failed', retry }) });

        expect(screen.getByText(en.nutritionLoadFailed)).toBeTruthy();
        press(en.statusActionRetry);

        expect(retry).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeIngredientsFields (native) — ⛔ no control can create an unresolved row (U28)', () => {
    it('survives pressing every button and typing into every field, the row editor’s included', () => {
        layout.container = 'regular';
        const seen: RecipeFormValues[] = [];
        const initial: UnkeyedFormIngredient[] = [
            { ...RICE, name: 'Flour', groupLabel: 'Dry' },
            { ...RICE, ingredientId: 'ing_2', name: 'Water', quantity: 1, unit: 'cup' },
        ];
        render(<StatefulLeaf initial={initial} seen={seen} />);

        const invariant = (step: string): void => {
            const unresolved = (seen.at(-1)?.ingredients ?? []).filter(
                (line: RecipeFormIngredient) => line.ingredientId === null || line.ingredientId === '',
            );

            expect(`${step}: ${unresolved.length}`).toBe(`${step}: 0`);
        };

        for (const open of screen.getAllByRole('button', { name: /^Edit / })) {
            fireEvent.click(open);

            for (const input of screen.getAllByRole('textbox')) {
                type(input, '7');
                invariant(`typing into ${input.getAttribute('aria-label') ?? ''}`);
            }
        }

        for (const button of screen.getAllByRole('button')) {
            if (button.isConnected) {
                fireEvent.click(button);
                invariant(`pressing ${button.getAttribute('aria-label') ?? button.textContent ?? ''}`);
            }
        }

        for (const values of seen) {
            expect(values.ingredients.length).toBeLessThanOrEqual(initial.length);
        }

        expect(seen.length).toBeGreaterThan(0);
    });
});

describe('RecipeIngredientsFields (native) — pasted lines (§7.5.1 "Reading", §7.5.4)', () => {
    const PASTE: IngredientsPasteView = {
        reading: [
            { key: 'j:0', sourceLine: '2 cups flour', state: 'reading' },
            { key: 'j:1', sourceLine: '1 tsp salt', state: 'failed' },
        ],
        onRetry: noop,
        added: undefined,
        onOpen: undefined,
    };

    it('each line not in the recipe yet reads as a row with its state', () => {
        renderLeaf({ values: valuesWith([]), paste: PASTE });

        expect(screen.getByText('2 cups flour')).toBeTruthy();
        expect(screen.getByText(en.rowStateReading)).toBeTruthy();
        expect(screen.queryByText(en.noIngredients)).toBeNull();
    });

    it('a line waiting for a connection says it finishes once the device is back online (finding 11)', () => {
        renderLeaf({
            values: valuesWith([]),
            paste: { ...PASTE, reading: [{ key: 'j:0', sourceLine: '2 cups flour', state: 'waiting' }] },
        });

        expect(screen.getByText(en.rowStateWaitingForConnection)).toBeTruthy();
        expect(screen.queryByText(en.rowStateReading)).toBeNull();
    });

    it('the empty section offers Paste a list; a section with lines does not', () => {
        const onOpen = vi.fn();
        const { rerender } = render(leafElement({ values: valuesWith([]), paste: { ...PASTE, reading: [], onOpen } }));

        press(editor.ingredients.pasteList);
        expect(onOpen).toHaveBeenCalledTimes(1);

        rerender(leafElement({ paste: { ...PASTE, reading: [], onOpen } }));
        expect(screen.queryByRole('button', { name: editor.ingredients.pasteList })).toBeNull();
    });
});
