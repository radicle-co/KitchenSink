// @vitest-environment jsdom
/**
 * Component tests for the web ingredients field group, `RecipeIngredientsFields`. The Details, Steps and visibility
 * leaves' tests moved to their own files when slice 7 rebuilt them (`RecipeBasicsFields.test.tsx`,
 * `RecipeInstructionsFields.test.tsx`, `RecipeVisibilityField.test.tsx`); their contrast and focus-ring blocks measured
 * chip and field classes those leaves no longer own (`@commise/ui/chip`, `FIELD_CLASS`), and were DROPPED, not moved:
 * `@commise/ui` holds no contrast test for them yet.
 *
 * Every `onChange` assertion checks the emitted values object, so a wrong immutable transition fails the test.
 *
 * These were `RecipeForm`'s tests. `RecipeForm` rendered nothing but these groups inside a `<form>` with a heading and
 * Submit/Cancel, and nothing outside tests rendered it, so it was deleted; its heading and Submit/Cancel tests went with
 * it. The editor's own chrome is covered by `editor/__tests__/`.
 *
 * REWRITTEN for the UI overhaul's read rows (build spec §7.5.1, §7.5.2): a row's fields live in its row editor now, so
 * the cases about the amount bounds, the unit's note and the error wiring open the editor first; the cases that pinned
 * the inline strip (the name as a read-only group, typing into it, the status badges, the direct Remove's surface and
 * its icon-only collapse, the row's wrap classes, and the per-row section field with its caret test) were DELETED with
 * the strip. Their coverage now: the read row and its states in `RecipeIngredientsFields.test.tsx`, the second line in
 * `rowSecondLine.test.ts`, the groups in `ingredientGroups.test.ts` and `useIngredientsFields.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { RecipeIngredientsFields } from '../RecipeIngredientsFields.js';
import { type RecipeFormValues, defaultRecipeFormValues } from '../values.js';
import { applyDraftAction, type RecipeFormSectionProps } from '../props.js';
import type { LookupRetry } from '../ingredientStatus.js';
import type { IngredientNutrition } from '../nutritionLookup.js';
import type { IngredientRowEditor } from '../../hooks/useIngredientRowEditor.js';
import { recipeFormMessages } from '../messages.js';
import {
    makeIngredientNutrition,
    makeLookupRetry,
    withLineKeys,
    makeIngredientRowEditor,
} from '../../__fixtures__/index.js';
import { ingredientsErrorId } from '../fieldErrorIds.js';

const ROW_EDITOR = makeIngredientRowEditor();

/** The props {@link FieldGroups} forwards: every group's own, and the ingredients group's controllers. */
interface FieldGroupsProps extends RecipeFormSectionProps {
    readonly ingredientNutrition: IngredientNutrition;
    readonly ingredientLookupRetry: LookupRetry;
    readonly ingredientRowEditor: IngredientRowEditor;
}

/**
 * The ingredients field group, as the editor holds it. The other three leaves have their own suites
 * (`RecipeBasicsFields.test.tsx`, `RecipeInstructionsFields.test.tsx`, `RecipeVisibilityField.test.tsx`), so a
 * failure here is about the ingredients alone.
 */
const FieldGroups: FC<FieldGroupsProps> = ({
    values,
    errors,
    onChange,
    ingredientNutrition,
    ingredientLookupRetry,
    ingredientRowEditor,
}) => (
    <RecipeIngredientsFields
        values={values}
        errors={errors}
        onChange={onChange}
        nutrition={ingredientNutrition}
        lookupRetry={ingredientLookupRetry}
        rowEditor={ingredientRowEditor}
    />
);

/**
 * The one alert with something to say. The trailing add row's field keeps its own assertive regions mounted, empty, so
 * they can speak later (`@commise/ui/live-region`).
 */
const shownAlert = (): HTMLElement => {
    const [only, ...more] = screen.getAllByRole('alert').filter((alert) => alert.textContent !== '');

    if (only === undefined || more.length > 0) {
        throw new Error(`expected one alert with text, found ${String(more.length + (only === undefined ? 0 : 1))}`);
    }

    return only;
};

afterEach(cleanup);

const noop = () => undefined;
/** The editor's nutrition read as these tests need it: a food named `cal-N` publishes N kcal per 100 g. */
const CATALOG_NUTRITION = makeIngredientNutrition({
    lookup: (ref) =>
        ref.id.startsWith('cal-')
            ? { state: 'found', catalog: { caloriesPer100g: Number(ref.id.slice('cal-'.length)) } }
            : { state: 'absent' },
});

const filledValues = (over: Partial<RecipeFormValues> = {}): RecipeFormValues => ({
    ...defaultRecipeFormValues(),
    title: 'Herb Risotto',
    description: 'Creamy and quick.',
    cuisine: 'Italian',
    tags: ['quick', 'dinner'],
    dietaryFlags: ['vegetarian'],
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 25,
    ingredients: withLineKeys([
        { isUserEntered: false, ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, unit: 'g' },
    ]),
    steps: [{ instruction: 'Toast the rice.', timerSeconds: 120 }],
    ...over,
});

function renderForm(overrides: Partial<FieldGroupsProps> = {}) {
    const props: FieldGroupsProps = {
        values: filledValues(),
        onChange: noop,
        ingredientNutrition: CATALOG_NUTRITION,
        ingredientLookupRetry: makeLookupRetry(),
        ingredientRowEditor: ROW_EDITOR,
        ...overrides,
    };
    render(<FieldGroups {...props} />);

    return props;
}

const en = recipeFormMessages.en;

/** Open a row's editor (a phone sheet under jsdom, which measures no container) and answer its dialog. */
const openEditor = async (user: ReturnType<typeof userEvent.setup>, openLabel: string): Promise<HTMLElement> => {
    await user.click(screen.getByRole('button', { name: openLabel }));

    return screen.getByRole('dialog');
};

/** A host that applies each edit and renders against it, as the editor does. */
const Stateful: FC<{ readonly initial: RecipeFormValues; readonly onValues: (values: RecipeFormValues) => void }> = ({
    initial,
    onValues,
}) => {
    const [values, setValues] = useState(initial);

    const apply = (next: RecipeFormValues): RecipeFormValues => {
        onValues(next);

        return next;
    };

    // The row's edits are the editor's own transition, applied to the draft as it is when it runs.
    const [rowEditor] = useState(() =>
        makeIngredientRowEditor({
            dispatch: (action) => setValues((current) => apply(applyDraftAction(current, action))),
        }),
    );

    return (
        <FieldGroups
            values={values}
            onChange={(next) => setValues(apply(next))}
            ingredientNutrition={CATALOG_NUTRITION}
            ingredientLookupRetry={makeLookupRetry()}
            ingredientRowEditor={rowEditor}
        />
    );
};

describe('the recipe field groups (web) — the attention panel inside a form (plan 002 V1)', () => {
    it('opening and closing a row’s panel never submits a form around the group', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
        render(
            <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
                <FieldGroups
                    values={filledValues({
                        ingredients: withLineKeys([
                            {
                                isUserEntered: false,
                                ingredientId: 'ing_1',
                                name: 'Kale',
                                quantity: 1,
                                resolutionStatus: FoodResolutionStatus.NOT_FOUND,
                            },
                        ]),
                    })}
                    onChange={noop}
                    ingredientNutrition={CATALOG_NUTRITION}
                    ingredientLookupRetry={makeLookupRetry()}
                    ingredientRowEditor={ROW_EDITOR}
                />
            </form>,
        );

        await user.click(screen.getByRole('button', { name: `${en.rowStateNoMatch}: Kale` }));
        await user.click(screen.getByRole('button', { name: 'Close details for Kale' }));

        expect(onSubmit).not.toHaveBeenCalled();
    });
});

describe('the recipe field groups (web) — error wiring (WCAG 3.3.1)', () => {
    it('an ingredientsUnresolved refusal shows on the unresolved rows alone, in words', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Rice', quantity: 300, unit: 'g' },
                    { isUserEntered: false, ingredientId: null, name: 'Kale', quantity: 1 },
                ]),
            }),
            errors: { ingredients: 'ingredientsUnresolved' },
        });

        expect(shownAlert().textContent).toBe(en.errors.ingredientsUnresolved);
        expect(screen.getAllByRole('button', { name: new RegExp(`^${en.rowStateNoMatch}`, 'u') })).toHaveLength(1);
        expect(screen.getByRole('button', { name: `${en.rowStateNoMatch}: Kale` })).toBeTruthy();
    });

    it('an ingredientsQuantityInvalid refusal marks the offending row, and its editor’s bounds point at the alert', async () => {
        const user = userEvent.setup();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Rice', quantity: 300, unit: 'g' },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Stock', quantity: 2, quantityHigh: 1e8 },
                ]),
            }),
            errors: { ingredients: 'ingredientsQuantityInvalid' },
        });

        expect(screen.getAllByText(en.rowAmountInvalid)).toHaveLength(1);

        const sheet = await openEditor(user, 'Edit 2–100,000,000 Stock');
        const low = within(sheet).getByLabelText(en.rowAmountLabel);
        const high = within(sheet).getByRole('textbox', { name: en.rowAmountHighLabel });

        for (const field of [low, high]) {
            expect(field.getAttribute('aria-invalid')).toBe('true');
            expect(field.getAttribute('aria-describedby')).toContain(ingredientsErrorId);
        }
    });

    it('does NOT mark an amount on an ingredientsUnresolved error: that error is about the food', async () => {
        const user = userEvent.setup();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([{ isUserEntered: false, ingredientId: null, name: 'Flour', quantity: 0 }]),
            }),
            errors: { ingredients: 'ingredientsUnresolved' },
        });

        const sheet = await openEditor(user, 'Edit Flour');

        expect(within(sheet).getByLabelText(en.rowAmountLabel).getAttribute('aria-invalid')).toBeNull();
    });

    it('does not mark any row on an ingredientsEmpty error (no lines exist)', () => {
        renderForm({ values: filledValues({ ingredients: [] }), errors: { ingredients: 'ingredientsEmpty' } });

        expect(shownAlert().textContent).toBe(en.errors.ingredientsEmpty);
        expect(screen.queryByText(en.rowAmountInvalid)).toBeNull();
    });
});

describe('the recipe field groups (web) — the amount in the row editor (U9/R42, §7.5.2)', () => {
    const ranged = (quantity: number, quantityHigh?: number): RecipeFormValues =>
        filledValues({
            ingredients: withLineKeys([
                {
                    isUserEntered: false,
                    ingredientId: 'ing_1',
                    name: 'Stock',
                    quantity,
                    ...(quantityHigh === undefined ? {} : { quantityHigh }),
                    unit: 'cup',
                },
            ]),
        });

    it('a stated range shows BOTH bounds, sharing one unit, with the visible "to" hidden from assistive tech', async () => {
        const user = userEvent.setup();
        renderForm({ values: ranged(2, 3) });

        const sheet = await openEditor(user, 'Edit 2–3 cup Stock');

        expect((within(sheet).getByLabelText(en.rowAmountLabel) as HTMLInputElement).value).toBe('2');
        expect((within(sheet).getByRole('textbox', { name: en.rowAmountHighLabel }) as HTMLInputElement).value).toBe(
            '3',
        );
        expect(within(sheet).getAllByRole('combobox', { name: en.rowUnitLabel })).toHaveLength(1);
        expect(within(sheet).getByText(en.rowAmountTo).getAttribute('aria-hidden')).toBe('true');
    });

    it('an ABSENT amount is an empty field, never a zero (R40)', async () => {
        const user = userEvent.setup();
        renderForm({ values: ranged(Number.NaN) });

        const sheet = await openEditor(user, 'Edit cup Stock');

        expect((within(sheet).getByLabelText(en.rowAmountLabel) as HTMLInputElement).value).toBe('');
    });

    it('emptying the amount states NO amount, never a zero', async () => {
        const user = userEvent.setup();
        const onValues = vi.fn<(values: RecipeFormValues) => void>();
        render(<Stateful initial={ranged(2)} onValues={onValues} />);

        const sheet = await openEditor(user, 'Edit 2 cup Stock');
        await user.clear(within(sheet).getByLabelText(en.rowAmountLabel));

        expect(Number.isNaN(onValues.mock.lastCall?.[0].ingredients[0]?.quantity)).toBe(true);
    });

    it('typing an upper bound states a range, and emptying it goes back to one amount', async () => {
        const user = userEvent.setup();
        const onValues = vi.fn<(values: RecipeFormValues) => void>();
        render(<Stateful initial={ranged(2, 3)} onValues={onValues} />);

        const sheet = await openEditor(user, 'Edit 2–3 cup Stock');
        const high = within(sheet).getByRole('textbox', { name: en.rowAmountHighLabel });

        await user.clear(high);
        expect(onValues.mock.lastCall?.[0].ingredients[0]).not.toHaveProperty('quantityHigh');

        await user.type(high, '4');
        expect(onValues.mock.lastCall?.[0].ingredients[0]?.quantityHigh).toBe(4);
    });

    it('keeps the line’s food when its amount or unit changes (U6)', async () => {
        const user = userEvent.setup();
        const onValues = vi.fn<(values: RecipeFormValues) => void>();
        render(<Stateful initial={ranged(2)} onValues={onValues} />);

        const sheet = await openEditor(user, 'Edit 2 cup Stock');
        await user.type(within(sheet).getByLabelText(en.rowAmountLabel), '5');

        expect(onValues.mock.lastCall?.[0].ingredients[0]).toMatchObject({ ingredientId: 'ing_1', quantity: 25 });
    });
});

describe('the recipe field groups (web) — the unit’s class, in the row editor (U25/U35)', () => {
    const withUnit = (unit: string, name = 'Onion'): RecipeFormValues =>
        filledValues({
            ingredients: withLineKeys([{ isUserEntered: false, ingredientId: 'ing_1', name, quantity: 2, unit }]),
        });
    const unitField = (sheet: HTMLElement): HTMLElement =>
        within(sheet).getByRole('combobox', { name: en.rowUnitLabel });

    it('a CANONICAL unit has no note at all: the ordinary line stays quiet', async () => {
        const user = userEvent.setup();
        renderForm({ values: withUnit('cups') });

        const sheet = await openEditor(user, 'Edit 2 cups Onion');

        expect(within(sheet).queryByText('Cook’s measure')).toBeNull();
        expect(within(sheet).queryByText('Unrecognised unit')).toBeNull();
    });

    it.each([
        ['a SUBJECTIVE unit as a cook’s measure', 'handful', 'Cook’s measure'],
        ['an UNKNOWN unit as unrecognised, still ACCEPTED, never invalid', 'blorp', 'Unrecognised unit'],
        ['a short unknown unit too (the U35 ruling covers T and t, not the alphabet)', 'zq', 'Unrecognised unit'],
    ])('marks %s, and describes the field with it', async (_case, unit, note) => {
        const user = userEvent.setup();
        renderForm({ values: withUnit(unit) });

        const sheet = await openEditor(user, `Edit 2 ${unit} Onion`);
        const field = unitField(sheet) as HTMLInputElement;

        expect(field.getAttribute('aria-describedby')).toContain(within(sheet).getByText(note).id);
        expect(field.value).toBe(unit);
        expect(field.getAttribute('aria-invalid')).toBeNull();
    });

    it.each(['T', 't'])('the case-sensitive unit %j is ordinary and kept byte-for-byte (U35)', async (unit) => {
        const user = userEvent.setup();
        renderForm({ values: withUnit(unit, 'Butter') });

        const sheet = await openEditor(user, `Edit 2 ${unit} Butter`);

        expect((unitField(sheet) as HTMLInputElement).value).toBe(unit);
        expect(within(sheet).queryByText('Unrecognised unit')).toBeNull();
        expect(within(sheet).queryByText('Cook’s measure')).toBeNull();
    });
});

describe('the recipe field groups (web) — preparation (U26)', () => {
    it('the row reads the preparation after the name, and the editor edits it without touching the food', async () => {
        const user = userEvent.setup();
        const onValues = vi.fn<(values: RecipeFormValues) => void>();
        render(
            <Stateful
                initial={filledValues({
                    ingredients: withLineKeys([
                        {
                            isUserEntered: false,
                            ingredientId: 'ing_1',
                            name: 'Onion',
                            quantity: 1,
                            preparation: 'diced',
                        },
                    ]),
                })}
                onValues={onValues}
            />,
        );

        expect(screen.getByRole('button', { name: 'Edit 1 Onion' }).textContent).toContain('Onion · diced');

        const sheet = await openEditor(user, 'Edit 1 Onion');
        await user.clear(within(sheet).getByLabelText(en.rowPrepLabel));
        await user.type(within(sheet).getByLabelText(en.rowPrepLabel), 'sliced');

        expect(onValues.mock.lastCall?.[0].ingredients[0]).toMatchObject({
            ingredientId: 'ing_1',
            name: 'Onion',
            preparation: 'sliced',
        });
    });
});

describe('the recipe field groups (web) — group headings (U27, §7.5.5)', () => {
    const line = (name: string, groupLabel?: string) => ({
        isUserEntered: false,
        ingredientId: `ing_${name}`,
        name,
        quantity: 1,
        ...(groupLabel === undefined ? {} : { groupLabel }),
    });
    const headings = (): (string | null)[] =>
        screen.queryAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

    it('⛔ an UNGROUPED recipe renders NO group heading at all', () => {
        renderForm({ values: filledValues({ ingredients: withLineKeys([line('Rice'), line('Stock')]) }) });

        expect(headings()).toEqual([]);
    });

    it('a GROUPED recipe renders one heading per run, in stored order', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([line('Flour', 'Dry'), line('Sugar', 'Dry'), line('Milk', 'Wet')]),
            }),
        });

        expect(headings()).toEqual(['Dry', 'Wet']);
    });

    it('⛔ a label repeated NON-ADJACENTLY renders THREE headings, in stored order: the recipe’s order wins', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([line('Flour', 'Dry'), line('Milk', 'Wet'), line('Sugar', 'Dry')]),
            }),
        });

        expect(headings()).toEqual(['Dry', 'Wet', 'Dry']);
    });

    it('⛔ a padded label is the same group as its trimmed twin', () => {
        renderForm({
            values: filledValues({ ingredients: withLineKeys([line('Flour', 'Dry'), line('Sugar', ' Dry ')]) }),
        });

        expect(headings()).toEqual(['Dry']);
    });

    it('a MIXED recipe leaves the leading ungrouped run unheaded', () => {
        renderForm({ values: filledValues({ ingredients: withLineKeys([line('Salt'), line('Flour', 'Dry')]) }) });

        expect(headings()).toEqual(['Dry']);
        expect(
            within(screen.getByRole('list', { name: 'Ingredients' })).getByRole('button', { name: 'Edit 1 Salt' }),
        ).toBeTruthy();
        expect(
            within(screen.getByRole('list', { name: 'Dry' })).getByRole('button', { name: 'Edit 1 Flour' }),
        ).toBeTruthy();
    });
});

describe('the recipe field groups (web) — per-row + running-total nutrition (w3/e3, FR-007)', () => {
    it('renders the running per-serving total for a complete ingredient set', () => {
        renderForm({
            values: filledValues({
                servings: 1,
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Arborio rice',
                        quantity: 300,
                        unit: 'g',
                        foodId: 'cal-130',
                    },
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_2',
                        name: 'Custom spice',
                        quantity: 1,
                        userCalories: 30,
                    },
                ]),
            }),
        });

        expect(screen.getByText(/^420 cal per serving · /u)).toBeTruthy();
        // Build spec §7.5.6: every line counts.
        expect(screen.getByText(/ · 2 of 2 counted$/u)).toBeTruthy();
    });

    it('updates the running total when an ingredient is added', () => {
        const { rerender } = render(
            <FieldGroups
                values={filledValues({
                    servings: 1,
                    ingredients: withLineKeys([
                        {
                            isUserEntered: false,
                            ingredientId: 'ing_1',
                            name: 'Rice',
                            quantity: 100,
                            unit: 'g',
                            foodId: 'cal-100',
                        },
                    ]),
                })}
                onChange={noop}
                ingredientNutrition={CATALOG_NUTRITION}
                ingredientLookupRetry={makeLookupRetry()}
                ingredientRowEditor={ROW_EDITOR}
            />,
        );

        expect(screen.getByText(/^100 cal per serving · /u)).toBeTruthy();

        rerender(
            <FieldGroups
                values={filledValues({
                    servings: 1,
                    ingredients: withLineKeys([
                        {
                            isUserEntered: false,
                            ingredientId: 'ing_1',
                            name: 'Rice',
                            quantity: 100,
                            unit: 'g',
                            foodId: 'cal-100',
                        },
                        {
                            isUserEntered: false,
                            ingredientId: 'ing_2',
                            name: 'Oil',
                            quantity: 100,
                            unit: 'g',
                            foodId: 'cal-50',
                        },
                    ]),
                })}
                onChange={noop}
                ingredientNutrition={CATALOG_NUTRITION}
                ingredientLookupRetry={makeLookupRetry()}
                ingredientRowEditor={ROW_EDITOR}
            />,
        );

        expect(screen.getByText(/^150 cal per serving · /u)).toBeTruthy();
    });

    it('updates the running total when an ingredient’s quantity changes', () => {
        const { rerender } = render(
            <FieldGroups
                values={filledValues({
                    servings: 1,
                    ingredients: withLineKeys([
                        {
                            isUserEntered: false,
                            ingredientId: 'ing_1',
                            name: 'Rice',
                            quantity: 100,
                            unit: 'g',
                            foodId: 'cal-100',
                        },
                    ]),
                })}
                onChange={noop}
                ingredientNutrition={CATALOG_NUTRITION}
                ingredientLookupRetry={makeLookupRetry()}
                ingredientRowEditor={ROW_EDITOR}
            />,
        );

        expect(screen.getByText(/^100 cal per serving · /u)).toBeTruthy();

        rerender(
            <FieldGroups
                values={filledValues({
                    servings: 1,
                    ingredients: withLineKeys([
                        {
                            isUserEntered: false,
                            ingredientId: 'ing_1',
                            name: 'Rice',
                            quantity: 200,
                            unit: 'g',
                            foodId: 'cal-100',
                        },
                    ]),
                })}
                onChange={noop}
                ingredientNutrition={CATALOG_NUTRITION}
                ingredientLookupRetry={makeLookupRetry()}
                ingredientRowEditor={ROW_EDITOR}
            />,
        );

        expect(screen.getByText(/^200 cal per serving · /u)).toBeTruthy();
    });

    it('updates the running total when an ingredient is removed', () => {
        const { rerender } = render(
            <FieldGroups
                values={filledValues({
                    servings: 1,
                    ingredients: withLineKeys([
                        {
                            isUserEntered: false,
                            ingredientId: 'ing_1',
                            name: 'Rice',
                            quantity: 100,
                            unit: 'g',
                            foodId: 'cal-100',
                        },
                        {
                            isUserEntered: false,
                            ingredientId: 'ing_2',
                            name: 'Oil',
                            quantity: 100,
                            unit: 'g',
                            foodId: 'cal-50',
                        },
                    ]),
                })}
                onChange={noop}
                ingredientNutrition={CATALOG_NUTRITION}
                ingredientLookupRetry={makeLookupRetry()}
                ingredientRowEditor={ROW_EDITOR}
            />,
        );

        expect(screen.getByText(/^150 cal per serving · /u)).toBeTruthy();

        rerender(
            <FieldGroups
                values={filledValues({
                    servings: 1,
                    ingredients: withLineKeys([
                        {
                            isUserEntered: false,
                            ingredientId: 'ing_1',
                            name: 'Rice',
                            quantity: 100,
                            unit: 'g',
                            foodId: 'cal-100',
                        },
                    ]),
                })}
                onChange={noop}
                ingredientNutrition={CATALOG_NUTRITION}
                ingredientLookupRetry={makeLookupRetry()}
                ingredientRowEditor={ROW_EDITOR}
            />,
        );

        expect(screen.getByText(/^100 cal per serving · /u)).toBeTruthy();
    });

    it('shows the honest partial affordance (never a fake total) when a line cannot be accounted for', () => {
        renderForm({
            values: filledValues({
                servings: 1,
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Rice',
                        quantity: 100,
                        unit: 'g',
                        foodId: 'cal-100',
                    },
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_2',
                        name: 'Stock',
                        quantity: 1,
                        unit: 'cup',
                        resolutionStatus: 'PENDING',
                    },
                ]),
            }),
        });

        expect(screen.getByText(/^100 cal per serving · /u)).toBeTruthy();
        // Build spec §7.5.6: the line says one is not counted, never a total that looks whole.
        expect(screen.getByText(/ · 1 of 2 counted$/u)).toBeTruthy();
    });
});

describe('the recipe field groups (web) — validation errors', () => {
    // The other sections' messages are their own leaves' (`RecipeBasicsFields.test.tsx`, `RecipeInstructionsFields.test.tsx`).
    it('surfaces the ingredients error', () => {
        renderForm({ errors: { ingredients: 'ingredientsEmpty' } });

        expect(screen.getAllByRole('alert').map((node) => node.textContent)).toContain('Add at least one ingredient.');
    });

    it('says no alert when there are no errors', () => {
        renderForm();

        // The trailing add row's assertive regions are mounted empty, so they can speak later; none says anything.
        expect(screen.queryAllByRole('alert').filter((alert) => alert.textContent !== '')).toHaveLength(0);
    });
});
