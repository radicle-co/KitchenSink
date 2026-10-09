/**
 * Native component tests for the ingredients field group, rendered via react-native-web under jsdom. Mirrors the web
 * file (`recipeFieldGroups.test.tsx`), so the two platform renders cannot drift. The Details, Steps and visibility
 * leaves' tests moved to their own files when slice 7 rebuilt them (`RecipeBasicsFields.native.test.tsx` and its
 * siblings).
 *
 * These were `RecipeForm.native`'s tests. It rendered nothing but these groups in a `ScrollView` with a heading and
 * Submit/Cancel, and nothing outside tests rendered it, so it was deleted; its heading and Submit/Cancel tests went
 * with it. The editor's own chrome is covered by `editor/__tests__/`.
 *
 * REWRITTEN for the UI overhaul's read rows, as the web file was (its doc says where each deleted case's coverage went):
 * a row's fields live in its row editor, a phone sheet here, so the amount, unit and error cases open it first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dialogTitled } from '@commise/test-utils';
import { BackInterceptProvider } from '@commise/ui/back-intercept';
import { cleanup, render as renderBare, screen, within } from '@testing-library/react';
import { useState, type FC, type ReactElement, type ReactNode } from 'react';
import { fireEvent } from '@testing-library/dom';

// react-native-web does not implement `sendAccessibilityEvent`, which the ingredient rows call to move the
// screen-reader cursor after a Remove (`@commise/ui/popover`'s focus request, V1 sign-off item 11).
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

// Explicit `.native.js` — tsc and the native config's resolver both map each to its `.native.tsx` leaf.
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.native.js';
import { type RecipeFormValues, defaultRecipeFormValues } from '../values.js';
import type { RecipeFormSectionProps } from '../props.js';
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

const ROW_EDITOR = makeIngredientRowEditor();

/** The props {@link FieldGroups} forwards: every group's own, and the ingredients group's controllers. */
interface FieldGroupsProps extends RecipeFormSectionProps {
    readonly ingredientNutrition: IngredientNutrition;
    readonly ingredientLookupRetry: LookupRetry;
    readonly ingredientRowEditor: IngredientRowEditor;
}

/**
 * The ingredients field group, as the editor holds it. The other three leaves have their own suites
 * (`RecipeBasicsFields.native.test.tsx` and its siblings).
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

afterEach(cleanup);

/** A row's food search registers an Android back guard, which throws outside a provider, deliberately. */
const BackChain: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <BackInterceptProvider onUnhandled={() => false}>{children}</BackInterceptProvider>
);
const render = (ui: ReactElement) => renderBare(ui, { wrapper: BackChain });
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

/** Open a row's editor (a phone sheet: the container class is narrow under jsdom) and answer its sheet. */
const openEditor = (openLabel: string, title: string): HTMLElement => {
    fireEvent.click(screen.getByRole('button', { name: openLabel }));

    return dialogTitled(title);
};

/** A host that applies each edit and renders against it, as the editor does. */
const Stateful: FC<{ readonly initial: RecipeFormValues; readonly onValues: (values: RecipeFormValues) => void }> = ({
    initial,
    onValues,
}) => {
    const [values, setValues] = useState(initial);

    return (
        <FieldGroups
            values={values}
            onChange={(next) => {
                onValues(next);
                setValues(next);
            }}
            ingredientNutrition={CATALOG_NUTRITION}
            ingredientLookupRetry={makeLookupRetry()}
            ingredientRowEditor={ROW_EDITOR}
        />
    );
};

describe('the recipe field groups (native) — error wiring (WCAG 3.3.1)', () => {
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

        expect(screen.getByText(en.errors.ingredientsUnresolved)).toBeTruthy();
        expect(screen.getAllByRole('button', { name: new RegExp(`^${en.rowStateNoMatch}`, 'u') })).toHaveLength(1);
    });

    it('an ingredientsQuantityInvalid refusal marks the offending row, and its editor’s bounds read invalid', () => {
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

        const sheet = openEditor('Edit 2–100,000,000 Stock', 'Stock');

        expect(within(sheet).getByLabelText(en.rowAmountLabel).getAttribute('aria-invalid')).toBe('true');
        expect(within(sheet).getByLabelText(en.rowAmountHighLabel).getAttribute('aria-invalid')).toBe('true');
    });

    it('does not mark any row on an ingredientsEmpty error (no lines exist)', () => {
        renderForm({ values: filledValues({ ingredients: [] }), errors: { ingredients: 'ingredientsEmpty' } });

        expect(screen.queryByText(en.rowAmountInvalid)).toBeNull();
    });
});

describe('the recipe field groups (native) — the amount in the row editor (U9/R42, §7.5.2)', () => {
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

    it('a stated range shows BOTH bounds; the visible "to" is hidden from assistive tech', () => {
        renderForm({ values: ranged(2, 3) });

        const sheet = openEditor('Edit 2–3 cup Stock', 'Stock');

        expect((within(sheet).getByLabelText(en.rowAmountLabel) as HTMLInputElement).value).toBe('2');
        expect((within(sheet).getByLabelText(en.rowAmountHighLabel) as HTMLInputElement).value).toBe('3');
        expect(within(sheet).getByText(en.rowAmountTo).getAttribute('aria-hidden')).toBe('true');
    });

    it('an ABSENT amount is an empty field, never a zero (R40)', () => {
        renderForm({ values: ranged(Number.NaN) });

        expect(
            (within(openEditor('Edit cup Stock', 'Stock')).getByLabelText(en.rowAmountLabel) as HTMLInputElement).value,
        ).toBe('');
    });

    it('emptying the amount states NO amount; emptying the upper bound goes back to one amount', () => {
        const onValues = vi.fn<(values: RecipeFormValues) => void>();
        render(<Stateful initial={ranged(2, 3)} onValues={onValues} />);

        const sheet = openEditor('Edit 2–3 cup Stock', 'Stock');

        fireEvent.change(within(sheet).getByLabelText(en.rowAmountHighLabel), { target: { value: '' } });
        expect(onValues.mock.lastCall?.[0].ingredients[0]).not.toHaveProperty('quantityHigh');
        expect(within(sheet).getByLabelText(en.rowAmountHighLabel)).toBeTruthy();

        fireEvent.change(within(sheet).getByLabelText(en.rowAmountLabel), { target: { value: '' } });
        expect(Number.isNaN(onValues.mock.lastCall?.[0].ingredients[0]?.quantity)).toBe(true);
    });
});

describe('the recipe field groups (native) — the unit’s class, in the row editor (U25/U35)', () => {
    const withUnit = (unit: string, name = 'Onion'): RecipeFormValues =>
        filledValues({
            ingredients: withLineKeys([{ isUserEntered: false, ingredientId: 'ing_1', name, quantity: 2, unit }]),
        });

    it('a CANONICAL unit has no note', () => {
        renderForm({ values: withUnit('cups') });

        const sheet = openEditor('Edit 2 cups Onion', 'Onion');

        expect(within(sheet).queryByText('Cook’s measure')).toBeNull();
        expect(within(sheet).queryByText('Unrecognised unit')).toBeNull();
    });

    it.each([
        ['handful', 'Cook’s measure'],
        ['blorp', 'Unrecognised unit'],
        ['zq', 'Unrecognised unit'],
    ])('the unit %j says "%s", and the field keeps it', (unit, note) => {
        renderForm({ values: withUnit(unit) });

        const sheet = openEditor(`Edit 2 ${unit} Onion`, 'Onion');

        expect(within(sheet).getByText(note)).toBeTruthy();
        expect((within(sheet).getByLabelText(en.rowUnitLabel) as HTMLInputElement).value).toBe(unit);
    });

    it.each(['T', 't'])('the case-sensitive unit %j is ordinary and kept byte-for-byte (U35)', (unit) => {
        renderForm({ values: withUnit(unit, 'Butter') });

        const sheet = openEditor(`Edit 2 ${unit} Butter`, 'Butter');

        expect((within(sheet).getByLabelText(en.rowUnitLabel) as HTMLInputElement).value).toBe(unit);
        expect(within(sheet).queryByText('Unrecognised unit')).toBeNull();
    });
});

describe('the recipe field groups (native) — preparation (U26)', () => {
    it('the row reads the preparation after the name, and the editor edits it without touching the food', () => {
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

        const sheet = openEditor('Edit 1 Onion', 'Onion');
        fireEvent.change(within(sheet).getByLabelText(en.rowPrepLabel), { target: { value: 'sliced' } });

        expect(onValues.mock.lastCall?.[0].ingredients[0]).toMatchObject({
            ingredientId: 'ing_1',
            preparation: 'sliced',
        });
    });
});

describe('the recipe field groups (native) — group headings (U27, §7.5.5)', () => {
    const line = (name: string, groupLabel?: string) => ({
        isUserEntered: false,
        ingredientId: `ing_${name}`,
        name,
        quantity: 1,
        ...(groupLabel === undefined ? {} : { groupLabel }),
    });
    const headings = (): (string | null)[] => screen.queryAllByRole('heading').map((heading) => heading.textContent);

    it('⛔ an UNGROUPED recipe renders NO group heading at all', () => {
        renderForm({ values: filledValues({ ingredients: withLineKeys([line('Rice'), line('Stock')]) }) });

        expect(headings()).toEqual([]);
    });

    it('a GROUPED recipe renders one level-3 heading per run, in stored order', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([line('Flour', 'Dry'), line('Sugar', 'Dry'), line('Milk', 'Wet')]),
            }),
        });

        expect(headings()).toEqual(['Dry', 'Wet']);
        expect(screen.getAllByRole('heading').every((heading) => heading.getAttribute('aria-level') === '3')).toBe(
            true,
        );
    });

    it('⛔ a label repeated NON-ADJACENTLY renders THREE headings, in stored order', () => {
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
});

describe('the recipe field groups (native) — per-row + running-total nutrition (w3/e3, FR-007)', () => {
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

describe('the recipe field groups (native) — validation errors', () => {
    // The other sections' messages are their own leaves' (`RecipeBasicsFields.native.test.tsx` and its siblings).
    it('surfaces the ingredients error', () => {
        renderForm({ errors: { ingredients: 'ingredientsEmpty' } });

        expect(screen.getAllByRole('alert').map((node) => node.textContent)).toContain('Add at least one ingredient.');
    });

    it('renders no alerts when there are no errors', () => {
        renderForm();

        expect(screen.queryAllByRole('alert')).toHaveLength(0);
    });
});

/**
 * `docs/design/nativeContainerNames.md` N1 rule 2 and N2 (editor): a section's name is said once. REWRITTEN for slice 7:
 * the one-page editor's section owns the heading ("Ingredients", `editor/EditorSection.native.tsx`), so this leaf — the
 * section's body — says the name nowhere, as heading or label, or the screen would say it twice.
 */
describe('the recipe field groups (native) — N1: the section`s name is said once, by the editor`s section', () => {
    it.each(['Ingredients'])('this body says "%s" neither as a heading nor as a label', (name) => {
        renderForm();

        expect(screen.queryAllByRole('heading', { name })).toEqual([]);
        expect(screen.queryAllByLabelText(name)).toEqual([]);
    });
});
