// @vitest-environment jsdom
/**
 * Component tests for the WEB Ingredients section body (build spec §7.5): quiet read rows and their `⋯` (§7.5.1), the
 * row editor as a sheet below a 600 container and inline from 600 (§7.5.2), the add field (§7.5.3), Paste a list in the
 * empty section (§7.5.4), the groups (§7.5.5) and the running total (§7.5.6).
 *
 * REWRITTEN for the UI overhaul's read rows. The previous suite pinned the row as a strip of inline fields with a state
 * glyph on every row, a direct Remove and a group field; those are gone by design. Where its coverage went:
 *  - per-state glyph, status word and tint cases → the fixture table below (second line, then the panel through the
 *    attention line or Food details), and `rowSecondLine.test.ts` / `ingredientRowView.test.ts` for the rules;
 *  - "Remove is direct" and the field-width (W-1) classes → deleted (Remove is a `⋯` item, `rowMenu.test.ts`; the fields
 *    moved into the row editor, sized here);
 *  - the name as a read-only group → the open control "Edit {amount} {food}".
 *
 * ⛔ U28's control sweep is kept: whatever a cook can press or type here, no line may lose its food and the list may
 * never grow. It is STATEFUL, so what a test types comes back as new `values`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { RecipeIngredientsFields } from '../RecipeIngredientsFields.js';
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
import { type IngredientsPasteView } from '../props.js';
import type { IngredientRowEditor } from '../../hooks/useIngredientRowEditor.js';
import type { ContainerClass } from '@commise/ui/container-class';

const layout = vi.hoisted(() => ({ container: 'narrow' as ContainerClass }));

vi.mock('../../layout/useMainContainerClass.js', () => ({ useMainContainerClass: () => layout.container }));
// Rows 6 and 7's panel searches the line's words through the progressive food search. This suite pins the panel's frame,
// not that search, which `RecipeIngredientsFields.rowEditor` and `rowEditor.integration` own.
vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: () => ({
        read: { kind: 'asking', resumed: false, answer: { database: undefined, sources: [], complete: false } },
        refetch: () => undefined,
    }),
}));

beforeEach(() => {
    layout.container = 'narrow';
});
afterEach(cleanup);

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
    readonly onChange?: (next: RecipeFormValues) => void;
    readonly nutrition?: IngredientNutrition;
    readonly lookupRetry?: LookupRetry;
    readonly rowEditor?: IngredientRowEditor;
    readonly paste?: IngredientsPasteView;
}

const leafElement = (over: LeafOverrides = {}) => (
    <RecipeIngredientsFields
        values={over.values ?? valuesWith(withLineKeys([RICE]))}
        {...(over.errors === undefined ? {} : { errors: over.errors })}
        onChange={over.onChange ?? noop}
        nutrition={over.nutrition ?? NUTRITION}
        lookupRetry={over.lookupRetry ?? LOOKUP_RETRY}
        rowEditor={over.rowEditor ?? makeIngredientRowEditor()}
        {...(over.paste === undefined ? {} : { paste: over.paste })}
    />
);

const renderLeaf = (over: LeafOverrides = {}) => render(leafElement(over));

/**
 * A stateful host: the draft feeds back, the row editor's entry moves over the real pure model, and its `dispatch`
 * applies the draft transitions it is handed (a Remove).
 */
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
            dispatch: (action) => {
                dispatched?.push(action);

                if (action.kind === 'removeIngredient') {
                    change({ ...values, ingredients: values.ingredients.filter((line) => line.key !== action.key) });
                }
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

const ingredientList = (): HTMLElement => screen.getByRole('list', { name: editor.index.sections.ingredients });
const rowItems = (list: HTMLElement = ingredientList()): HTMLElement[] => within(list).getAllByRole('listitem');

const openMenu = async (user: ReturnType<typeof userEvent.setup>, food: string): Promise<HTMLElement> => {
    await user.click(screen.getByRole('button', { name: `Actions for ${food}` }));

    return screen.getByRole('menu');
};

const itemNames = (menu: HTMLElement): string[] =>
    within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent ?? '');

describe('RecipeIngredientsFields (web) — the states (§7.5.1, §7.9)', () => {
    it('EMPTY: says so, and offers the add field named "Add an ingredient" with its hint', () => {
        renderLeaf({ values: valuesWith([]) });

        expect(screen.getByText(en.noIngredients)).toBeTruthy();
        expect(screen.queryByRole('list', { name: editor.index.sections.ingredients })).toBeNull();
        expect(screen.getByRole('combobox', { name: editor.ingredients.addLabel })).toBeTruthy();
    });

    it('POPULATED: one list named "Ingredients", one item per line, each read amount first', () => {
        renderLeaf({
            values: valuesWith(
                withLineKeys([
                    { ...RICE, preparation: 'rinsed' },
                    {
                        ...RICE,
                        ingredientId: 'ing_2',
                        foodId: 'food_salt',
                        name: 'Salt',
                        quantity: Number.NaN,
                        unit: '',
                    },
                ]),
            ),
        });

        const [rice, salt] = rowItems();

        expect(within(rice!).getByRole('button', { name: 'Edit 300 g Arborio rice' }).textContent).toBe(
            '300 gArborio rice · rinsed',
        );
        // No amount: the column is empty, never an invented "1" (F5).
        expect(within(salt!).getByRole('button', { name: 'Edit Salt' }).textContent).toBe('Salt');
    });

    it('a healthy row is QUIET: no glyph, no status word, no second line', () => {
        renderLeaf({ nutrition: makeIngredientNutrition({ lookup: () => FOUND }) });

        const [row] = rowItems();

        expect(
            within(row!)
                .getAllByRole('button')
                .map((button) => button.getAttribute('aria-label')),
        ).toEqual(['Edit 300 g Arborio rice', 'Actions for Arborio rice']);
        expect(screen.queryByText(en.statusResolved)).toBeNull();
    });
});

describe('RecipeIngredientsFields (web) — every row state (§7.5.1, panels per ingredientStatusExplanation SPECIFY.1)', () => {
    const attention = [
        {
            state: 'UNRESOLVED',
            line: { ...RICE, resolutionStatus: FoodResolutionStatus.UNRESOLVED },
            text: en.rowStateChooseMatch,
            panel: en.statusExplainUnresolved,
        },
        {
            state: 'AMBIGUOUS',
            line: { ...RICE, resolutionStatus: FoodResolutionStatus.AMBIGUOUS },
            text: en.rowStateChooseMatch,
            panel: en.statusExplainAmbiguous,
        },
        {
            state: 'NEEDS_REVIEW',
            line: { ...RICE, resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW },
            text: en.statusNeedsReview,
            panel: en.statusExplainNeedsReview,
        },
        {
            state: 'NOT_FOUND',
            line: { ...RICE, resolutionStatus: FoodResolutionStatus.NOT_FOUND, unresolvedReason: 'no_source_has_it' },
            text: en.rowStateNoMatch,
            panel: en.statusExplainNotFound,
        },
        {
            state: 'FAILED',
            line: { ...RICE, resolutionStatus: FoodResolutionStatus.FAILED, unresolvedReason: 'sources_errored' },
            text: en.rowStateLookupFailed,
            panel: en.statusExplainFailed,
        },
        {
            state: 'FOOD_REMOVED',
            line: { ...RICE, resolutionStatus: FoodResolutionStatus.FOOD_REMOVED },
            text: en.rowStateFoodRemoved,
            panel: en.statusExplainFoodRemoved,
        },
    ] as const;

    it.each(attention)(
        '$state: an attention line, named for its food, opens the row’s panel; Escape returns focus to it',
        async ({ line, text, panel }) => {
            const user = userEvent.setup();
            renderLeaf({ values: valuesWith(withLineKeys([line])) });

            const trigger = screen.getByRole('button', { name: `${text}: Arborio rice` });

            expect(trigger.textContent).toBe(text);

            await user.click(trigger);
            expect(screen.getByRole('dialog', { name: 'Arborio rice' }).textContent).toContain(panel);

            await user.keyboard('{Escape}');
            expect(document.activeElement).toBe(trigger);
        },
    );

    it.each([
        { state: 'PENDING', status: FoodResolutionStatus.PENDING },
        { state: 'PENDING_VERIFICATION', status: FoodResolutionStatus.PENDING_VERIFICATION },
    ])('$state: says "Looking it up…" in words, never as a control', ({ status }) => {
        renderLeaf({ values: valuesWith(withLineKeys([{ ...RICE, resolutionStatus: status }])) });

        expect(screen.getByText(en.rowStateLookingUp)).toBeTruthy();
        expect(screen.queryByRole('button', { name: new RegExp(en.rowStateLookingUp) })).toBeNull();
    });

    const quiet = [
        {
            state: 'RESOLVED: the nutrition panel per 100 g',
            line: RICE,
            lookup: FOUND,
            title: 'Arborio rice',
            actions: 'Actions for Arborio rice',
            panel: '364',
        },
        {
            state: 'own wording',
            line: { ...RICE, isUserEntered: true, resolutionStatus: undefined },
            lookup: undefined,
            title: 'Arborio rice',
            actions: 'Actions for Arborio rice',
            panel: en.nutritionNoneAvailable,
        },
        {
            state: 'someone else’s private food (a stand-in)',
            line: {
                ingredientId: 'ing_9',
                quantity: 2,
                unit: 'tbsp',
                isUserEntered: false,
                resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE,
            },
            lookup: undefined,
            title: standIns.privateFood,
            actions: `Actions for 2 tbsp ${standIns.privateFood}`,
            panel: en.nutritionNoneUnavailable,
        },
        {
            state: 'food not loaded just now (a stand-in)',
            line: {
                ingredientId: 'ing_9',
                quantity: 2,
                unit: 'tbsp',
                isUserEntered: false,
                resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE,
            },
            lookup: undefined,
            title: standIns.notLoaded,
            actions: `Actions for 2 tbsp ${standIns.notLoaded}`,
            panel: en.statusExplainFoodUnreachable,
        },
    ] as const;

    it.each(quiet)(
        '$state: quiet; ⋯ Food details opens its panel in a sheet',
        async ({ line, lookup, title, actions, panel }) => {
            const user = userEvent.setup();
            renderLeaf({
                values: valuesWith(withLineKeys([line])),
                ...(lookup === undefined ? {} : { nutrition: makeIngredientNutrition({ lookup: () => lookup }) }),
            });

            expect(screen.queryByRole('button', { name: /: / })).toBeNull();

            await user.click(screen.getByRole('button', { name: actions }));
            await user.click(screen.getByRole('menuitem', { name: en.rowFoodDetails }));

            expect((await screen.findByRole('dialog', { name: title })).textContent).toContain(panel);
        },
    );

    it('a line with no food: "No match found" opens the row’s food search on its own words', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={[NO_FOOD]} />);

        await user.click(screen.getByRole('button', { name: `${en.rowStateNoMatch}: Kale` }));

        const field = await screen.findByRole('combobox', { name: 'Ingredient 1 name' });

        expect((field as HTMLInputElement).value).toBe('Kale');
        expect(field.getAttribute('aria-describedby')).toContain('no-food-note');
    });

    it('a FAILED row’s Try again closes the panel and the row says it is looking it up while it runs', async () => {
        const user = userEvent.setup();
        const retry = vi.fn<LookupRetry['retry']>();
        const failed = { ...RICE, resolutionStatus: FoodResolutionStatus.FAILED };
        const { rerender } = render(
            leafElement({ values: valuesWith(withLineKeys([failed])), lookupRetry: makeLookupRetry({ retry }) }),
        );

        await user.click(screen.getByRole('button', { name: `${en.rowStateLookupFailed}: Arborio rice` }));
        await user.click(screen.getByRole('button', { name: 'Try again for Arborio rice' }));

        expect(retry).toHaveBeenCalledWith('ing_1', expect.any(String));
        expect(screen.queryByRole('dialog')).toBeNull();

        rerender(
            leafElement({
                values: valuesWith(withLineKeys([failed])),
                lookupRetry: makeLookupRetry({ retry, retrying: new Set(['ing_1']) }),
            }),
        );

        expect(screen.getByText(en.rowStateLookingUp)).toBeTruthy();
    });

    it('a refused quantity pair says so under the row', () => {
        renderLeaf({
            values: valuesWith(withLineKeys([{ ...RICE, quantity: 2, quantityHigh: 1e8 }])),
            errors: { ingredients: 'ingredientsQuantityInvalid' },
        });

        expect(within(rowItems()[0]!).getByText(en.rowAmountInvalid)).toBeTruthy();
    });
});

describe('RecipeIngredientsFields (web) — the ⋯ (§7.5.1)', () => {
    const THREE = [
        { ...RICE, name: 'Flour', ingredientId: 'a' },
        { ...RICE, name: 'Sugar', ingredientId: 'b' },
        { ...RICE, name: 'Salt', ingredientId: 'c' },
    ];

    it('holds Edit · Food details · Change food · Move up · Move down, then Remove after a divider', async () => {
        const user = userEvent.setup();
        renderLeaf({
            values: valuesWith(withLineKeys(THREE)),
            nutrition: makeIngredientNutrition({ lookup: () => FOUND }),
        });

        const menu = await openMenu(user, 'Sugar');

        expect(itemNames(menu)).toEqual([
            en.rowEdit,
            en.rowFoodDetails,
            en.statusActionChangeFood,
            en.rowMoveUp,
            en.rowMoveDown,
            en.statusActionRemove,
        ]);
    });

    it('Move up moves the line and focus stays on its ⋯', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={THREE} />);

        await openMenu(user, 'Salt');
        await user.click(screen.getByRole('menuitem', { name: en.rowMoveUp }));

        expect(rowItems().map((row) => within(row).getAllByRole('button')[0]?.getAttribute('aria-label'))).toEqual([
            'Edit 300 g Flour',
            'Edit 300 g Salt',
            'Edit 300 g Sugar',
        ]);
        await vi.waitFor(() =>
            expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actions for Salt' })),
        );
    });

    it('Remove removes ONLY that line, and focus moves to the next row’s open control', async () => {
        const user = userEvent.setup();
        const dispatched: DraftAction[] = [];
        render(<StatefulLeaf initial={THREE} dispatched={dispatched} />);

        await openMenu(user, 'Flour');
        await user.click(screen.getByRole('menuitem', { name: en.statusActionRemove }));

        expect(dispatched).toEqual([{ kind: 'removeIngredient', key: expect.any(String) }]);
        expect(rowItems()).toHaveLength(2);
        await vi.waitFor(() =>
            expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit 300 g Sugar' })),
        );
    });

    it('removing the last row hands focus to the add field', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={THREE} />);

        await openMenu(user, 'Salt');
        await user.click(screen.getByRole('menuitem', { name: en.statusActionRemove }));

        await vi.waitFor(() =>
            expect(document.activeElement).toBe(screen.getByRole('combobox', { name: editor.ingredients.addLabel })),
        );
    });
});

describe('RecipeIngredientsFields (web) — the row editor as a phone sheet (§7.5.2, below 600)', () => {
    it('the open control opens a sheet titled by the food, holding Amount, Unit and Preparation', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={[{ ...RICE, preparation: 'rinsed' }]} />);

        await user.click(screen.getByRole('button', { name: 'Edit 300 g Arborio rice' }));

        const sheet = screen.getByRole('dialog', { name: 'Arborio rice' });

        expect((within(sheet).getByLabelText(en.rowAmountLabel) as HTMLInputElement).value).toBe('300');
        expect((within(sheet).getByRole('combobox', { name: en.rowUnitLabel }) as HTMLInputElement).value).toBe('g');
        expect((within(sheet).getByLabelText(en.rowPrepLabel) as HTMLInputElement).value).toBe('rinsed');
        expect(within(sheet).queryByLabelText(/section|group/i)).toBeNull();
    });

    it('edits reach the draft, and Done closes the sheet and returns focus to the row', async () => {
        const user = userEvent.setup();
        const seen: RecipeFormValues[] = [];
        render(<StatefulLeaf initial={[RICE]} seen={seen} />);

        await user.click(screen.getByRole('button', { name: 'Edit 300 g Arborio rice' }));
        const sheet = screen.getByRole('dialog', { name: 'Arborio rice' });

        await user.clear(within(sheet).getByLabelText(en.rowAmountLabel));
        await user.type(within(sheet).getByLabelText(en.rowAmountLabel), '250');
        await user.type(within(sheet).getByLabelText(en.rowPrepLabel), 'rinsed');

        expect(seen.at(-1)?.ingredients[0]).toMatchObject({ quantity: 250, preparation: 'rinsed' });

        await user.click(within(sheet).getByRole('button', { name: en.rowDone }));

        await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await vi.waitFor(() =>
            expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit 250 g Arborio rice' })),
        );
    });

    it('+ Add a range reveals "to" and a second field; Remove range clears it', async () => {
        const user = userEvent.setup();
        const seen: RecipeFormValues[] = [];
        render(<StatefulLeaf initial={[RICE]} seen={seen} />);

        await user.click(screen.getByRole('button', { name: 'Edit 300 g Arborio rice' }));
        const sheet = screen.getByRole('dialog', { name: 'Arborio rice' });

        expect(within(sheet).queryByRole('spinbutton', { name: en.rowAmountHighLabel })).toBeNull();
        await user.click(within(sheet).getByRole('button', { name: en.rowAddRange }));
        await user.type(within(sheet).getByRole('spinbutton', { name: en.rowAmountHighLabel }), '400');

        expect(seen.at(-1)?.ingredients[0]?.quantityHigh).toBe(400);

        await user.click(within(sheet).getByRole('button', { name: en.rowRemoveRange }));

        expect(seen.at(-1)?.ingredients[0]).not.toHaveProperty('quantityHigh');
        expect(within(sheet).queryByRole('spinbutton', { name: en.rowAmountHighLabel })).toBeNull();
    });

    it('the Unit field suggests known units as the cook types, and keeps whatever they write', async () => {
        const user = userEvent.setup();
        const seen: RecipeFormValues[] = [];
        render(<StatefulLeaf initial={[{ ...RICE, unit: '' }]} seen={seen} />);

        await user.click(screen.getByRole('button', { name: 'Edit 300 Arborio rice' }));
        const unit = within(screen.getByRole('dialog', { name: 'Arborio rice' })).getByRole('combobox', {
            name: en.rowUnitLabel,
        });

        await user.type(unit, 'tabl');
        await user.click(await screen.findByRole('option', { name: 'tablespoon' }));

        expect(seen.at(-1)?.ingredients[0]?.unit).toBe('tablespoon');

        await user.clear(unit);
        await user.type(unit, 'handful');

        expect(seen.at(-1)?.ingredients[0]?.unit).toBe('handful');
    });

    it('Change closes the editor and opens the row’s food search', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={[RICE]} />);

        await user.click(screen.getByRole('button', { name: 'Edit 300 g Arborio rice' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.rowChange }));

        await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.getByRole('combobox', { name: 'Ingredient 1 name' })).toBeTruthy();
    });

    it('Food details opens the food’s panel inside the editor', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={[RICE]} nutrition={makeIngredientNutrition({ lookup: () => FOUND })} />);

        await user.click(screen.getByRole('button', { name: 'Edit 300 g Arborio rice' }));
        const sheet = screen.getByRole('dialog');
        const disclosure = within(sheet).getByRole('button', { name: en.rowFoodDetails });

        expect(within(sheet).getByText('Arborio rice · 364 cal per 100 g')).toBeTruthy();
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');

        await user.click(disclosure);

        expect(disclosure.getAttribute('aria-expanded')).toBe('true');
        expect(within(sheet).getAllByText(/364/u).length).toBeGreaterThan(1);
    });
});

describe('RecipeIngredientsFields (web) — the row editor inline (§7.5.2, from 600)', () => {
    beforeEach(() => {
        layout.container = 'regular';
    });

    it('opens under its row, in the same list item, and the open control says it is expanded', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={[RICE, { ...RICE, ingredientId: 'b', name: 'Salt' }]} />);

        const open = screen.getByRole('button', { name: 'Edit 300 g Arborio rice' });

        expect(open.getAttribute('aria-expanded')).toBe('false');
        await user.click(open);

        expect(open.getAttribute('aria-expanded')).toBe('true');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(within(rowItems()[0]!).getByLabelText(en.rowAmountLabel)).toBeTruthy();
    });

    it('one editor at a time: opening another closes the first', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={[RICE, { ...RICE, ingredientId: 'b', name: 'Salt' }]} />);

        await user.click(screen.getByRole('button', { name: 'Edit 300 g Arborio rice' }));
        await user.click(screen.getByRole('button', { name: 'Edit 300 g Salt' }));

        expect(screen.getAllByLabelText(en.rowAmountLabel)).toHaveLength(1);
        expect(within(rowItems()[1]!).getByLabelText(en.rowAmountLabel)).toBeTruthy();
    });

    it('Escape closes it and focus returns to the row', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={[RICE]} />);

        await user.click(screen.getByRole('button', { name: 'Edit 300 g Arborio rice' }));
        await user.click(screen.getByLabelText(en.rowPrepLabel));
        await user.keyboard('{Escape}');

        expect(screen.queryByLabelText(en.rowAmountLabel)).toBeNull();
        await vi.waitFor(() =>
            expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit 300 g Arborio rice' })),
        );
    });

    it('Escape in the Unit list closes the list first, and only the next Escape closes the editor', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={[{ ...RICE, unit: '' }]} />);

        await user.click(screen.getByRole('button', { name: 'Edit 300 Arborio rice' }));
        await user.type(screen.getByRole('combobox', { name: en.rowUnitLabel }), 'tabl');
        await screen.findByRole('option', { name: 'tablespoon' });

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('option', { name: 'tablespoon' })).toBeNull();
        expect(screen.getByLabelText(en.rowAmountLabel)).toBeTruthy();

        await user.keyboard('{Escape}');
        expect(screen.queryByLabelText(en.rowAmountLabel)).toBeNull();
    });

    it('Done is a secondary button here and closes it', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={[RICE]} />);

        await user.click(screen.getByRole('button', { name: 'Edit 300 g Arborio rice' }));
        await user.click(screen.getByRole('button', { name: en.rowDone }));

        expect(screen.queryByLabelText(en.rowAmountLabel)).toBeNull();
    });
});

describe('RecipeIngredientsFields (web) — groups (§7.5.5)', () => {
    const GROUPED: UnkeyedFormIngredient[] = [
        { ...RICE, ingredientId: 'a', name: 'Salt' },
        { ...RICE, ingredientId: 'b', name: 'Oil', groupLabel: 'Sauce' },
        { ...RICE, ingredientId: 'c', name: 'Garlic', groupLabel: 'Sauce' },
    ];

    it('an ungrouped recipe shows no group chrome beyond "+ Add a group"', () => {
        renderLeaf();

        expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
        expect(screen.getByRole('button', { name: en.groupAdd })).toBeTruthy();
    });

    it('a group is an H3 with its own ⋯ and its own list, named by its heading', async () => {
        const user = userEvent.setup();
        renderLeaf({ values: valuesWith(withLineKeys(GROUPED)) });

        expect(screen.getByRole('heading', { level: 3, name: 'Sauce' })).toBeTruthy();
        expect(rowItems(screen.getByRole('list', { name: 'Sauce' }))).toHaveLength(2);
        expect(rowItems()).toHaveLength(1);

        await user.click(screen.getByRole('button', { name: 'Actions for Sauce' }));

        expect(itemNames(screen.getByRole('menu'))).toEqual([en.groupRename, en.groupAddIngredient, en.groupRemove]);
    });

    it('the add field sits under the last group, named for it; the other group offers to take it', () => {
        renderLeaf({ values: valuesWith(withLineKeys(GROUPED)) });

        expect(screen.getByRole('combobox', { name: 'Add to Sauce' })).toBeTruthy();
        expect(screen.getByRole('button', { name: editor.ingredients.addLabel })).toBeTruthy();
    });

    it('Rename group renames every line of it', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={GROUPED} />);

        await user.click(screen.getByRole('button', { name: 'Actions for Sauce' }));
        await user.click(screen.getByRole('menuitem', { name: en.groupRename }));

        const name = await screen.findByRole('textbox', { name: en.groupNameLabel });

        await vi.waitFor(() => expect(document.activeElement).toBe(name));
        await user.clear(name);
        await user.type(name, 'Dressing{Enter}');

        expect(screen.getByRole('heading', { level: 3, name: 'Dressing' })).toBeTruthy();
        expect(rowItems(screen.getByRole('list', { name: 'Dressing' }))).toHaveLength(2);
    });

    it('Remove group keeps its ingredients', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={GROUPED} />);

        await user.click(screen.getByRole('button', { name: 'Actions for Sauce' }));
        await user.click(screen.getByRole('menuitem', { name: en.groupRemove }));

        expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
        expect(rowItems()).toHaveLength(3);
    });

    it('+ Add a group asks for a name, and the new group holds the add field', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={[RICE]} />);

        await user.click(screen.getByRole('button', { name: en.groupAdd }));
        const name = await screen.findByRole('textbox', { name: en.groupNameLabel });

        await vi.waitFor(() => expect(document.activeElement).toBe(name));
        await user.type(name, 'Garnish');
        await user.click(screen.getByRole('button', { name: en.groupNameSave }));

        expect(screen.getByRole('heading', { level: 3, name: 'Garnish' })).toBeTruthy();
        await vi.waitFor(() =>
            expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Add to Garnish' })),
        );
    });

    it('cancelling the name returns focus to + Add a group', async () => {
        const user = userEvent.setup();
        renderLeaf();

        await user.click(screen.getByRole('button', { name: en.groupAdd }));
        await user.click(await screen.findByRole('button', { name: en.groupNameCancel }));

        await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: en.groupAdd })));
    });

    it('⋯ Move to group… lists the groups and No group, and a choice moves the line', async () => {
        const user = userEvent.setup();
        render(<StatefulLeaf initial={GROUPED} />);

        await openMenu(user, 'Salt');
        await user.click(screen.getByRole('menuitem', { name: en.rowMoveToGroup }));

        const sheet = await screen.findByRole('dialog', { name: en.moveToGroupTitle });
        const choices = within(sheet)
            .getAllByRole('button')
            .filter((button) => button.textContent !== '');

        expect(choices.map((choice) => [choice.textContent, choice.getAttribute('aria-current')])).toEqual([
            ['Sauce', null],
            [en.moveToGroupNone, 'true'],
        ]);

        await user.click(within(sheet).getByRole('button', { name: 'Sauce' }));

        await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(rowItems(screen.getByRole('list', { name: 'Sauce' }))).toHaveLength(3);
    });
});

describe('RecipeIngredientsFields (web) — the running total (§7.5.6)', () => {
    it('reads the total from the same read as the panels: calories per serving and how many counted', () => {
        renderLeaf({ nutrition: makeIngredientNutrition({ lookup: () => FOUND }) });

        expect(screen.getByText(/cal per serving · 1 of 1 counted/u)).toBeTruthy();
    });

    it('⛔ with no line counted it never says "0 cal"', () => {
        renderLeaf({ nutrition: makeIngredientNutrition({ lookup: () => ({ state: 'absent' }) }) });

        expect(screen.getByText(en.nutritionEmpty)).toBeTruthy();
        expect(screen.queryByText(/\b0 cal/u)).toBeNull();
    });

    it('LOADING is skeleton text a screen reader hears as loading, with no figure', () => {
        renderLeaf({ nutrition: makeIngredientNutrition({ read: 'loading' }) });

        const status = screen.getAllByRole('status').find((region) => region.textContent === en.nutritionLoading);

        expect(status).toBeDefined();
        expect(status?.querySelector('[aria-hidden="true"]')?.className).toContain('motion-safe:animate-pulse');
        expect(screen.queryByText(/cal per serving/u)).toBeNull();
    });

    it('FAILED says so and offers Try again, which reads again', async () => {
        const user = userEvent.setup();
        const retry = vi.fn();
        renderLeaf({ nutrition: makeIngredientNutrition({ read: 'failed', retry }) });

        expect(screen.getByText(en.nutritionLoadFailed)).toBeTruthy();
        await user.click(screen.getByRole('button', { name: en.statusActionRetry }));

        expect(retry).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeIngredientsFields (web) — ⛔ no control can create an unresolved row (U28)', () => {
    it('survives pressing every button and typing into every field, the row editor’s included', async () => {
        layout.container = 'regular';
        const user = userEvent.setup();
        const seen: RecipeFormValues[] = [];
        const initial: UnkeyedFormIngredient[] = [
            { ...RICE, name: 'Flour', groupLabel: 'Dry' },
            { ...RICE, ingredientId: 'ing_2', name: 'Water', quantity: 1, unit: 'cup' },
        ];
        render(<StatefulLeaf initial={initial} seen={seen} />);

        const invariant = (step: string): void => {
            const values = seen.at(-1);
            const unresolved = (values?.ingredients ?? []).filter(
                (line: RecipeFormIngredient) => line.ingredientId === null || line.ingredientId === '',
            );

            expect(`${step}: ${unresolved.length}`).toBe(`${step}: 0`);
        };

        // Open each row's editor so its fields are part of the surface swept.
        for (const open of screen.getAllByRole('button', { name: /^Edit / })) {
            await user.click(open);

            for (const input of [...screen.getAllByRole('textbox'), ...screen.getAllByRole('spinbutton')]) {
                await user.click(input);
                await user.paste('7');
                invariant(`typing into ${input.getAttribute('aria-label') ?? input.id}`);
            }
        }

        for (const button of screen.getAllByRole('button')) {
            if (!button.isConnected) {
                continue;
            }

            await user.click(button);
            invariant(`pressing ${button.getAttribute('aria-label') ?? button.textContent ?? ''}`);
            await user.keyboard('{Escape}');
        }

        for (const values of seen) {
            expect(values.ingredients.length).toBeLessThanOrEqual(initial.length);
        }

        expect(seen.length).toBeGreaterThan(0);
    });
});

describe('RecipeIngredientsFields (web) — pasted lines (build spec §7.5.1 "Reading", §7.5.4)', () => {
    const PASTE: IngredientsPasteView = {
        reading: [
            { key: 'j:0', sourceLine: '2 cups flour', failed: false },
            { key: 'j:1', sourceLine: '1 tsp salt', failed: true },
        ],
        onRetry: noop,
        added: undefined,
        onOpen: undefined,
    };

    it('each line not in the recipe yet is a row of the list, with its own text and its state', () => {
        renderLeaf({ values: valuesWith([]), paste: PASTE });

        expect(rowItems().map((row) => row.textContent)).toEqual([
            '2 cups flour' + en.rowStateReading,
            '1 tsp salt' + en.rowStateLookupFailed + en.statusActionRetry,
        ]);
        expect(screen.queryByText(en.noIngredients)).toBeNull();
    });

    it('pasted lines follow the list’s own rows', () => {
        renderLeaf({ paste: PASTE });

        expect(rowItems()).toHaveLength(3);
    });

    it('a line whose lookup failed offers Try again, named for its line', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        renderLeaf({ values: valuesWith([]), paste: { ...PASTE, onRetry } });

        await user.click(screen.getByRole('button', { name: 'Try again for 1 tsp salt' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('says politely how many ingredients a finished paste added', () => {
        renderLeaf({ paste: { ...PASTE, reading: [], added: { count: 2, occurrence: 1 } } });

        expect(screen.getAllByRole('status').some((region) => region.textContent === 'Added 2 ingredients.')).toBe(
            true,
        );
    });

    it('the empty section offers Paste a list beside the add field; a section with lines does not', async () => {
        const user = userEvent.setup();
        const onOpen = vi.fn();
        const { rerender } = render(leafElement({ values: valuesWith([]), paste: { ...PASTE, reading: [], onOpen } }));

        await user.click(screen.getByRole('button', { name: editor.ingredients.pasteList }));
        expect(onOpen).toHaveBeenCalledTimes(1);

        rerender(leafElement({ paste: { ...PASTE, reading: [], onOpen } }));
        expect(screen.queryByRole('button', { name: editor.ingredients.pasteList })).toBeNull();
    });

    it('⛔ the paste gate is unchanged: a new, empty group does not hide Paste a list', async () => {
        const user = userEvent.setup();
        renderLeaf({ values: valuesWith([]), paste: { ...PASTE, reading: [], onOpen: noop } });

        await user.click(screen.getByRole('button', { name: en.groupAdd }));
        await user.type(await screen.findByRole('textbox', { name: en.groupNameLabel }), 'Sauce{Enter}');

        await act(async () => Promise.resolve());
        expect(screen.getByRole('button', { name: editor.ingredients.pasteList })).toBeTruthy();
    });
});
