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
 * it. The wizard's own chrome is covered by `wizard/__tests__/Wizard.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { RecipeIngredientsFields } from '../RecipeIngredientsFields.js';
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

describe('the recipe field groups (web) — the row\u2019s status glyph inside a form (plan 002 V1)', () => {
    /** Regression pin: a host may hold the groups in a `<form>`, where a button with no `type` submits it. */
    it('opening and closing a row\u2019s explanation never submits a form around the group', async () => {
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

        await user.click(screen.getByRole('button', { name: 'About Kale' }));
        await user.click(screen.getByRole('button', { name: 'Close details for Kale' }));

        expect(onSubmit).not.toHaveBeenCalled();
    });
});

describe('the recipe field groups (web) — B8 error accessibility wiring (aria-invalid + aria-describedby)', () => {
    /**
     * REWRITTEN for U9, and SPLIT in two — one test per error code.
     *
     * The original rendered ONE `ingredientsUnresolved` error over a list holding both an unresolved line
     * and a zero-quantity line, and asserted that each control was marked. That was only ever coherent
     * because the two failures shared a code and a sentence; U9 gave them their own, so a form showing "every
     * ingredient needs an item picked from the list" must NOT mark a quantity field — pointing a user at a
     * control the message is not about is the WCAG 3.3.1 failure this suite exists to catch, not a smaller
     * version of satisfying it. The property proved is unchanged and now sharper: only the offending
     * control(s) on the offending line(s) are wired to the alert.
     */
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

        // B7: an entry field has its own (empty) assertive region, so the section alert is found by its words.
        const alert = screen.getByText(recipeFormMessages.en.errors.ingredientsUnresolved);

        // Line 1 — the unresolved name is the offending control.
        //
        // ⚠️ WIDENED BY U28 (was `toBe(alert.id)`): the field is now described by its OWN "no food chosen"
        // note as well as the section alert. The property this test proves is unchanged — the offending
        // control is wired to the alert — and is now sharper, because the row also says which row and what
        // to do. Asserting the alert id is still REACHED (rather than dropping the assertion) is the point.
        // B7: a line with no food is an entry field, so its name is a combobox.
        expect(screen.getByRole('combobox', { name: 'Ingredient 1 name' }).getAttribute('aria-invalid')).toBe('true');
        expect(
            screen.getByRole('combobox', { name: 'Ingredient 1 name' }).getAttribute('aria-describedby')?.split(' '),
        ).toContain(alert.id);
        expect(
            screen.getByRole('spinbutton', { name: 'Ingredient 1 quantity' }).getAttribute('aria-invalid'),
        ).toBeNull();

        // Line 2 — resolved, so nothing is marked, INCLUDING its zero quantity: this alert is not about it.
        expect(screen.getByRole('group', { name: 'Ingredient 2 name' }).getAttribute('aria-invalid')).toBeNull();
        expect(
            screen.getByRole('spinbutton', { name: 'Ingredient 2 quantity' }).getAttribute('aria-invalid'),
        ).toBeNull();

        // Line 3: fully valid — neither input marked invalid.
        expect(screen.getByRole('group', { name: 'Ingredient 3 name' }).getAttribute('aria-invalid')).toBeNull();
        expect(
            screen.getByRole('spinbutton', { name: 'Ingredient 3 quantity' }).getAttribute('aria-invalid'),
        ).toBeNull();
    });

    // ⚠️ The offending input is a bound outside the wire's storage range, not a typed `0`: the 2026-09-12
    // ruling normalises `0` to "no amount", which is submittable, so the range is the one remaining cause.
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

        const alert = shownAlert();

        expect(screen.getByRole('spinbutton', { name: 'Ingredient 1 quantity' }).getAttribute('aria-invalid')).toBe(
            'true',
        );
        expect(screen.getByRole('spinbutton', { name: 'Ingredient 1 quantity' }).getAttribute('aria-describedby')).toBe(
            alert.id,
        );
        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).getAttribute('aria-invalid')).toBeNull();
        expect(
            screen.getByRole('spinbutton', { name: 'Ingredient 2 quantity' }).getAttribute('aria-invalid'),
        ).toBeNull();
    });

    it('does not mark any ingredient line invalid on an ingredientsEmpty error (no lines exist)', () => {
        renderForm({ values: filledValues({ ingredients: [] }), errors: { ingredients: 'ingredientsEmpty' } });

        expect(shownAlert()).toBeTruthy();
        // No row in any mode: a matched name is a group (§3b) and an entry name a combobox, and neither is here.
        expect(screen.queryByLabelText(/^Ingredient \d+ name$/)).toBeNull();
    });
});

describe('the recipe field groups (web) — ingredients', () => {
    it('shows the empty state when there are no ingredient lines', () => {
        renderForm({ values: filledValues({ ingredients: [] }) });

        expect(screen.getByText('No ingredients yet. Add your first ingredient.')).toBeTruthy();
    });

    it('renders name, quantity, and unit for each ingredient line', () => {
        renderForm();

        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Arborio rice');
        expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Ingredient 1 quantity' }).value).toBe('300');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 unit' }).value).toBe('g');
    });

    /**
     * REWRITTEN for §3b (`ingredientStatusExplanation.md`): a resolved name was a read-only textbox, which announced a
     * control the cook could not use (4.1.2). It is text in a group named for its row now, so no control holds it.
     */
    it('renders a RESOLVED line’s name as text no control holds (bound to its ingredientId, cannot drift; U6)', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300 },
                ]),
            }),
        });

        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Arborio rice');
        expect(screen.queryByRole('textbox', { name: 'Ingredient 1 name' })).toBeNull();
        expect(screen.queryByRole('combobox', { name: 'Ingredient 1 name' })).toBeNull();
    });

    /**
     * REWRITTEN for U28 (was: "keeps an UNRESOLVED line’s name editable ... U6").
     *
     * U6 kept an unresolved line's name editable on the reasoning that it was "the freeform search text, not
     * yet a resolved identity". That premise died with the blank-row button: a line resolves ONLY through the
     * picker, so typing into this field could never produce an id, and `toCreateRecipeInput` dropped the row
     * whatever it said. It was dead UI dressed as a working control — the ingredient-entry brief's "It is
     * filled from the picker below … never typed over", and its "row that looks complete but is silently
     * discarded", one layer down.
     */
    /**
     * REWRITTEN for plan 002 V1 B7 (`ingredientStatusExplanation.md` §2b): the name field IS the picker, so a line with
     * no food is an ENTRY field again. U28's premise, that typing here could never produce an id, is gone: typing now
     * drives the lookup that produces it. Half 2 of U28 still holds, below: the text is the entry's, never the line's.
     */
    it('renders an UNRESOLVED line’s name as an ENTRY field, showing the text the cook wrote (§2b)', () => {
        const lines = withLineKeys([{ isUserEntered: false, ingredientId: null, name: 'rice', quantity: 1 }]);
        renderForm({
            values: filledValues({ ingredients: lines }),
            ingredientRowEditor: makeIngredientRowEditor({ entry: makeRestingIngredientEntry(lines) }),
        });

        expect(screen.getByRole<HTMLInputElement>('combobox', { name: 'Ingredient 1 name' }).value).toBe('rice');
        expect(screen.queryByRole('group', { name: 'Ingredient 1 name' })).toBeNull();
    });

    /**
     * U28, kept by plan 002 V1 B8: the trailing add row is an entry field whose text is the row editor's, so typing in it
     * changes no values. A line enters the draft only through a pick.
     */
    it('⛔ typing in the trailing add row changes no values (U28, B8)', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ values: filledValues({ ingredients: [] }), onChange });

        await user.type(screen.getByRole('combobox', { name: 'Add an ingredient' }), 'flour');

        expect(onChange).not.toHaveBeenCalled();
    });

    /**
     * REWRITTEN: Remove names its line by KEY through the host's draft transition (`DraftAction` `removeIngredient`),
     * which meets the draft as it is when it lands, so the remaining line keeps its identity by construction.
     */
    it('removes the targeted ingredient line, by its key, through the host’s draft transition', async () => {
        const user = userEvent.setup();
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
        await user.click(screen.getByRole('button', { name: 'Actions for Rice' }));
        await user.click(screen.getByRole('menuitem', { name: 'Remove ingredient' }));

        expect(dispatch).toHaveBeenCalledExactlyOnceWith({ kind: 'removeIngredient', key: seedLineKey(1, 0) });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does NOT let a resolved line’s name be edited (typing into it emits nothing; U6 data-integrity)', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300 },
                ]),
            }),
            onChange,
        });

        // REWRITTEN for §3b: the name is text, so a press and a paste on it reach no field.
        const name = screen.getByRole('group', { name: 'Ingredient 1 name' });
        await user.click(name);
        await user.paste('Carnaroli rice');

        // The resolved name never drifts from its ingredientId, so no change is ever reported.
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Arborio rice');
    });

    /**
     * REWRITTEN for U28 (was: "reports an UNRESOLVED line’s name edit upward ... U6") — the inverse
     * assertion, for the reason recorded on the read-only test above. Typing a name could never resolve the
     * line, so reporting the edit upward only produced text the wire mapper threw away.
     */
    /**
     * REWRITTEN for B7: typing into the entry field goes to the hoisted entry, which keeps the text per field; it never
     * reaches `values`, so U28's half 2 (no path creates an unresolved row) holds (§4b).
     */
    it('emits NOTHING when an unresolved line’s name is typed into: the text goes to the entry (U28, §4b)', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const setText = vi.fn();
        const lines = withLineKeys([{ isUserEntered: false, ingredientId: null, name: 'ric', quantity: 1 }]);
        renderForm({
            values: filledValues({ ingredients: lines }),
            onChange,
            ingredientRowEditor: makeIngredientRowEditor({ entry: makeRestingIngredientEntry(lines, { setText }) }),
        });

        await user.click(screen.getByRole('combobox', { name: 'Ingredient 1 name' }));
        await user.keyboard('e');

        expect(onChange).not.toHaveBeenCalled();
        expect(setText).toHaveBeenCalledWith({ kind: 'line', key: lines[0]?.key }, 'rice');
    });

    it('keeps a resolved line’s identity + nutrition when its quantity/unit changes (U6)', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    {
                        isUserEntered: false,
                        ingredientId: 'ing_1',
                        name: 'Arborio rice',
                        quantity: 300,
                        unit: 'g',
                        foodId: 'cal-130',
                    },
                ]),
            }),
            onChange,
        });

        const quantity = screen.getByRole('spinbutton', { name: 'Ingredient 1 quantity' });
        await user.tripleClick(quantity);
        await user.paste('250');

        const next = onChange.mock.calls[0]?.[0] as RecipeFormValues;
        const line = next.ingredients[0];
        expect(line?.quantity).toBe(250);
        // Identity + resolved nutrition are untouched by a quantity edit.
        expect(line?.ingredientId).toBe('ing_1');
        expect(line?.name).toBe('Arborio rice');
        expect(line?.foodId).toBe('cal-130');
    });

    it('parses an ingredient quantity change to a number', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ onChange });

        // tripleClick() + paste() — see the Basics "reports a title edit upward" test for why (controlled
        // field, inert mock, no rerender between keystrokes).
        const quantity = screen.getByRole('spinbutton', { name: 'Ingredient 1 quantity' });
        await user.tripleClick(quantity);
        await user.paste('250');

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ ingredients: [expect.objectContaining({ quantity: 250 })] }),
        );
    });

    it.each([
        [FoodResolutionStatus.PENDING, 'Resolving…'],
        [FoodResolutionStatus.UNRESOLVED, 'Not resolved'],
        [FoodResolutionStatus.NOT_FOUND, 'No match found'],
        [FoodResolutionStatus.FAILED, 'Resolution failed'],
        // ⚠️ EXTENDED for U14, not rewritten: the union gained a sixth member, and a table that only covers
        // the five it had when it was written is a totality claim that stopped being true.
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
        expect(screen.queryByText('Resolving…')).toBeNull();
    });

    /**
     * A doubted line (and a withdrawn food) wears the caution chip; every other status word stays neutral
     * (`namelessLineCopy.md` §2c). Compared against the OTHER statuses rather than a literal, so it pins the
     * DISTINCTION rather than today's palette. ⚠️ EDITED for plan 002 V1: `RESOLVED` left the comparison set because a
     * matched row shows no status word at all (SPECIFY.1 rows 3-4); `FOOD_REMOVED` joined the caution side, which the
     * spec names beside `NEEDS_REVIEW`.
     */
    it('⛔ styles the NEEDS_REVIEW badge differently from every other status (U14)', () => {
        const classOf = (status: (typeof FoodResolutionStatus)[keyof typeof FoodResolutionStatus]): string => {
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

            // UI-overhaul slice 2: the badge's words sit in a span inside it, so its look is on the parent.
            return (
                screen.getByText(resolutionStatusLabel(recipeFormMessages.en, status)).parentElement?.className ?? ''
            );
        };

        const review = classOf(FoodResolutionStatus.NEEDS_REVIEW);

        expect(classOf(FoodResolutionStatus.FOOD_REMOVED)).toBe(review);

        for (const other of [
            FoodResolutionStatus.PENDING,
            FoodResolutionStatus.PENDING_VERIFICATION,
            FoodResolutionStatus.UNRESOLVED,
            FoodResolutionStatus.AMBIGUOUS,
            FoodResolutionStatus.NOT_FOUND,
            FoodResolutionStatus.FAILED,
        ] as const) {
            expect(review).not.toBe(classOf(other));
        }
    });
});

/**
 * EDITED for plan 002 V1 B5. The per-row calorie chip is GONE (plan 002 R30: calories live in the row's nutrition
 * panel), so its three tests here and its contrast test were deleted; that coverage moved to the panel tests in
 * `RecipeIngredientsFields.test.tsx` and to `nutritionPanel.test.ts`. The total tests stay, now fed by the editor's
 * nutrition read: each catalog line names a food (`cal-N`) that `CATALOG_NUTRITION` answers with N kcal per 100 g.
 */
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

describe('the recipe field groups (web) — every action button carries an icon and a real surface (mockup parity)', () => {
    // The mockups pair every button with an icon and give it a visible surface; the old form rendered its
    // add/remove/cancel actions as naked text. Each action button must (1) keep its exact accessible name —
    // so Playwright/RTL name selection and the create/edit contracts are unchanged — (2) render a decorative
    // icon hidden from the accessibility tree, and (3) sit on a real button surface (not bare text).
    const actionButtonNames = ['Remove ingredient 1'] as const;

    // B7: Remove is a direct control only on a row with one action (§3a), so these rows are still looking up their food.
    const pending = () =>
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

    it.each(actionButtonNames)('renders "%s" with a decorative, accessibility-hidden icon', (name) => {
        pending();

        const button = screen.getByRole('button', { name });
        const icon = button.querySelector('svg');
        expect(icon).not.toBeNull();
        // The glyph is decorative: hidden from assistive tech so the label alone is the accessible name.
        expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('gives each action button a real visible surface (a fill or a border), never naked text', () => {
        pending();

        // Destructive remove actions carry the danger label (UI-overhaul slice 2: the `danger` roles).
        for (const name of ['Remove ingredient 1'] as const) {
            expect(screen.getByRole('button', { name }).className).toContain('text-danger-text');
        }
    });

    it('collapses the cramped remove controls to icon-only at base, keeping the label from sm (U5)', () => {
        pending();

        // At 360px the ingredient/step rows are too tight for a text remove button, so its label is visually
        // hidden at base (`sr-only`) and restored from `sm:` (`sm:not-sr-only`) — icon-only on phones. The
        // label text stays in the accessibility tree, so the button's accessible name is unchanged (these very
        // `getByRole({ name })` lookups still resolve) and desktop shows the full label as before.
        for (const name of ['Remove ingredient 1'] as const) {
            const label = screen.getByText(name);
            expect(label.className).toContain('sr-only');
            expect(label.className).toContain('sm:not-sr-only');
            // Still the accessible name of a real button — not lost to assistive tech.
            expect(screen.getByRole('button', { name })).toBe(label.closest('button'));
        }
    });
});

describe('the recipe field groups (web) — an ingredient row cannot push its remove action off the screen edge', () => {
    it('lets the ingredient name yield width, and the row wrap', () => {
        renderForm();

        expect(screen.getByLabelText('Ingredient 1 name').className).toContain('min-w-0');
        expect(screen.getByLabelText('Ingredient 1 name').parentElement?.className).toContain('flex-wrap');
    });
});

/**
 * U9 / R42 — the two-bound quantity field.
 *
 * One ingredient line now offers a lower and an upper numeric input sharing a single unit field. Every
 * state the pair can be in is covered here, not just the exact one: a single value, a stated range, no
 * amount at all, and each incoherent pair that must block submission. The native suite asserts the same
 * list, so the two platforms cannot diverge on what a range looks like or on which control is marked.
 */
describe('the recipe field groups (web) — ranged quantity (U9/R42)', () => {
    const lowField = (number = 1) =>
        screen.getByRole<HTMLInputElement>('spinbutton', { name: `Ingredient ${number} quantity` });
    const highField = (number = 1) =>
        screen.getByRole<HTMLInputElement>('spinbutton', { name: `Ingredient ${number} maximum quantity` });

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
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 unit' }).value).toBe('cups');
    });

    it('leaves the upper bound EMPTY for a single stated value', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                ]),
            }),
        });

        expect(lowField().value).toBe('2');
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

    it('states an upper bound when the user types one', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                ]),
            }),
            onChange,
        });

        await user.type(highField(), '3');

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

    it('CLEARS the upper bound back to a single value when the field is emptied', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2, quantityHigh: 3 },
                ]),
            }),
            onChange,
        });

        await user.clear(highField());

        const next = onChange.mock.calls.at(-1)?.[0] as RecipeFormValues;
        expect('quantityHigh' in (next.ingredients[0] ?? {})).toBe(false);
    });

    it('clears the LOWER bound to an absent amount when emptied, not to a zero', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                ]),
            }),
            onChange,
        });

        await user.clear(lowField());

        const next = onChange.mock.calls.at(-1)?.[0] as RecipeFormValues;
        expect(next.ingredients[0]?.quantity).toBeNaN();
    });

    // ⚠️ NOT an inverted range, which the 2026-09-12 ruling SWAPS rather than refuses. The case that marks
    // both bounds is a range whose upper
    // bound the storage column cannot hold — which is exactly why the gate composes the wire's own union
    // rather than checking the lower bound alone.
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

        const alert = shownAlert();

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

        // B7: a line with no food is an entry field, so its name is a combobox.
        expect(screen.getByRole('combobox', { name: 'Ingredient 1 name' }).getAttribute('aria-invalid')).toBe('true');
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
 * U9 — the glyph between the two bounds is PUNCTUATION, and must not reach assistive tech.
 *
 * Its own test on both platforms because the two spell "hidden" differently and the native spelling has a
 * known trap: react-native-web translates RN's legacy `importantForAccessibility` pair to NO DOM attribute,
 * so a leaf written that way ships a bare dash into the accessibility tree on the web build while looking
 * correct in review (see `RecipeWidgetSkeleton.native.tsx`'s note).
 */
describe('the recipe field groups (web) — the range separator is decorative', () => {
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
 * U25/U26/U27 — the three new ingredient-row affordances on the WEB leaf, in every state.
 *
 * ⛔ THE STATE THAT MUST NOT REGRESS is the ungrouped one. Most recipes will never use a section, and the
 * brief is explicit that grouping "has to feel like something a cook reaches for when a recipe needs it,
 * never a step every recipe has to satisfy" — so an ungrouped list renders with NO section chrome at all,
 * and that is asserted here rather than assumed.
 */
describe('the recipe field groups (web) — preparation, section and unit class (U25/U26/U27)', () => {
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

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 preparation' }).value).toBe(
            'finely chopped',
        );
    });

    it('renders an EMPTY preparation field for a line that states none', () => {
        renderForm();

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 preparation' }).value).toBe('');
    });

    it('reports a preparation edit upward without touching the food name', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Onion', quantity: 2 },
                ]),
            }),
            onChange,
        });

        await user.type(screen.getByRole('textbox', { name: 'Ingredient 1 preparation' }), 'd');

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                ingredients: [
                    {
                        key: seedLineKey(1, 0),
                        ingredientId: 'ing_1',
                        name: 'Onion',
                        quantity: 2,
                        preparation: 'd',
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

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 section' }).value).toBe(
            'For the marinade',
        );
    });

    it('reports a section edit upward, preserving the line’s other fields', async () => {
        const user = userEvent.setup();
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

        await user.type(screen.getByRole('textbox', { name: 'Ingredient 1 section' }), 'D');

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
                        groupLabel: 'D',
                    },
                ],
            }),
        );
    });

    // ⛔ THE NO-CHROME STATE. A heading rendered here would make every ordinary recipe look unfinished.
    it('⛔ an UNGROUPED recipe renders NO section heading at all', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Rice', quantity: 300 },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Stock', quantity: 1 },
                ]),
            }),
        });

        // `level: 3` is the section-heading level; the section's own `h2` ("Ingredients") is unaffected.
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

    // ⛔ Folding by label identity would show TWO headings and reorder the lines. The recipe's own order wins.
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

    // A MIXED recipe: the leading ungrouped run gets no heading, and the numbering still addresses the
    // ORIGINAL line index — a section-relative index would edit the wrong row while looking correct.
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

    /**
     * U25 — the unit is MARKED by kind, and the marking is DERIVED at render from `classifyUnit`, never
     * stored. Three outcomes, and the third is not an error: an unknown unit is ACCEPTED, never rejected.
     *
     * ⛔ The mark is TEXT, not colour. The Figma Make mockup distinguishes a recognised unit from an
     * unrecognised one by styling alone (seafoam medium vs italic slate), which is WCAG 1.4.1's exact
     * failure — "colour alone" — and it also cannot tell a deliberate `handful` from a mistyped `blorp`,
     * which is the whole distinction U25 exists to draw. A short localized note, wired through
     * `aria-describedby`, says it in words.
     */
    it('marks a CANONICAL unit with no note at all — the ordinary line stays quiet', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Onion', quantity: 2, unit: 'cups' },
                ]),
            }),
        });

        expect(screen.queryByText('Cook’s measure')).toBeNull();
        expect(screen.queryByText('Unrecognised unit')).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Ingredient 1 unit' }).getAttribute('aria-describedby')).toBeNull();
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
        const unit = screen.getByRole('textbox', { name: 'Ingredient 1 unit' });

        expect(unit.getAttribute('aria-describedby')).toBe(note.id);
        expect(unit.getAttribute('aria-invalid')).toBeNull();
    });

    it('marks an UNKNOWN unit as unrecognised — and still ACCEPTS it, never flagging it invalid', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Onion', quantity: 2, unit: 'blorp' },
                ]),
            }),
        });

        const note = screen.getByText('Unrecognised unit');
        const unit = screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 unit' });

        expect(unit.getAttribute('aria-describedby')).toBe(note.id);
        // ⛔ Accepted, never rejected: the value is still the cook's, and nothing marks the field invalid.
        expect(unit.value).toBe('blorp');
        expect(unit.getAttribute('aria-invalid')).toBeNull();
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
     * U35 — `T` and `t` render as ORDINARY units now (owner ruling, 2026-08-25).
     *
     * ⛔ THIS IS A GENUINELY NEW RENDERED STATE, which is why it is asserted at the component tier and not
     * only in `props.test.ts`. `classifyUnit` answered `unknown` for both spellings before the ruling, and
     * this leaf styles the unit field from that verdict — so a capital `T` wore the unrecognised styling,
     * while `unitClassNote` withheld the NOTE because `t` is a prefix of `teaspoon`. The row said one thing
     * in colour and another in words. Both now agree that it is an ordinary unit.
     *
     * ⛔ The value is asserted BYTE-FOR-BYTE. The cook's `T` must survive into the field: canonicalising for
     * a verdict must never rewrite what they typed.
     */
    it.each(['T', 't'])('marks the case-sensitive unit %j as ordinary — styled and worded alike (U35)', (unit) => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Butter', quantity: 2, unit },
                ]),
            }),
        });

        const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 unit' });

        // ⛔ THE ASSERTION THAT ACTUALLY WENT RED. The note was already absent before the ruling (the
        // prefix rule withheld it, because `t` begins `teaspoon`), so only the STYLING can see the change:
        // the field wore `text-ink-muted italic` — the unrecognised look — while saying nothing was wrong.
        expect(field.className).toContain('text-ink');
        expect(field.className).not.toContain('italic');
        // The cook's spelling survives byte-for-byte: canonicalising for a verdict never rewrites the field.
        expect(field.value).toBe(unit);
        expect(field.getAttribute('aria-describedby')).toBeNull();
        expect(field.getAttribute('aria-invalid')).toBeNull();
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

        const field = screen.getByRole('textbox', { name: 'Ingredient 1 unit' });

        expect(field.getAttribute('aria-describedby')).toBe(screen.getByText('Unrecognised unit').id);
        expect(field.className).toContain('italic');
    });

    // ⛔ Two lines, two different units, ONE render: each note describes ITS OWN row. A shared id would make
    // every unit field point at the first row's note — the defect `fieldErrorIds` exists to avoid.
    it('scopes each unit note to its own row', () => {
        renderForm({
            values: filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Basil', quantity: 1, unit: 'handful' },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Onion', quantity: 2, unit: 'blorp' },
                ]),
            }),
        });

        const first = screen.getByRole('textbox', { name: 'Ingredient 1 unit' }).getAttribute('aria-describedby');
        const second = screen.getByRole('textbox', { name: 'Ingredient 2 unit' }).getAttribute('aria-describedby');

        expect(first).not.toBe(second);
        expect(screen.getByText('Cook’s measure').id).toBe(first);
        expect(screen.getByText('Unrecognised unit').id).toBe(second);
    });
});

/**
 * U27 — TYPING A SECTION LABEL MUST NOT COST THE COOK THEIR CARET.
 *
 * ⛔ THE DEFECT THIS EXISTS FOR, and why nothing else could see it. Every other test in this file drives
 * `onChange` with a `vi.fn()` that never feeds the next `values` back, so the component never re-renders
 * against the edit and the section runs never RESPLIT. This one is STATEFUL — it applies each `onChange`
 * and re-renders, which is what the real editor does — and that is the only way the bug is reachable.
 *
 * The bug: `ingredientSections` folds by consecutive run, so the first character typed into row 2's section
 * field turns one run into three. If the leaf renders a WRAPPER per run, React matches the first wrapper by
 * key and reconciles its `<ul>` from three `<li>`s down to one — UNMOUNTING the `<li>` that holds the
 * focused input. The caret disappears after one character and every later keystroke goes nowhere. The fix
 * is structural: one flat `<ul>` with headings interleaved, so a resplit only INSERTS a heading beside a row
 * that never leaves its parent.
 */
describe('the recipe field groups (web) — typing a section keeps focus (U27)', () => {
    /** Render the form as the real editor does: every `onChange` is applied and re-rendered. */
    const renderStateful = (initial: RecipeFormValues) => {
        const Harness: FC = () => {
            const [values, setValues] = useState(initial);

            return (
                <FieldGroups
                    values={values}
                    onChange={setValues}
                    ingredientNutrition={CATALOG_NUTRITION}
                    ingredientLookupRetry={makeLookupRetry()}
                    ingredientRowEditor={ROW_EDITOR}
                />
            );
        };

        return render(<Harness />);
    };

    const THREE_UNGROUPED = filledValues({
        ingredients: withLineKeys([
            { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
            { isUserEntered: false, ingredientId: 'ing_2', name: 'Milk', quantity: 1 },
            { isUserEntered: false, ingredientId: 'ing_3', name: 'Sugar', quantity: 1 },
        ]),
    });

    it('⛔ keeps the caret in the section field across SEVERAL characters', async () => {
        const user = userEvent.setup();
        renderStateful(THREE_UNGROUPED);

        const section = screen.getByRole('textbox', { name: 'Ingredient 2 section' });
        await user.click(section);
        await user.keyboard('Dry');

        // ⛔ Re-query: the assertion is about the LIVE document, and a stale node reference would pass even
        // if the input had been unmounted and replaced.
        const live = screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 2 section' });

        expect(live.value).toBe('Dry');
        expect(document.activeElement).toBe(live);
    });

    it('renders the heading the typing created, without moving any line', async () => {
        const user = userEvent.setup();
        renderStateful(THREE_UNGROUPED);

        await user.click(screen.getByRole('textbox', { name: 'Ingredient 2 section' }));
        await user.keyboard('Dry');

        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Dry']);
        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Flour');
        expect(screen.getByRole('group', { name: 'Ingredient 2 name' }).textContent).toBe('Milk');
        expect(screen.getByRole('group', { name: 'Ingredient 3 name' }).textContent).toBe('Sugar');
    });

    // ⛔ F2's half: clearing a label must REJOIN the run above, not leave an empty heading behind.
    it('⛔ CLEARING a section leaves NO empty heading, and rejoins the ungrouped run', async () => {
        const user = userEvent.setup();
        renderStateful(
            filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Milk', quantity: 1, groupLabel: 'Wet' },
                ]),
            }),
        );

        expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);

        await user.clear(screen.getByRole('textbox', { name: 'Ingredient 2 section' }));

        expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    });

    // ⛔ The other half of the trim rule, at the DRAFT layer where the wire's `.trim()` has not run: two
    // labels differing only by padding are ONE section, not two headings a reader cannot tell apart.
    it('⛔ treats a PADDED label as the same section as its trimmed twin', () => {
        renderStateful(
            filledValues({
                ingredients: withLineKeys([
                    { isUserEntered: false, ingredientId: 'ing_1', name: 'Flour', quantity: 2, groupLabel: 'Dry' },
                    { isUserEntered: false, ingredientId: 'ing_2', name: 'Sugar', quantity: 1, groupLabel: '  Dry  ' },
                ]),
            }),
        );

        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Dry']);
    });
});
