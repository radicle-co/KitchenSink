/**
 * Native component tests for the ingredients field group, rendered via react-native-web under jsdom. Mirrors the web
 * file (`recipeFieldGroups.test.tsx`), so the two platform renders cannot drift. The Details, Steps and visibility
 * leaves' tests moved to their own files when slice 7 rebuilt them (`RecipeBasicsFields.native.test.tsx` and its
 * siblings).
 *
 * These were `RecipeForm.native`'s tests. It rendered nothing but these groups in a `ScrollView` with a heading and
 * Submit/Cancel, and nothing outside tests rendered it, so it was deleted; its heading and Submit/Cancel tests went
 * with it. The wizard's own chrome is covered by `wizard/__tests__/Wizard.native.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { fireEvent } from '@testing-library/dom';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

// react-native-web does not implement `sendAccessibilityEvent`, which the ingredient rows call to move the
// screen-reader cursor after a Remove (`@commise/ui/popover`'s focus request, V1 sign-off item 11).
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

// Explicit `.native.js` — tsc and the native config's resolver both map each to its `.native.tsx` leaf.
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.native.js';
import { type RecipeFormValues, defaultRecipeFormValues } from '../values.js';
import type { DraftAction } from '../draftAction.js';
import { resolutionStatusLabel, type RecipeFormSectionProps } from '../props.js';
import type { LookupRetry } from '../ingredientStatus.js';
import type { IngredientNutrition } from '../nutritionLookup.js';
import type { IngredientRowEditor } from '../../hooks/useIngredientRowEditor.js';
import { recipeFormMessages } from '../messages.js';
import { seedLineKey } from '../lineKey.js';
import {
    makeIngredientNutrition,
    makeLookupRetry,
    withLineKeys,
    makeIngredientRowEditor,
    makeRestingIngredientEntry,
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

const inputValue = (label: string): string => screen.getByLabelText<HTMLInputElement>(label).value;

describe('the recipe field groups (native) — B8 error accessibility wiring (aria-invalid + aria-describedby)', () => {
    /** REWRITTEN + SPLIT for U9 — see the web suite for the rationale. One test per error code. */
    it('wires only the UNRESOLVED lines to an ingredientsUnresolved alert (WCAG 3.3.1)', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: null, name: 'Unresolved', quantity: 1 },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Salt', quantity: 0 },
                    { isUserEntered: false, ingredientId: 'ing_3', name: 'Pepper', quantity: 1 },
                ]),
            }),
            errors: { ingredients: 'ingredientsUnresolved' },
        });

        // REWRITTEN for plan 002 V1 B7: a line with no food is an entry field, the native combobox, which takes no
        // `aria-describedby` (React Native has none on a device). The alert shows, and the offending field reads
        // invalid; the others do not.
        expect(screen.getByText(recipeFormMessages.en.errors.ingredientsUnresolved)).toBeTruthy();
        expect(screen.getByLabelText('Ingredient 1 name').getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByLabelText('Ingredient 1 quantity').getAttribute('aria-invalid')).toBeNull();

        expect(screen.getByLabelText('Ingredient 2 name').getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByLabelText('Ingredient 2 quantity').getAttribute('aria-invalid')).toBeNull();

        expect(screen.getByLabelText('Ingredient 3 name').getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByLabelText('Ingredient 3 quantity').getAttribute('aria-invalid')).toBeNull();
    });

    // ⚠️ The offending input is not a typed `0`, which the 2026-09-12 ruling normalises to "no amount" and
    // is submittable. Kept in lockstep with the web mirror.
    it('wires only the offending QUANTITY lines to an ingredientsQuantityInvalid alert (WCAG 3.3.1)', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Salt', quantity: 2_000_000 },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Pepper', quantity: 1 },
                ]),
            }),
            errors: { ingredients: 'ingredientsQuantityInvalid' },
        });

        const alert = screen.getByRole('alert');

        expect(screen.getByLabelText('Ingredient 1 quantity').getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByLabelText('Ingredient 1 quantity').getAttribute('aria-describedby')).toBe(alert.id);
        expect(screen.getByLabelText('Ingredient 1 name').getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByLabelText('Ingredient 2 quantity').getAttribute('aria-invalid')).toBeNull();
    });

    it('does not mark any ingredient line invalid on an ingredientsEmpty error (no lines exist)', () => {
        renderForm({ values: filledValues({ ingredients: [] }), errors: { ingredients: 'ingredientsEmpty' } });

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.queryByLabelText('Ingredient 1 name')).toBeNull();
    });
});

describe('the recipe field groups (native) — ingredients', () => {
    it('shows the empty state when there are no ingredient lines', () => {
        renderForm({ values: filledValues({ ingredients: [] }) });

        expect(screen.getByText('No ingredients yet. Add your first ingredient.')).toBeTruthy();
    });

    it('renders name, quantity, and unit for each ingredient line', () => {
        renderForm();

        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Arborio rice');
        expect(inputValue('Ingredient 1 quantity')).toBe('300');
        expect(inputValue('Ingredient 1 unit')).toBe('g');
    });

    /**
     * REWRITTEN for plan 002 V1 B7 (`ingredientStatusExplanation.md` §2b; see the web leaf's test): a matched line's name
     * is record text, read only; a line with no food is an ENTRY field again, showing the text the cook wrote.
     */
    it('renders a matched line’s name as text no field holds, and a line with no food as an entry field (§2b, §3b)', () => {
        cleanup();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300 },
                ]),
            }),
        });
        // REWRITTEN for §3b: a matched name is text in a group named for its row, so no field holds it.
        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Arborio rice');
        expect(screen.queryByRole('textbox', { name: 'Ingredient 1 name' })).toBeNull();

        cleanup();
        const lines = withLineKeys([{ isUserEntered: false, ingredientId: null, name: 'rice', quantity: 1 }]);
        renderForm({
            values: filledValues({ ingredients: lines }),
            ingredientRowEditor: makeIngredientRowEditor({ entry: makeRestingIngredientEntry(lines) }),
        });
        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 1 name').readOnly).toBe(false);
        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 1 name').value).toBe('rice');
    });

    /**
     * U28, kept by plan 002 V1 B8: the trailing add row is an entry field whose text is the row editor's, so typing in it
     * changes no values. A line enters the draft only through a pick. See the web leaf's test.
     */
    it('⛔ typing in the trailing add row changes no values (U28, B8)', () => {
        const onChange = vi.fn();
        renderForm({ values: filledValues({ ingredients: [] }), onChange });

        fireEvent.change(screen.getByLabelText('Add an ingredient'), { target: { value: 'flour' } });

        expect(onChange).not.toHaveBeenCalled();
    });

    /**
     * REWRITTEN: Remove names its line by KEY through the host's draft transition (`DraftAction` `removeIngredient`),
     * which meets the draft as it is when it lands, so the remaining line keeps its identity by construction.
     */
    it('removes the targeted ingredient line, by its key, through the host’s draft transition', () => {
        const onChange = vi.fn();
        const dispatch = vi.fn<(action: DraftAction) => void>();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Rice', quantity: 300 },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Stock', quantity: 1 },
                ]),
            }),
            onChange,
            ingredientRowEditor: makeIngredientRowEditor({ dispatch }),
        });

        // B7: a matched row's actions sit behind its `⋮` (§3a row 3).
        fireEvent.click(screen.getByRole('button', { name: 'Actions for Rice' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove ingredient' }));

        expect(dispatch).toHaveBeenCalledExactlyOnceWith({ kind: 'removeIngredient', key: seedLineKey(1, 0) });
        expect(onChange).not.toHaveBeenCalled();
    });

    /**
     * REWRITTEN for U28 (was: "reports an UNRESOLVED line’s name edit upward ... U6") — the inverse
     * assertion; see the web leaf's test for the reasoning.
     */
    it('emits NOTHING when an unresolved line’s name is typed into (U28)', () => {
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([{ isUserEntered: false, ingredientId: null, name: 'ric', quantity: 1 }]),
            }),
            onChange,
        });

        fireEvent.change(screen.getByLabelText('Ingredient 1 name'), { target: { value: 'rice' } });

        expect(onChange).not.toHaveBeenCalled();
    });

    it.each([
        [FoodResolutionStatus.PENDING, 'Resolving…'],
        [FoodResolutionStatus.UNRESOLVED, 'Not resolved'],
        [FoodResolutionStatus.NOT_FOUND, 'No match found'],
        [FoodResolutionStatus.FAILED, 'Resolution failed'],
        // ⚠️ EXTENDED for U14, not rewritten — see the web mirror.
        [FoodResolutionStatus.NEEDS_REVIEW, 'Needs review'],
    ])('renders the %s resolution-status badge', (status, label) => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Rice',
                        quantity: 1,
                        resolutionStatus: status,
                    },
                ]),
            }),
        });

        expect(screen.getByText(label)).toBeTruthy();
    });

    /**
     * REWRITTEN for plan 002 V1 (SPECIFY.1 rows 3-4): `RESOLVED` used to sit in the table above with the word
     * "Resolved". A match is not news, so a matched row now shows no status word at all; its nutrition panel says
     * what there is to say (V1 B5).
     */
    it('⛔ shows NO status word on a RESOLVED line', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Rice',
                        quantity: 1,
                        resolutionStatus: FoodResolutionStatus.RESOLVED,
                    },
                ]),
            }),
        });

        expect(screen.queryByText('Resolved')).toBeNull();
        // Positive control: the row rendered.
        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Rice');
    });

    it('omits the status badge when a line has no resolution status', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([{ isUserEntered: false, ingredientId: 'ing_1', name: 'Rice', quantity: 1 }]),
            }),
        });

        expect(screen.queryByText('Resolved')).toBeNull();
    });

    /**
     * A doubted line (and a withdrawn food) wears the caution chip; every other status word stays neutral
     * (`namelessLineCopy.md` §2c). Compared against the OTHER statuses rather than a literal, so it pins the
     * DISTINCTION rather than today's palette. ⚠️ EDITED for plan 002 V1: `RESOLVED` left the comparison set because a
     * matched row shows no status word at all (SPECIFY.1 rows 3-4); `FOOD_REMOVED` joined the caution side, which the
     * spec names beside `NEEDS_REVIEW`.
     */
    it('⛔ styles the NEEDS_REVIEW badge differently from every other status (U14)', () => {
        const styleOf = (status: (typeof FoodResolutionStatus)[keyof typeof FoodResolutionStatus]): string => {
            cleanup();
            renderForm({
                values: filledValues({
                    ingredients: withLineKeys([
                        {
                            isUserEntered: false,
                            ingredientId: 'ing_1',
                            name: 'Rice',
                            quantity: 1,
                            resolutionStatus: status,
                        },
                    ]),
                }),
            });

            // The chip is a `View` holding the word's `Text` (`StatusBadge.native.tsx`): read both.
            const word = screen.getByText(resolutionStatusLabel(recipeFormMessages.en, status));
            const chip = word.parentElement ?? word;

            return getComputedStyle(word).color + '|' + getComputedStyle(chip).backgroundColor;
        };

        const review = styleOf(FoodResolutionStatus.NEEDS_REVIEW);

        expect(styleOf(FoodResolutionStatus.FOOD_REMOVED)).toBe(review);

        for (const other of [
            FoodResolutionStatus.PENDING,
            FoodResolutionStatus.PENDING_VERIFICATION,
            FoodResolutionStatus.UNRESOLVED,
            FoodResolutionStatus.AMBIGUOUS,
            FoodResolutionStatus.NOT_FOUND,
            FoodResolutionStatus.FAILED,
        ] as const) {
            expect(review).not.toBe(styleOf(other));
        }
    });
});

/** EDITED for plan 002 V1 B5 — the native mirror of the web suite's note: the chip is gone, the total reads the read. */
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
 * Resolve the value react-native-web actually APPLIED for a CSS property, by walking the element's atomic
 * `r-*` classes back to their compiled rules (`getComputedStyle` does not resolve them) and falling back to
 * the inline `style` attribute for per-render styles. Same helper as `CollectionHeader.native.test.tsx` /
 * `RecipeFilterBar.native.test.tsx`, which established the idiom.
 */
function appliedStyle(element: Element, property: string): string | undefined {
    const classNames = element.className.split(' ').filter((name) => name.startsWith('r-'));
    const sheets = document.styleSheets;
    let resolved: string | undefined;

    for (const className of classNames) {
        for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
            const rules = sheets[sheetIndex]?.cssRules;

            for (let ruleIndex = 0; ruleIndex < (rules?.length ?? 0); ruleIndex += 1) {
                const rule = rules?.[ruleIndex];

                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    const value = rule.style.getPropertyValue(property);

                    if (value !== '') {
                        resolved = value;
                    }
                }
            }
        }
    }

    return (resolved ?? (element as HTMLElement).style.getPropertyValue(property)) || undefined;
}

/**
 * Regression (Maestro CI view-hierarchy dump, first seen on the instruction row): React Native defaults `flexShrink` to
 * 0, so a row of fixed children pushed its destructive action off a 360 dp screen. The ingredient row WRAPS and its
 * action never shrinks. jsdom has no layout engine, so this pins the flex CONTRACT. The Steps row is
 * `RecipeInstructionsFields.native`'s, whose actions now sit behind its ⋯ menu.
 */
describe('the recipe field groups (native) — an ingredient row cannot push its remove action off the screen edge', () => {
    it('wraps the ingredient row and never shrinks its action', () => {
        // B7: Remove is a direct control only on a row with one action (§3a), so this row is still looking up its food.
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Arborio rice',
                        quantity: 300,
                        unit: 'g',
                        resolutionStatus: FoodResolutionStatus.PENDING,
                    },
                ]),
            }),
        });

        const row = screen.getByLabelText('Ingredient 1 name').parentElement as HTMLElement;
        let node = screen.getByRole('button', { name: 'Remove ingredient 1' });

        while (node.parentElement !== null && node.parentElement !== row) {
            node = node.parentElement;
        }

        expect(appliedStyle(row, 'flex-wrap')).toBe('wrap');
        expect(appliedStyle(node, 'flex-shrink')).toBe('0');
    });
});

describe('the recipe field groups (native) — every action button carries a decorative icon (mockup parity)', () => {
    // Mirrors the web leaf: each action button keeps its exact accessible name (so Maestro's visible-text
    // taps and the create/edit contracts are unchanged) and renders its icon inside an accessibility-hidden
    // wrapper (the shared Button primitive), so the label alone is the accessible name.
    const actionButtonNames = ['Remove ingredient 1'] as const;

    // B7: Remove is a direct control only on a row with one action (§3a), so this row is still looking up its food.
    const pendingValues = () =>
        filledValues({
            ingredients: withLineKeys([
                {
                    isUserEntered: false,
                    ingredientId: 'ing_1',
                    name: 'Arborio rice',
                    quantity: 300,
                    unit: 'g',
                    resolutionStatus: FoodResolutionStatus.PENDING,
                },
            ]),
        });

    it.each(actionButtonNames)('renders "%s" with an accessibility-hidden icon slot', (name) => {
        renderForm({ values: pendingValues() });

        const button = screen.getByRole('button', { name });
        // The Button wraps the caller's icon in an `aria-hidden` element, so the glyph never contributes to
        // the accessible name — present here regardless of what Feather draws.
        expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
    });
});

/**
 * U9 / R42 — the two-bound quantity field, native leaf.
 *
 * The one-for-one mirror of the web suite's ranged-quantity block: same states, same accessible names, same
 * marking rules. §14's cross-platform rule is what makes this a mirror rather than a variation — a range
 * that renders on one platform and not the other is the failure both suites exist to catch.
 */
describe('the recipe field groups (native) — ranged quantity (U9/R42)', () => {
    const lowField = (number = 1) => screen.getByLabelText<HTMLInputElement>(`Ingredient ${number} quantity`);
    const highField = (number = 1) => screen.getByLabelText<HTMLInputElement>(`Ingredient ${number} maximum quantity`);

    it('renders BOTH bounds of a stated range, sharing one unit field', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Flour',
                        quantity: 2,
                        quantityHigh: 3,
                        unit: 'cups',
                    },
                ]),
            }),
        });

        expect(lowField().value).toBe('2');
        expect(highField().value).toBe('3');
        expect(inputValue('Ingredient 1 unit')).toBe('cups');
    });

    it('leaves the upper bound EMPTY for a single stated value', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                ]),
            }),
        });

        expect(highField().value).toBe('');
    });

    it('renders an ABSENT quantity as an empty field, never a zero (R40)', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Butter',
                        quantity: Number.NaN,
                        unit: 'the size of an egg',
                    },
                ]),
            }),
        });

        expect(lowField().value).toBe('');
        expect(highField().value).toBe('');
    });

    it('states an upper bound when the user types one', () => {
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                ]),
            }),
            onChange,
        });

        fireEvent.change(highField(), { target: { value: '3' } });

        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({
                ingredients: [
                    {
                        key: seedLineKey(1, 0),
                        ingredientId: 'ing_1',
                        name: 'Flour',
                        quantity: 2,
                        quantityHigh: 3,
                        isUserEntered: false,
                    },
                ],
            }),
        );
    });

    it('CLEARS the upper bound back to a single value when the field is emptied', () => {
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2, quantityHigh: 3 },
                ]),
            }),
            onChange,
        });

        fireEvent.change(highField(), { target: { value: '' } });

        const next = onChange.mock.calls.at(-1)?.[0] as RecipeFormValues;
        expect('quantityHigh' in (next.ingredients[0] ?? {})).toBe(false);
    });

    it('clears the LOWER bound to an absent amount when emptied, not to a zero', () => {
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                ]),
            }),
            onChange,
        });

        fireEvent.change(lowField(), { target: { value: '' } });

        const next = onChange.mock.calls.at(-1)?.[0] as RecipeFormValues;
        expect(next.ingredients[0]?.quantity).toBeNaN();
    });

    // ⚠️ REVERSED INPUT, same guarantee: an inverted range is now SWAPPED, so the case that still marks
    // both bounds is a range whose upper bound the storage column cannot hold. Lockstep with the web mirror.
    it('marks BOTH bounds invalid and wires them to the alert when a bound is out of range (WCAG 3.3.1)', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Flour',
                        quantity: 2,
                        quantityHigh: 2_000_000,
                    },
                ]),
            }),
            errors: { ingredients: 'ingredientsQuantityInvalid' },
        });

        const alert = screen.getByRole('alert');

        expect(alert.textContent).toContain('above');
        expect(lowField().getAttribute('aria-invalid')).toBe('true');
        expect(lowField().getAttribute('aria-describedby')).toBe(alert.id);
        expect(highField().getAttribute('aria-invalid')).toBe('true');
        expect(highField().getAttribute('aria-describedby')).toBe(alert.id);
    });

    it('marks NEITHER bound on a line whose quantity is absent — absence is not an error', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Butter', quantity: Number.NaN },
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_2',
                        name: 'Flour',
                        quantity: 2,
                        quantityHigh: 2_000_000,
                    },
                ]),
            }),
            errors: { ingredients: 'ingredientsQuantityInvalid' },
        });

        expect(lowField(1).getAttribute('aria-invalid')).toBeNull();
        expect(highField(1).getAttribute('aria-invalid')).toBeNull();
        expect(lowField(2).getAttribute('aria-invalid')).toBe('true');
    });

    it('does NOT mark a quantity on an ingredientsUnresolved error — that error is about the picker', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([{ isUserEntered: false, ingredientId: null, name: 'Flour', quantity: 0 }]),
            }),
            errors: { ingredients: 'ingredientsUnresolved' },
        });

        expect(screen.getByLabelText('Ingredient 1 name').getAttribute('aria-invalid')).toBe('true');
        expect(lowField().getAttribute('aria-invalid')).toBeNull();
    });

    it('discloses that the running total was computed from one bound of a range (R38)', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Flour',
                        quantity: 100,
                        quantityHigh: 200,
                        unit: 'g',
                        foodId: 'cal-364',
                    },
                ]),
            }),
        });

        expect(screen.getByText('Estimated from the lower amount of each stated range')).toBeTruthy();
    });

    it('shows NO range disclosure when no line states a range', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Flour',
                        quantity: 100,
                        unit: 'g',
                        foodId: 'cal-364',
                    },
                ]),
            }),
        });

        expect(screen.queryByText('Estimated from the lower amount of each stated range')).toBeNull();
    });
});

/**
 * U9 — the separator glyph is PUNCTUATION, and the native spelling of "hidden" is the load-bearing part.
 *
 * ⛔ THE REGRESSION THIS CATCHES. `importantForAccessibility="no"` reads as correct RN and produces NO DOM
 * attribute under react-native-web, so the web build would carry a bare dash in its accessibility tree with
 * nothing failing. `aria-hidden` reverse-maps onto RN's own pair on device AND emits the attribute here —
 * the same reasoning `RecipeWidgetSkeleton.native.tsx` records, and the same form the web leaf uses.
 */
describe('the recipe field groups (native) — the range separator is decorative', () => {
    it('hides the separator glyph from the accessibility tree', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2, quantityHigh: 3 },
                ]),
            }),
        });

        const separators = Array.from(document.body.querySelectorAll('[aria-hidden="true"]')).filter(
            (element) => element.textContent === '–',
        );

        expect(separators).toHaveLength(1);
    });
});

/**
 * U25/U26/U27 — the three new ingredient-row affordances on the NATIVE leaf, in every state.
 *
 * ⛔ The cross-platform rule (§14) means these are not "the web tests again": a field that ships to one
 * platform and not the other is precisely what that rule exists to stop, and the two leaves are separate
 * files with no compiler edge between them. The FOLD and the note MAPPING are shared (`props.ts`), so what
 * these prove is that this leaf renders what the shared layer produces.
 */
describe('the recipe field groups (native) — preparation, section and unit class (U25/U26/U27)', () => {
    it('renders a preparation field per line, seeded from the draft', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Onion',
                        quantity: 2,
                        preparation: 'finely chopped',
                    },
                ]),
            }),
        });

        expect(inputValue('Ingredient 1 preparation')).toBe('finely chopped');
    });

    it('renders an EMPTY preparation field for a line that states none', () => {
        renderForm();

        expect(inputValue('Ingredient 1 preparation')).toBe('');
    });

    it('reports a preparation edit upward without touching the food name', () => {
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Onion', quantity: 2 },
                ]),
            }),
            onChange,
        });

        fireEvent.change(screen.getByLabelText('Ingredient 1 preparation'), { target: { value: 'diced' } });

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                ingredients: [
                    {
                        key: seedLineKey(1, 0),
                        ingredientId: 'ing_1',
                        name: 'Onion',
                        quantity: 2,
                        preparation: 'diced',
                        isUserEntered: false,
                    },
                ],
            }),
        );
    });

    it('renders a section field per line, seeded from the draft', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Onion',
                        quantity: 2,
                        groupLabel: 'For the marinade',
                    },
                ]),
            }),
        });

        expect(inputValue('Ingredient 1 section')).toBe('For the marinade');
    });

    it('reports a section edit upward, preserving the line’s other fields', () => {
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Onion',
                        quantity: 2,
                        unit: 'cup',
                        preparation: 'diced',
                    },
                ]),
            }),
            onChange,
        });

        fireEvent.change(screen.getByLabelText('Ingredient 1 section'), { target: { value: 'Dry' } });

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                ingredients: [
                    {
                        key: seedLineKey(1, 0),
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Onion',
                        quantity: 2,
                        unit: 'cup',
                        preparation: 'diced',
                        groupLabel: 'Dry',
                    },
                ],
            }),
        );
    });

    // ⛔ THE NO-CHROME STATE, on the platform where a stray heading costs the most vertical space.
    it('⛔ an UNGROUPED recipe renders NO section heading at all', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Rice', quantity: 300 },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Stock', quantity: 1 },
                ]),
            }),
        });

        expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    });

    it('a GROUPED recipe renders one heading per section, in stored order', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2, groupLabel: 'Dry' },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Sugar', quantity: 1, groupLabel: 'Dry' },
                    { isUserEntered: false, ingredientId: 'ing_3', name: 'Milk', quantity: 1, groupLabel: 'Wet' },
                ]),
            }),
        });

        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
            'Dry',
            'Wet',
        ]);
    });

    it('⛔ a label repeated NON-ADJACENTLY renders THREE headings, in stored order', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2, groupLabel: 'Dry' },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Milk', quantity: 1, groupLabel: 'Wet' },
                    { isUserEntered: false, ingredientId: 'ing_3', name: 'Sugar', quantity: 1, groupLabel: 'Dry' },
                ]),
            }),
        });

        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
            'Dry',
            'Wet',
            'Dry',
        ]);
    });

    it('a MIXED recipe leaves the leading ungrouped run unheaded, and keeps the line numbering', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Salt', quantity: 1 },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Flour', quantity: 2, groupLabel: 'Dry' },
                ]),
            }),
        });

        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Dry']);
        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Salt');
        expect(screen.getByRole('group', { name: 'Ingredient 2 name' }).textContent).toBe('Flour');
    });

    it('marks a CANONICAL unit with no note at all', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Onion', quantity: 2, unit: 'cups' },
                ]),
            }),
        });

        expect(screen.queryByText('Cook’s measure')).toBeNull();
        expect(screen.queryByText('Unrecognised unit')).toBeNull();
    });

    it('marks a SUBJECTIVE unit as a cook’s measure, and describes the field with it', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Basil', quantity: 1, unit: 'handful' },
                ]),
            }),
        });

        const note = screen.getByText('Cook’s measure');

        expect(screen.getByLabelText('Ingredient 1 unit').getAttribute('aria-describedby')).toBe(note.id);
    });

    it('marks an UNKNOWN unit as unrecognised — and still ACCEPTS it', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Onion', quantity: 2, unit: 'blorp' },
                ]),
            }),
        });

        const note = screen.getByText('Unrecognised unit');

        expect(screen.getByLabelText('Ingredient 1 unit').getAttribute('aria-describedby')).toBe(note.id);
        expect(inputValue('Ingredient 1 unit')).toBe('blorp');
    });

    it('marks an EMPTY unit with NO note — a unitless line is not an unrecognised one', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([{ isUserEntered: false, ingredientId: 'ing_1', name: 'Eggs', quantity: 2 }]),
            }),
        });

        expect(screen.queryByText('Unrecognised unit')).toBeNull();
        expect(screen.queryByText('Cook’s measure')).toBeNull();
    });

    /**
     * U35 — the NATIVE half of "capital `T` is a tablespoon, lowercase `t` is a teaspoon".
     *
     * ⛔ §14's cross-platform rule, and it is not ceremony here: the two leaves are separate files with no
     * compiler edge between them, and BOTH derive their unit styling from `classifyUnit` independently. A
     * ruling that landed on web and not on mobile would show the same recipe two different ways.
     *
     * ⚠️ The NOTE was already absent for both spellings before the ruling (the prefix rule withheld it,
     * because `t` begins `teaspoon`), so the note assertions alone cannot see this change — the subdued
     * style is what moved, exactly as on web.
     */
    it.each(['T', 't'])('marks the case-sensitive unit %j as ordinary — no note, no subdued style (U35)', (unit) => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Butter', quantity: 2, unit },
                ]),
            }),
        });

        expect(screen.getByLabelText('Ingredient 1 unit').getAttribute('aria-describedby')).toBeNull();
        expect(inputValue('Ingredient 1 unit')).toBe(unit);
        expect(screen.queryByText('Unrecognised unit')).toBeNull();
        expect(screen.queryByText('Cook’s measure')).toBeNull();
    });

    it('still marks a genuinely unrecognised short unit — the ruling covers T and t, not the alphabet', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Butter', quantity: 2, unit: 'zq' },
                ]),
            }),
        });

        expect(screen.getByLabelText('Ingredient 1 unit').getAttribute('aria-describedby')).toBe(
            screen.getByText('Unrecognised unit').id,
        );
    });
});

/**
 * U27 — the NATIVE half of "typing a section must not cost the cook their caret".
 *
 * ⛔ §14's cross-platform rule is the whole point: the two leaves are separate files with no compiler edge,
 * and the defect is STRUCTURAL (a per-run wrapper makes the section the ancestor of its rows, so the first
 * character of a new label resplits the runs and UNMOUNTS the row holding the focused input). On native
 * that dismisses the keyboard mid-word. Fixing one platform and not the other ships the bug to half the
 * cooks.
 *
 * ⚠️ These assert the RENDER TREE rather than `document.activeElement`: react-native-web reflects focus, but
 * what actually breaks is the row being unmounted and remounted, and the tree is where that is visible on
 * this platform without an emulator.
 */
describe('the recipe field groups (native) — a section resplit does not remount the rows (U27)', () => {
    /** The form's props for the given lines — `render`ed directly so this test can `rerender` in place. */
    const propsFor = (ingredients: RecipeFormValues['ingredients']): FieldGroupsProps => ({
        values: filledValues({ ingredients }),
        onChange: noop,
        ingredientNutrition: CATALOG_NUTRITION,
        ingredientLookupRetry: makeLookupRetry(),
        ingredientRowEditor: ROW_EDITOR,
    });

    it('⛔ keeps the SAME row input across a resplit — the row is never unmounted', () => {
        const { rerender } = render(
            <FieldGroups
                {...propsFor(
                    withLineKeys([
                        { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                        { isUserEntered: false, ingredientId: 'ing_2', name: 'Milk', quantity: 1 },
                        { isUserEntered: false, ingredientId: 'ing_3', name: 'Sugar', quantity: 1 },
                    ]),
                )}
            />,
        );

        const before = screen.getByLabelText('Ingredient 2 section');

        rerender(
            <FieldGroups
                {...propsFor(
                    withLineKeys([
                        { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                        { isUserEntered: false, ingredientId: 'ing_2', name: 'Milk', quantity: 1, groupLabel: 'D' },
                        { isUserEntered: false, ingredientId: 'ing_3', name: 'Sugar', quantity: 1 },
                    ]),
                )}
            />,
        );

        // ⛔ THE SAME DOM NODE. A per-run wrapper would have unmounted this row and mounted a fresh one,
        // which on a device is the keyboard closing after one character.
        expect(screen.getByLabelText('Ingredient 2 section')).toBe(before);
        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['D']);
    });

    it('⛔ CLEARING a section leaves NO empty heading', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Milk', quantity: 1, groupLabel: '' },
                ]),
            }),
        });

        expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    });

    it('⛔ treats a PADDED label as the same section as its trimmed twin', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2, groupLabel: 'Dry' },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Sugar', quantity: 1, groupLabel: '  Dry  ' },
                ]),
            }),
        });

        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Dry']);
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
