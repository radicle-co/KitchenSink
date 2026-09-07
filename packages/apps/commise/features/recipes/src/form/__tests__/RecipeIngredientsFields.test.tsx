// @vitest-environment jsdom
/**
 * Component tests for the WEB ingredients field group (plan U28) — the leaf whose "+ Add ingredient" button
 * used to be a dead end.
 *
 * ⛔ WHAT THIS FILE IS FOR. U28's verification clause is not "the button opens the picker", it is "**no path
 * exists that can create an unresolved row**". Three legs prove that, and this file owns two of them:
 *
 *  1. **Compile time** (`props.test.ts`) — `appendResolvedIngredient` is the form's ONE append transition and
 *     its parameter is `ResolvedRecipeFormIngredient`, so an unresolved line is not a value that can be
 *     passed. `blankIngredient`/`addIngredient`, the only constructors that ever made one, are deleted.
 *  2. **The control sweep, below** — a property test over this leaf's WHOLE control surface: drive every
 *     button and every input on a populated list and assert after each that no line lost its food and the
 *     list never grew. That is the runtime half: whatever a cook can press here, they cannot make one.
 *  3. **Container tests** (both platforms) — the picker path appends a resolved line, with its section
 *     inherited.
 *
 * ⚠️ And its DELIBERATE COUNTERWEIGHT: an unresolved row is still REPRESENTABLE (a restored draft can carry
 * one) and must SURFACE ITS REASON rather than be hidden or silently dropped — the ingredient-entry brief's
 * "Do not design a row that looks complete but is silently discarded". That is the note tests below.
 *
 * ⚠️ STATEFUL where a value feeds back. U25–U27's focus defect was invisible to every existing test because
 * they all passed `vi.fn()` as `onChange`, so nothing a test typed ever came back as a new `values`. The
 * sweep holds real state for exactly that reason.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { RecipeIngredientsFields } from '../RecipeIngredientsFields.js';
import { defaultRecipeFormValues, type RecipeFormErrors, type RecipeFormValues } from '../model.js';
import { ingredientNoFoodNoteId, ingredientsErrorId } from '../fieldErrorIds.js';
import { recipeFormMessages } from '../messages.js';

afterEach(cleanup);

const en = recipeFormMessages.en;
const noop = (): void => undefined;

const valuesWith = (ingredients: RecipeFormValues['ingredients']): RecipeFormValues => ({
    ...defaultRecipeFormValues(),
    ingredients,
});

const RESOLVED = { ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, unit: 'g' } as const;
const UNRESOLVED = { ingredientId: null, name: 'Kale', quantity: 1 } as const;

const renderLeaf = (
    over: {
        values?: RecipeFormValues;
        errors?: RecipeFormErrors;
        onChange?: (next: RecipeFormValues) => void;
        onRequestAddIngredient?: () => void;
    } = {},
) => {
    const onChange = over.onChange ?? noop;
    const onRequestAddIngredient = over.onRequestAddIngredient ?? noop;
    render(
        <RecipeIngredientsFields
            values={over.values ?? valuesWith([RESOLVED])}
            {...(over.errors === undefined ? {} : { errors: over.errors })}
            onChange={onChange}
            onRequestAddIngredient={onRequestAddIngredient}
        />,
    );

    return { onChange, onRequestAddIngredient };
};

describe('RecipeIngredientsFields (web) — the states', () => {
    it('EMPTY: invites the first ingredient instead of rendering an empty table', () => {
        renderLeaf({ values: valuesWith([]) });

        expect(screen.getByText(en.noIngredients)).toBeTruthy();
        expect(screen.queryByRole('listitem')).toBeNull();
        // The add affordance is present even with nothing to add to — that IS the empty state's action.
        expect(screen.getByRole('button', { name: en.addIngredient })).toBeTruthy();
    });

    it('POPULATED: renders one row per line, bound to its values', () => {
        renderLeaf({ values: valuesWith([RESOLVED, { ingredientId: 'ing_2', name: 'Stock', quantity: 1 }]) });

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 name' }).value).toBe('Arborio rice');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 2 name' }).value).toBe('Stock');
    });

    it('GATED: a resolved row wears NO "no food" note', () => {
        renderLeaf({ values: valuesWith([RESOLVED]) });

        expect(screen.queryByText(en.ingredientNoFoodNote)).toBeNull();
    });

    it.each([
        ['ingredientsEmpty' as const, en.errors.ingredientsEmpty],
        ['ingredientsUnresolved' as const, en.errors.ingredientsUnresolved],
        ['ingredientsQuantityInvalid' as const, en.errors.ingredientsQuantityInvalid],
    ])('ERROR: surfaces the %s code as an alert', (code, copy) => {
        renderLeaf({ values: valuesWith([RESOLVED]), errors: { ingredients: code } });

        expect(screen.getByRole('alert').textContent).toContain(copy);
    });

    it('STATUS: renders the resolution badge for a line that carries one', () => {
        renderLeaf({
            values: valuesWith([{ ...RESOLVED, resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW }]),
        });

        expect(screen.getByLabelText('Ingredient 1 status').textContent).toBe(en.statusNeedsReview);
    });
});

/**
 * The RESTORED-DRAFT counterweight. U28 removes every way to CREATE an unresolved row; it deliberately does
 * NOT remove the ability to REPRESENT one, because a draft restored from an older source can hold one and
 * hiding it (or dropping it) is the failure the brief names.
 */
describe('RecipeIngredientsFields (web) — an unresolved row surfaces its reason (U28)', () => {
    it('names what is missing AND the remedy, with no submit attempt anywhere in sight', () => {
        // ⛔ `errors` is deliberately ABSENT. Before U28 the row was marked only once a submit had populated
        // `errors.ingredients`, so on a fresh restore it rendered looking exactly like a complete row.
        renderLeaf({ values: valuesWith([UNRESOLVED]) });

        expect(screen.getByText(en.ingredientNoFoodNote)).toBeTruthy();
    });

    it('points the row’s NAME field at that note, and marks it invalid', () => {
        renderLeaf({ values: valuesWith([RESOLVED, UNRESOLVED]) });

        const name = screen.getByRole('textbox', { name: 'Ingredient 2 name' });

        // ⛔ The row's OWN note id (index 1), never the section's single form-level alert id — a shared id
        // would read row 1's note to a cook standing on row 2.
        expect(name.getAttribute('aria-describedby')).toBe(ingredientNoFoodNoteId(1));
        expect(name.getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByText(en.ingredientNoFoodNote).getAttribute('id')).toBe(ingredientNoFoodNoteId(1));
    });

    it('adds the form-level alert id ALONGSIDE the row note when the wizard has refused (both, not either)', () => {
        renderLeaf({ values: valuesWith([UNRESOLVED]), errors: { ingredients: 'ingredientsUnresolved' } });

        // Mutation guard: an implementation that REPLACED one id with the other would still pass a test that
        // asserted "contains the error id". Both are needed — the alert says the recipe cannot advance, the
        // note says which row and what to do.
        expect(screen.getByRole('textbox', { name: 'Ingredient 1 name' }).getAttribute('aria-describedby')).toBe(
            `${ingredientNoFoodNoteId(0)} ${ingredientsErrorId}`,
        );
    });

    it('marks ONLY the unresolved row — a resolved sibling is untouched (WCAG 3.3.1)', () => {
        renderLeaf({ values: valuesWith([RESOLVED, UNRESOLVED]), errors: { ingredients: 'ingredientsUnresolved' } });

        expect(screen.getByRole('textbox', { name: 'Ingredient 1 name' }).getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Ingredient 2 name' }).getAttribute('aria-invalid')).toBe('true');
        expect(screen.getAllByText(en.ingredientNoFoodNote)).toHaveLength(1);
    });

    it('keeps the row REMOVABLE — the remedy the note names has to exist', () => {
        renderLeaf({ values: valuesWith([UNRESOLVED]) });

        expect(screen.getByRole('button', { name: 'Remove ingredient 1' })).toBeTruthy();
    });
});

describe('RecipeIngredientsFields (web) — the add request (U28)', () => {
    it('asks for the picker and emits no values', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const onRequestAddIngredient = vi.fn();
        renderLeaf({ values: valuesWith([]), onChange, onRequestAddIngredient });

        await user.click(screen.getByRole('button', { name: en.addIngredient }));

        expect(onRequestAddIngredient).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('asks again on a second press (it is a request, not a one-shot latch)', async () => {
        const user = userEvent.setup();
        const onRequestAddIngredient = vi.fn();
        renderLeaf({ values: valuesWith([RESOLVED]), onRequestAddIngredient });

        await user.click(screen.getByRole('button', { name: en.addIngredient }));
        await user.click(screen.getByRole('button', { name: en.addIngredient }));

        expect(onRequestAddIngredient).toHaveBeenCalledTimes(2);
    });
});

/**
 * ⛔ THE CONTROL SWEEP — the runtime half of "no path exists that can create an unresolved row".
 *
 * It is a PROPERTY test, not a scenario: it enumerates this leaf's whole interactive surface from the
 * rendered DOM (so a control added later is swept automatically, rather than needing someone to remember)
 * and asserts the invariant after every single interaction. STATEFUL, because the invariant is about the
 * values that come BACK — a `vi.fn()` onChange would make every assertion a tautology about the initial
 * props, which is exactly how U25–U27's focus defect stayed invisible.
 */
describe('RecipeIngredientsFields (web) — ⛔ no control can create an unresolved row (U28)', () => {
    const Harness: FC<{ initial: RecipeFormValues; seen: RecipeFormValues[] }> = ({ initial, seen }) => {
        const [values, setValues] = useState(initial);

        return (
            <RecipeIngredientsFields
                values={values}
                onChange={(next) => {
                    seen.push(next);
                    setValues(next);
                }}
                onRequestAddIngredient={noop}
            />
        );
    };

    it('survives pressing every button and typing into every field', async () => {
        const user = userEvent.setup();
        const seen: RecipeFormValues[] = [];
        const initial = valuesWith([
            { ingredientId: 'ing_1', name: 'Flour', quantity: 200, unit: 'g', groupLabel: 'Dry' },
            { ingredientId: 'ing_2', name: 'Water', quantity: 1, unit: 'cup' },
        ]);
        render(<Harness initial={initial} seen={seen} />);

        /** Asserts the invariant, naming the interaction that broke it (a bare boolean says nothing useful). */
        const invariant = (values: RecipeFormValues, step: string): void => {
            const unresolved = values.ingredients
                .map((line, index) => ({ number: index + 1, id: line.ingredientId }))
                .filter((entry) => entry.id === null || entry.id === '');

            expect(`${step}: ${JSON.stringify(unresolved)}`).toBe(`${step}: []`);
        };

        // Every text/number input the leaf renders, driven with real text that feeds back through state.
        for (const input of screen.getAllByRole('textbox')) {
            const label = input.getAttribute('aria-label') ?? '(unlabelled)';

            if ((input as HTMLInputElement).readOnly) {
                // A read-only field must ALSO emit nothing — typing into it is a control a cook can reach.
                const before = seen.length;
                await user.click(input);
                await user.paste('typed');
                expect(`${label}: ${seen.length - before} emissions`).toBe(`${label}: 0 emissions`);
                continue;
            }

            await user.click(input);
            await user.paste('x');
            invariant(seen[seen.length - 1] ?? initial, `typing into ${label}`);
        }

        for (const input of screen.getAllByRole('spinbutton')) {
            const label = input.getAttribute('aria-label') ?? '(unlabelled)';
            await user.clear(input);
            await user.type(input, '7');
            invariant(seen[seen.length - 1] ?? initial, `typing into ${label}`);
        }

        // Every button — Add ingredient, and both rows' Remove.
        for (const button of screen.getAllByRole('button')) {
            const label = button.textContent ?? '(unlabelled)';
            await user.click(button);
            invariant(seen[seen.length - 1] ?? initial, `pressing ${label}`);
        }

        // ⛔ And the list NEVER GREW. This is the assertion that fails the instant anyone restores the
        // append-an-empty-row button, even if the row they append somehow carried an id.
        for (const values of seen) {
            expect(values.ingredients.length).toBeLessThanOrEqual(initial.ingredients.length);
        }

        // The sweep actually swept something — a harness that rendered no controls would pass vacuously.
        expect(seen.length).toBeGreaterThan(0);
    });
});
