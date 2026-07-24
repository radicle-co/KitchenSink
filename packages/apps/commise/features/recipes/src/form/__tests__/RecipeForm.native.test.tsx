/**
 * Native component tests for the recipe create/edit form (T067), rendered via react-native-web under jsdom.
 * Mirrors the web leaf across EVERY branch — mode-driven headings + submit copy, all Basics fields, the
 * READ-ONLY computed total, dynamic ingredient/step add/remove/change, EVERY resolution-status badge, each
 * validation error, the submitting (disabled) state, the visibility toggle, and submit/cancel — so the two
 * platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { CUISINES, FoodResolutionStatus } from '@kitchensink/recipe-core';

// The native leaf renders its button glyphs via `@expo/vector-icons` (Feather), which needs the Expo font
// runtime — absent under jsdom. Stub it to a decorative no-op; the Button primitive hides the icon from the
// accessibility tree regardless, so what Feather draws is irrelevant to these behavioural/a11y assertions.
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeForm } from '../RecipeForm.native.js';
import { DESCRIPTION_MAX_LENGTH, defaultRecipeFormValues, TITLE_MAX_LENGTH, type RecipeFormValues } from '../model.js';
import type { RecipeFormProps } from '../props.js';

afterEach(cleanup);

const noop = () => undefined;

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
    ingredients: [{ ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, unit: 'g' }],
    steps: [{ instruction: 'Toast the rice.', timerSeconds: 120 }],
    ...over,
});

function renderForm(overrides: Partial<RecipeFormProps> = {}) {
    const props: RecipeFormProps = {
        values: filledValues(),
        mode: 'create',
        onChange: noop,
        onSubmit: noop,
        onCancel: noop,
        ...overrides,
    };
    render(<RecipeForm {...props} />);

    return props;
}

const inputValue = (label: string): string => screen.getByLabelText<HTMLInputElement>(label).value;

describe('RecipeForm (native) — mode + chrome', () => {
    it('renders the create heading and submit copy in create mode', () => {
        renderForm({ mode: 'create' });

        expect(screen.getByRole('heading', { name: 'New recipe' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create recipe' })).toBeTruthy();
    });

    it('renders the edit heading and submit copy in edit mode', () => {
        renderForm({ mode: 'edit' });

        expect(screen.getByRole('heading', { name: 'Edit recipe' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    });
});

describe('RecipeForm (native) — basics fields', () => {
    it('renders every basics field bound to the given values', () => {
        renderForm();

        expect(inputValue('Title')).toBe('Herb Risotto');
        expect(inputValue('Description')).toBe('Creamy and quick.');
        expect(screen.getByRole('radiogroup', { name: 'Cuisine' })).toBeTruthy();
        expect(screen.getByRole<HTMLElement>('radio', { name: 'Italian' }).getAttribute('aria-checked')).toBe('true');
        expect(inputValue('Tags')).toBe('quick, dinner');
        expect(inputValue('Dietary flags')).toBe('vegetarian');
        expect(inputValue('Servings')).toBe('4');
        expect(inputValue('Prep time (minutes)')).toBe('10');
        expect(inputValue('Cook time (minutes)')).toBe('25');
    });

    it('shows the computed total time as read-only text', () => {
        renderForm({ values: filledValues({ prepTimeMinutes: 10, cookTimeMinutes: 25 }) });

        expect(screen.getByText('Total time 35 min')).toBeTruthy();
    });

    it('reports a title edit upward', () => {
        const onChange = vi.fn();
        renderForm({ onChange });

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Lemon Risotto' } });

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: 'Lemon Risotto' }));
    });

    it('parses a numeric field to a number', () => {
        const onChange = vi.fn();
        renderForm({ onChange });

        fireEvent.change(screen.getByLabelText('Servings'), { target: { value: '6' } });

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ servings: 6 }));
    });

    it('parses a comma-separated tags edit into a trimmed list', () => {
        const onChange = vi.fn();
        renderForm({ onChange });

        fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'quick,  easy , ' } });

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['quick', 'easy'] }));
    });
});

describe('RecipeForm (native) — cuisine picker (w3/e5)', () => {
    const isChecked = (label: string): boolean =>
        screen.getByRole('radio', { name: label }).getAttribute('aria-checked') === 'true';

    it('renders a radiogroup with every curated CUISINES option plus the explicit "no cuisine" choice', () => {
        renderForm({ values: filledValues({ cuisine: '' }) });

        expect(screen.getByRole('radiogroup', { name: 'Cuisine' })).toBeTruthy();
        for (const cuisine of CUISINES) {
            expect(screen.getByRole('radio', { name: cuisine })).toBeTruthy();
        }
        expect(screen.getByRole('radio', { name: 'No cuisine' })).toBeTruthy();
    });

    it('checks the curated option bound to the form', () => {
        renderForm({ values: filledValues({ cuisine: 'Mexican' }) });

        expect(isChecked('Mexican')).toBe(true);
        expect(isChecked('Italian')).toBe(false);
    });

    it('keeps a preselected CUSTOM cuisine (not in CUISINES) visible and checked, never lost', () => {
        renderForm({ values: filledValues({ cuisine: 'Grandma’s Secret Blend' }) });

        expect(screen.getByRole('radio', { name: 'Grandma’s Secret Blend' })).toBeTruthy();
        expect(isChecked('Grandma’s Secret Blend')).toBe(true);
    });

    it('reports a cuisine selection upward, preserving the free-text wire contract', () => {
        const onChange = vi.fn();
        renderForm({ values: filledValues({ cuisine: 'Italian' }), onChange });

        fireEvent.click(screen.getByRole('radio', { name: 'Thai' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cuisine: 'Thai' }));
    });

    it('reports the explicit clear ("No cuisine") selection upward', () => {
        const onChange = vi.fn();
        renderForm({ values: filledValues({ cuisine: 'Italian' }), onChange });

        fireEvent.click(screen.getByRole('radio', { name: 'No cuisine' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cuisine: '' }));
    });
});

describe('RecipeForm (native) — title/description char counters (w3/e6)', () => {
    it('shows a live "N/64" counter for the title and caps input at 64', () => {
        renderForm({ values: filledValues({ title: 'Herb Risotto' }) });

        expect(screen.getByText(`${'Herb Risotto'.length}/${TITLE_MAX_LENGTH}`)).toBeTruthy();
        expect(screen.getByLabelText<HTMLInputElement>('Title').maxLength).toBe(TITLE_MAX_LENGTH);
    });

    it('shows a live "N/256" counter for the description and caps input at 256', () => {
        renderForm({ values: filledValues({ description: 'Creamy and quick.' }) });

        expect(screen.getByText(`${'Creamy and quick.'.length}/${DESCRIPTION_MAX_LENGTH}`)).toBeTruthy();
        expect(screen.getByLabelText<HTMLInputElement>('Description').maxLength).toBe(DESCRIPTION_MAX_LENGTH);
    });
});

describe('RecipeForm (native) — B8 error accessibility wiring (aria-invalid + aria-describedby)', () => {
    it('wires the title field to its alert when invalid, and clears the wiring when valid', () => {
        renderForm({ errors: { title: 'titleRequired' } });

        const title = screen.getByLabelText('Title');
        const alert = screen.getByRole('alert');
        expect(title.getAttribute('aria-invalid')).toBe('true');
        expect(title.getAttribute('aria-describedby')).toBe(alert.id);
        expect(alert.id).toBeTruthy();

        cleanup();
        renderForm();
        expect(screen.getByLabelText('Title').getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByLabelText('Title').getAttribute('aria-describedby')).toBeNull();
    });

    it('wires the servings field to its alert when invalid', () => {
        renderForm({ errors: { servings: 'servingsPositive' } });

        const servings = screen.getByLabelText('Servings');
        const alert = screen.getByRole('alert');
        expect(servings.getAttribute('aria-invalid')).toBe('true');
        expect(servings.getAttribute('aria-describedby')).toBe(alert.id);
    });

    it('wires BOTH prep and cook time fields to the shared times alert when invalid', () => {
        renderForm({ errors: { times: 'timesNonNegative' } });

        const alert = screen.getByRole('alert');
        const prep = screen.getByLabelText('Prep time (minutes)');
        const cook = screen.getByLabelText('Cook time (minutes)');

        expect(prep.getAttribute('aria-invalid')).toBe('true');
        expect(prep.getAttribute('aria-describedby')).toBe(alert.id);
        expect(cook.getAttribute('aria-invalid')).toBe('true');
        expect(cook.getAttribute('aria-describedby')).toBe(alert.id);
    });

    it('wires only the offending ingredient line(s) to the ingredients alert, per field (WCAG 3.3.1)', () => {
        renderForm({
            values: filledValues({
                ingredients: [
                    { ingredientId: null, name: 'Unresolved', quantity: 1 },
                    { ingredientId: 'ing_2', name: 'Salt', quantity: 0 },
                    { ingredientId: 'ing_3', name: 'Pepper', quantity: 1 },
                ],
            }),
            errors: { ingredients: 'ingredientsUnresolved' },
        });

        const alert = screen.getByRole('alert');

        expect(screen.getByLabelText('Ingredient 1 name').getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByLabelText('Ingredient 1 name').getAttribute('aria-describedby')).toBe(alert.id);
        expect(screen.getByLabelText('Ingredient 1 quantity').getAttribute('aria-invalid')).toBeNull();

        expect(screen.getByLabelText('Ingredient 2 name').getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByLabelText('Ingredient 2 quantity').getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByLabelText('Ingredient 2 quantity').getAttribute('aria-describedby')).toBe(alert.id);

        expect(screen.getByLabelText('Ingredient 3 name').getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByLabelText('Ingredient 3 quantity').getAttribute('aria-invalid')).toBeNull();
    });

    it('does not mark any ingredient line invalid on an ingredientsEmpty error (no lines exist)', () => {
        renderForm({ values: filledValues({ ingredients: [] }), errors: { ingredients: 'ingredientsEmpty' } });

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.queryByLabelText('Ingredient 1 name')).toBeNull();
    });

    it('wires only the offending step(s) to the steps alert, per field', () => {
        renderForm({
            values: filledValues({
                steps: [{ instruction: '' }, { instruction: 'Toast the rice.' }],
            }),
            errors: { steps: 'stepsRequired' },
        });

        const alert = screen.getByRole('alert');

        expect(screen.getByLabelText('Step 1 instruction').getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByLabelText('Step 1 instruction').getAttribute('aria-describedby')).toBe(alert.id);
        expect(screen.getByLabelText('Step 2 instruction').getAttribute('aria-invalid')).toBeNull();
    });
});

describe('RecipeForm (native) — ingredients', () => {
    it('shows the empty state when there are no ingredient lines', () => {
        renderForm({ values: filledValues({ ingredients: [] }) });

        expect(screen.getByText('No ingredients yet. Add your first ingredient.')).toBeTruthy();
    });

    it('renders name, quantity, and unit for each ingredient line', () => {
        renderForm();

        expect(inputValue('Ingredient 1 name')).toBe('Arborio rice');
        expect(inputValue('Ingredient 1 quantity')).toBe('300');
        expect(inputValue('Ingredient 1 unit')).toBe('g');
    });

    it('appends a blank ingredient line on add', () => {
        const onChange = vi.fn();
        renderForm({ values: filledValues({ ingredients: [] }), onChange });

        fireEvent.click(screen.getByRole('button', { name: 'Add ingredient' }));

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ ingredients: [{ ingredientId: null, name: '', quantity: 1 }] }),
        );
    });

    it('removes the targeted ingredient line', () => {
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Rice', quantity: 300 },
                    { ingredientId: 'ing_2', name: 'Stock', quantity: 1 },
                ],
            }),
            onChange,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Remove ingredient 1' }));

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ ingredients: [{ ingredientId: 'ing_2', name: 'Stock', quantity: 1 }] }),
        );
    });

    it('reports an ingredient name change upward', () => {
        const onChange = vi.fn();
        renderForm({ onChange });

        fireEvent.change(screen.getByLabelText('Ingredient 1 name'), { target: { value: 'Carnaroli rice' } });

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                ingredients: [expect.objectContaining({ name: 'Carnaroli rice', ingredientId: 'ing_1' })],
            }),
        );
    });

    it.each([
        [FoodResolutionStatus.PENDING, 'Resolving…'],
        [FoodResolutionStatus.UNRESOLVED, 'Not resolved'],
        [FoodResolutionStatus.RESOLVED, 'Resolved'],
        [FoodResolutionStatus.NOT_FOUND, 'No match found'],
        [FoodResolutionStatus.FAILED, 'Resolution failed'],
    ])('renders the %s resolution-status badge', (status, label) => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Rice', quantity: 1, resolutionStatus: status }],
            }),
        });

        expect(screen.getByText(label)).toBeTruthy();
    });

    it('omits the status badge when a line has no resolution status', () => {
        renderForm({ values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Rice', quantity: 1 }] }) });

        expect(screen.queryByText('Resolved')).toBeNull();
    });
});

describe('RecipeForm (native) — per-row + running-total nutrition (w3/e3, FR-007)', () => {
    it('shows a resolved catalog line’s calories', () => {
        renderForm({
            values: filledValues({
                ingredients: [
                    {
                        ingredientId: 'ing_1',
                        name: 'Arborio rice',
                        quantity: 300,
                        unit: 'g',
                        caloriesPer100g: 130,
                    },
                ],
            }),
        });

        expect(screen.getByText('390 cal')).toBeTruthy();
    });

    it('shows a freeform line’s user-entered calories', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_free', name: 'Grandma’s spice mix', quantity: 1, userCalories: 45 }],
            }),
        });

        expect(screen.getByText('45 cal')).toBeTruthy();
    });

    it('shows NO calorie badge for a seeded-without-nutrition line — never a fake 0', () => {
        renderForm({
            values: filledValues({
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, resolutionStatus: 'RESOLVED' },
                ],
            }),
        });

        expect(screen.queryByText(/cal$/)).toBeNull();
        expect(screen.queryByText('0 cal')).toBeNull();
    });

    it('renders the running per-serving total for a complete ingredient set', () => {
        renderForm({
            values: filledValues({
                servings: 1,
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, unit: 'g', caloriesPer100g: 130 },
                    { ingredientId: 'ing_2', name: 'Custom spice', quantity: 1, userCalories: 30 },
                ],
            }),
        });

        expect(screen.getByText('Total nutrition (per serving): 420 cal | 0g P | 0g C | 0g F')).toBeTruthy();
        expect(screen.queryByText('Partial — some ingredients aren’t counted yet')).toBeNull();
    });

    it('updates the running total when an ingredient is added', () => {
        const { rerender } = render(
            <RecipeForm
                values={filledValues({
                    servings: 1,
                    ingredients: [
                        { ingredientId: 'ing_1', name: 'Rice', quantity: 100, unit: 'g', caloriesPer100g: 100 },
                    ],
                })}
                mode="create"
                onChange={noop}
                onSubmit={noop}
                onCancel={noop}
            />,
        );

        expect(screen.getByText('Total nutrition (per serving): 100 cal | 0g P | 0g C | 0g F')).toBeTruthy();

        rerender(
            <RecipeForm
                values={filledValues({
                    servings: 1,
                    ingredients: [
                        { ingredientId: 'ing_1', name: 'Rice', quantity: 100, unit: 'g', caloriesPer100g: 100 },
                        { ingredientId: 'ing_2', name: 'Oil', quantity: 100, unit: 'g', caloriesPer100g: 50 },
                    ],
                })}
                mode="create"
                onChange={noop}
                onSubmit={noop}
                onCancel={noop}
            />,
        );

        expect(screen.getByText('Total nutrition (per serving): 150 cal | 0g P | 0g C | 0g F')).toBeTruthy();
    });

    it('updates the running total when an ingredient’s quantity changes', () => {
        const { rerender } = render(
            <RecipeForm
                values={filledValues({
                    servings: 1,
                    ingredients: [
                        { ingredientId: 'ing_1', name: 'Rice', quantity: 100, unit: 'g', caloriesPer100g: 100 },
                    ],
                })}
                mode="create"
                onChange={noop}
                onSubmit={noop}
                onCancel={noop}
            />,
        );

        expect(screen.getByText('Total nutrition (per serving): 100 cal | 0g P | 0g C | 0g F')).toBeTruthy();

        rerender(
            <RecipeForm
                values={filledValues({
                    servings: 1,
                    ingredients: [
                        { ingredientId: 'ing_1', name: 'Rice', quantity: 200, unit: 'g', caloriesPer100g: 100 },
                    ],
                })}
                mode="create"
                onChange={noop}
                onSubmit={noop}
                onCancel={noop}
            />,
        );

        expect(screen.getByText('Total nutrition (per serving): 200 cal | 0g P | 0g C | 0g F')).toBeTruthy();
    });

    it('updates the running total when an ingredient is removed', () => {
        const { rerender } = render(
            <RecipeForm
                values={filledValues({
                    servings: 1,
                    ingredients: [
                        { ingredientId: 'ing_1', name: 'Rice', quantity: 100, unit: 'g', caloriesPer100g: 100 },
                        { ingredientId: 'ing_2', name: 'Oil', quantity: 100, unit: 'g', caloriesPer100g: 50 },
                    ],
                })}
                mode="create"
                onChange={noop}
                onSubmit={noop}
                onCancel={noop}
            />,
        );

        expect(screen.getByText('Total nutrition (per serving): 150 cal | 0g P | 0g C | 0g F')).toBeTruthy();

        rerender(
            <RecipeForm
                values={filledValues({
                    servings: 1,
                    ingredients: [
                        { ingredientId: 'ing_1', name: 'Rice', quantity: 100, unit: 'g', caloriesPer100g: 100 },
                    ],
                })}
                mode="create"
                onChange={noop}
                onSubmit={noop}
                onCancel={noop}
            />,
        );

        expect(screen.getByText('Total nutrition (per serving): 100 cal | 0g P | 0g C | 0g F')).toBeTruthy();
    });

    it('shows the honest partial affordance (never a fake total) when a line cannot be accounted for', () => {
        renderForm({
            values: filledValues({
                servings: 1,
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Rice', quantity: 100, unit: 'g', caloriesPer100g: 100 },
                    { ingredientId: 'ing_2', name: 'Stock', quantity: 1, unit: 'cup', resolutionStatus: 'PENDING' },
                ],
            }),
        });

        expect(screen.getByText('Total nutrition (per serving): 100 cal | 0g P | 0g C | 0g F')).toBeTruthy();
        expect(screen.getByText('Partial — some ingredients aren’t counted yet')).toBeTruthy();
    });
});

describe('RecipeForm (native) — instructions', () => {
    it('shows the empty state when there are no steps', () => {
        renderForm({ values: filledValues({ steps: [] }) });

        expect(screen.getByText('No steps yet. Add your first step.')).toBeTruthy();
    });

    it('renders each step instruction and timer', () => {
        renderForm();

        expect(inputValue('Step 1 instruction')).toBe('Toast the rice.');
        expect(inputValue('Step 1 timer (seconds)')).toBe('120');
    });

    it('appends a blank step on add', () => {
        const onChange = vi.fn();
        renderForm({ values: filledValues({ steps: [] }), onChange });

        fireEvent.click(screen.getByRole('button', { name: 'Add step' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ steps: [{ instruction: '' }] }));
    });

    it('removes the targeted step', () => {
        const onChange = vi.fn();
        renderForm({
            values: filledValues({ steps: [{ instruction: 'First' }, { instruction: 'Second' }] }),
            onChange,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Remove step 2' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ steps: [{ instruction: 'First' }] }));
    });

    it('clears a step timer to undefined when the field is emptied', () => {
        const onChange = vi.fn();
        renderForm({ values: filledValues({ steps: [{ instruction: 'Toast', timerSeconds: 60 }] }), onChange });

        fireEvent.change(screen.getByLabelText('Step 1 timer (seconds)'), { target: { value: '' } });

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ steps: [{ instruction: 'Toast', timerSeconds: undefined }] }),
        );
    });
});

describe('RecipeForm (native) — validation errors', () => {
    it('surfaces every provided field error', () => {
        renderForm({
            errors: {
                title: 'titleRequired',
                ingredients: 'ingredientsEmpty',
                steps: 'stepsRequired',
                servings: 'servingsPositive',
                times: 'timesNonNegative',
            },
        });

        const alerts = screen.getAllByRole('alert').map((node) => node.textContent);
        expect(alerts).toContain('A title is required.');
        expect(alerts).toContain('Add at least one ingredient.');
        expect(alerts).toContain('Add at least one instruction step.');
        expect(alerts).toContain('Servings must be greater than zero.');
        expect(alerts).toContain('Times cannot be negative.');
    });

    it('renders no alerts when there are no errors', () => {
        renderForm();

        expect(screen.queryAllByRole('alert')).toHaveLength(0);
    });
});

describe('RecipeForm (native) — difficulty picker', () => {
    const isChecked = (label: string): boolean =>
        screen.getByRole('radio', { name: label }).getAttribute('aria-checked') === 'true';

    it('renders a radiogroup with Easy/Medium/Hard and an explicit Not stated option', () => {
        renderForm();

        expect(screen.getByRole('radiogroup', { name: 'Difficulty' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Easy' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Medium' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Hard' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Not stated' })).toBeTruthy();
    });

    it('checks Not stated (and nothing else) when no difficulty is set', () => {
        renderForm({ values: filledValues() });

        expect(isChecked('Not stated')).toBe(true);
        expect(isChecked('Easy')).toBe(false);
        expect(isChecked('Medium')).toBe(false);
        expect(isChecked('Hard')).toBe(false);
    });

    it.each([
        ['Easy', 'easy'],
        ['Medium', 'medium'],
        ['Hard', 'hard'],
    ])('checks the %s radio when that difficulty is selected', (label, value) => {
        renderForm({ values: filledValues({ difficulty: value as 'easy' | 'medium' | 'hard' }) });

        expect(isChecked(label)).toBe(true);
        expect(isChecked('Not stated')).toBe(false);
    });

    it('reports a difficulty selection upward', () => {
        const onChange = vi.fn();
        renderForm({ values: filledValues(), onChange });

        fireEvent.click(screen.getByRole('radio', { name: 'Medium' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ difficulty: 'medium' }));
    });

    it('clears the difficulty (removing the field) when Not stated is chosen', () => {
        const onChange = vi.fn();
        renderForm({ values: filledValues({ difficulty: 'hard' }), onChange });

        fireEvent.click(screen.getByRole('radio', { name: 'Not stated' }));

        expect(onChange).toHaveBeenCalledTimes(1);
        const next = onChange.mock.calls[0]?.[0] as RecipeFormValues;
        expect(next.difficulty).toBeUndefined();
        expect('difficulty' in next).toBe(false);
    });
});

describe('RecipeForm (native) — visibility', () => {
    it('reports a visibility change upward', () => {
        const onChange = vi.fn();
        renderForm({ values: filledValues({ visibility: 'public' }), onChange });

        fireEvent.click(screen.getByLabelText('Private recipe'));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }));
    });
});

describe('RecipeForm (native) — submit + cancel', () => {
    it('submits when the submit button is pressed', () => {
        const onSubmit = vi.fn();
        renderForm({ onSubmit });

        fireEvent.click(screen.getByRole('button', { name: 'Create recipe' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('does not submit while submitting', () => {
        const onSubmit = vi.fn();
        renderForm({ submitting: true, onSubmit });

        fireEvent.click(screen.getByRole('button', { name: 'Create recipe' }));

        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('reports cancel upward', () => {
        const onCancel = vi.fn();
        renderForm({ onCancel });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeForm (native) — every action button carries a decorative icon (mockup parity)', () => {
    // Mirrors the web leaf: each action button keeps its exact accessible name (so Maestro's visible-text
    // taps and the create/edit contracts are unchanged) and renders its icon inside an accessibility-hidden
    // wrapper (the shared Button primitive), so the label alone is the accessible name.
    const actionButtonNames = [
        'Add ingredient',
        'Add step',
        'Remove ingredient 1',
        'Remove step 1',
        'Create recipe',
        'Cancel',
    ] as const;

    it.each(actionButtonNames)('renders "%s" with an accessibility-hidden icon slot', (name) => {
        renderForm();

        const button = screen.getByRole('button', { name });
        // The Button wraps the caller's icon in an `aria-hidden` element, so the glyph never contributes to
        // the accessible name — present here regardless of what Feather draws.
        expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
    });
});
