// @vitest-environment jsdom
/**
 * Component tests for the NATIVE ingredients field group (plan U28), rendered via react-native-web under
 * jsdom. The one-for-one mirror of `RecipeIngredientsFields.test.tsx` — read that file's doc for what the
 * three proof legs are and why the sweep is stateful. The two leaves are separate files with no compiler
 * edge between them, which is exactly why §14 requires the same assertions on both: a fix applied to one is
 * not applied to the other.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useState, type FC } from 'react';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

// Feather needs the Expo font runtime, absent under jsdom (see `RecipeForm.native.test.tsx` for the full
// rationale). A decorative no-op is enough: the Button primitive hides the glyph from the a11y tree.
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.native.js';
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

describe('RecipeIngredientsFields (native) — the states', () => {
    it('EMPTY: invites the first ingredient', () => {
        renderLeaf({ values: valuesWith([]) });

        expect(screen.getByText(en.noIngredients)).toBeTruthy();
        expect(screen.getByRole('button', { name: en.addIngredient })).toBeTruthy();
    });

    it('POPULATED: renders one row per line, bound to its values', () => {
        renderLeaf({ values: valuesWith([RESOLVED, { ingredientId: 'ing_2', name: 'Stock', quantity: 1 }]) });

        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 1 name').value).toBe('Arborio rice');
        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 2 name').value).toBe('Stock');
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

describe('RecipeIngredientsFields (native) — an unresolved row surfaces its reason (U28)', () => {
    it('names what is missing AND the remedy, with no submit attempt anywhere in sight', () => {
        renderLeaf({ values: valuesWith([UNRESOLVED]) });

        expect(screen.getByText(en.ingredientNoFoodNote)).toBeTruthy();
    });

    it('points the row’s NAME field at that note, and marks it invalid', () => {
        renderLeaf({ values: valuesWith([RESOLVED, UNRESOLVED]) });

        const name = screen.getByLabelText('Ingredient 2 name');

        expect(name.getAttribute('aria-describedby')).toBe(ingredientNoFoodNoteId(1));
        expect(name.getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByText(en.ingredientNoFoodNote).getAttribute('id')).toBe(ingredientNoFoodNoteId(1));
    });

    it('adds the form-level alert id ALONGSIDE the row note when the wizard has refused (both, not either)', () => {
        renderLeaf({ values: valuesWith([UNRESOLVED]), errors: { ingredients: 'ingredientsUnresolved' } });

        expect(screen.getByLabelText('Ingredient 1 name').getAttribute('aria-describedby')).toBe(
            `${ingredientNoFoodNoteId(0)} ${ingredientsErrorId}`,
        );
    });

    it('marks ONLY the unresolved row — a resolved sibling is untouched (WCAG 3.3.1)', () => {
        renderLeaf({ values: valuesWith([RESOLVED, UNRESOLVED]), errors: { ingredients: 'ingredientsUnresolved' } });

        expect(screen.getByLabelText('Ingredient 1 name').getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByLabelText('Ingredient 2 name').getAttribute('aria-invalid')).toBe('true');
        expect(screen.getAllByText(en.ingredientNoFoodNote)).toHaveLength(1);
    });

    it('keeps the row REMOVABLE — the remedy the note names has to exist', () => {
        renderLeaf({ values: valuesWith([UNRESOLVED]) });

        expect(screen.getByRole('button', { name: 'Remove ingredient 1' })).toBeTruthy();
    });
});

describe('RecipeIngredientsFields (native) — the add request (U28)', () => {
    it('asks for the picker and emits no values', () => {
        const onChange = vi.fn();
        const onRequestAddIngredient = vi.fn();
        renderLeaf({ values: valuesWith([]), onChange, onRequestAddIngredient });

        fireEvent.click(screen.getByRole('button', { name: en.addIngredient }));

        expect(onRequestAddIngredient).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('asks again on a second press (it is a request, not a one-shot latch)', () => {
        const onRequestAddIngredient = vi.fn();
        renderLeaf({ values: valuesWith([RESOLVED]), onRequestAddIngredient });

        fireEvent.click(screen.getByRole('button', { name: en.addIngredient }));
        fireEvent.click(screen.getByRole('button', { name: en.addIngredient }));

        expect(onRequestAddIngredient).toHaveBeenCalledTimes(2);
    });
});

/**
 * ⛔ THE CONTROL SWEEP — see the web file's doc. STATEFUL, because the invariant is about the values that
 * come BACK; a `vi.fn()` onChange makes every assertion a tautology about the initial props.
 */
describe('RecipeIngredientsFields (native) — ⛔ no control can create an unresolved row (U28)', () => {
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

    it('survives pressing every button and typing into every field', () => {
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

        for (const input of screen.getAllByRole('textbox')) {
            const label = input.getAttribute('aria-label') ?? '(unlabelled)';
            const before = seen.length;
            fireEvent.change(input, { target: { value: 'typed' } });

            if ((input as HTMLInputElement).readOnly) {
                // A read-only field must ALSO emit nothing — typing into it is a control a cook can reach.
                expect(`${label}: ${seen.length - before} emissions`).toBe(`${label}: 0 emissions`);
                continue;
            }

            invariant(seen[seen.length - 1] ?? initial, `typing into ${label}`);
        }

        for (const button of screen.getAllByRole('button')) {
            const label = button.textContent ?? '(unlabelled)';
            fireEvent.click(button);
            invariant(seen[seen.length - 1] ?? initial, `pressing ${label}`);
        }

        // ⛔ And the list NEVER GREW — the assertion that fails the instant anyone restores the
        // append-an-empty-row button, even if the row they append somehow carried an id.
        for (const values of seen) {
            expect(values.ingredients.length).toBeLessThanOrEqual(initial.ingredients.length);
        }

        expect(seen.length).toBeGreaterThan(0);
    });
});
