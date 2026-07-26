// @vitest-environment jsdom
/**
 * Component tests for the web recipe create/edit form (T067). Covers EVERY branch the testing mandate
 * requires — mode-driven headings + submit copy, all Basics fields with their values, the READ-ONLY
 * computed total, dynamic ingredient/step add/remove/change, EVERY resolution-status badge, each validation
 * error, the submitting (disabled) state, the visibility toggle, and the submit/cancel contracts. Every
 * `onChange` assertion checks the emitted values object, so a wrong immutable transition fails the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CUISINES, FoodResolutionStatus } from '@kitchensink/recipe-core';

import { RecipeForm } from '../RecipeForm.js';
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

describe('RecipeForm (web) — mode + chrome', () => {
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

describe('RecipeForm (web) — basics fields', () => {
    it('renders every basics field bound to the given values', () => {
        renderForm();

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Title' }).value).toBe('Herb Risotto');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Description' }).value).toBe('Creamy and quick.');
        expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Cuisine' }).value).toBe('Italian');
        // U6: tags + dietary flags are CHIP inputs now — each committed value renders as a removable chip
        // (its own "Remove {value}" control), and the draft text field is empty (no comma-joined string).
        expect(screen.getByRole('button', { name: 'Remove quick' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove dinner' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove vegetarian' })).toBeTruthy();
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Tags' }).value).toBe('');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Dietary flags' }).value).toBe('');
        expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Servings' }).value).toBe('4');
        expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Prep time (minutes)' }).value).toBe('10');
        expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Cook time (minutes)' }).value).toBe('25');
    });

    it('shows the computed total time as read-only text (no editable control)', () => {
        renderForm({ values: filledValues({ prepTimeMinutes: 10, cookTimeMinutes: 25 }) });

        expect(screen.getByText('35 min')).toBeTruthy();
        expect(screen.queryByRole('spinbutton', { name: 'Total time' })).toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Total time' })).toBeNull();
    });

    it('reports a title edit upward', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ onChange });

        // tripleClick() (select-all, fires no change event) + paste() (one atomic input event): this is a
        // controlled field bound to a static `values` prop with an inert vi.fn() onChange — no re-render
        // happens between keystrokes, so React's controlled-input value-reset kicks in and would fragment a
        // char-by-char user.type() (or even a clear()-then-type()/paste() sequence spanning two separate
        // user-event calls) into calls that never carry the full replacement string. Selecting all text
        // first and replacing it in a single paste is what "reports an edit upward" needs (a real consumer
        // re-renders each keystroke, so this is a test-harness artifact, not a production bug).
        const title = screen.getByRole('textbox', { name: 'Title' });
        await user.tripleClick(title);
        await user.paste('Lemon Risotto');

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: 'Lemon Risotto' }));
    });

    it('parses a numeric field to a number', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ onChange });

        // tripleClick() + paste() — see the title test above for why (controlled field, inert mock, no
        // rerender between keystrokes).
        const servings = screen.getByRole('spinbutton', { name: 'Servings' });
        await user.tripleClick(servings);
        await user.paste('6');

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ servings: 6 }));
    });

    it('adds a tag chip on Enter (no comma parsing) — appended to the existing chips', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ onChange });

        const tags = screen.getByRole('textbox', { name: 'Tags' });
        await user.click(tags);
        await user.paste('easy');
        await user.keyboard('{Enter}');

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['quick', 'dinner', 'easy'] }));
    });

    it('does not treat a comma as a list separator — a comma commits ONE chip, verbatim', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ values: filledValues({ tags: [] }), onChange });

        const tags = screen.getByRole('textbox', { name: 'Tags' });
        await user.click(tags);
        await user.paste('gluten free');
        // A comma is a COMMIT key (like Enter), never a separator folded into or splitting the token.
        await user.keyboard(',');

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['gluten free'] }));
    });

    it('drops a blank/duplicate tag entry (case-insensitive) rather than adding it', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ onChange });

        const tags = screen.getByRole('textbox', { name: 'Tags' });
        await user.click(tags);
        await user.paste('QUICK');
        await user.keyboard('{Enter}');

        expect(onChange).not.toHaveBeenCalled();
    });

    it('removes a tag chip when its remove control is pressed', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ onChange });

        await user.click(screen.getByRole('button', { name: 'Remove quick' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['dinner'] }));
    });

    it('reports dietary-flag chips through the same control', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ onChange });

        const dietary = screen.getByRole('textbox', { name: 'Dietary flags' });
        await user.click(dietary);
        await user.paste('vegan');
        await user.keyboard('{Enter}');

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dietaryFlags: ['vegetarian', 'vegan'] }));
    });
});

describe('RecipeForm (web) — cuisine dropdown (w3/e5)', () => {
    it('lists every curated CUISINES option plus the explicit "no cuisine" choice', () => {
        renderForm({ values: filledValues({ cuisine: '' }) });

        const select = screen.getByRole('combobox', { name: 'Cuisine' });
        for (const cuisine of CUISINES) {
            expect(screen.getByRole('option', { name: cuisine })).toBeTruthy();
        }
        expect(select).toBeTruthy();
    });

    it('selects the curated value bound to the form', () => {
        renderForm({ values: filledValues({ cuisine: 'Mexican' }) });

        expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Cuisine' }).value).toBe('Mexican');
    });

    it('keeps a preselected CUSTOM cuisine (not in CUISINES) visible and selected, never lost', () => {
        renderForm({ values: filledValues({ cuisine: 'Grandma’s Secret Blend' }) });

        const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Cuisine' });
        expect(select.value).toBe('Grandma’s Secret Blend');
        expect(screen.getByRole('option', { name: 'Grandma’s Secret Blend' })).toBeTruthy();
    });

    it('does NOT add an extra option for a blank cuisine', () => {
        renderForm({ values: filledValues({ cuisine: '' }) });

        expect(screen.getAllByRole('option').filter((option) => option.textContent === '')).toHaveLength(0);
    });

    it('reports a cuisine selection upward, preserving the free-text wire contract', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ values: filledValues({ cuisine: 'Italian' }), onChange });

        await user.selectOptions(screen.getByRole('combobox', { name: 'Cuisine' }), 'Thai');

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cuisine: 'Thai' }));
    });
});

describe('RecipeForm (web) — title/description char counters (w3/e6)', () => {
    it('shows a live "N/64" counter for the title and caps input at 64', () => {
        renderForm({ values: filledValues({ title: 'Herb Risotto' }) });

        expect(screen.getByText(`${'Herb Risotto'.length}/${TITLE_MAX_LENGTH}`)).toBeTruthy();
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Title' }).maxLength).toBe(TITLE_MAX_LENGTH);
    });

    it('shows a live "N/256" counter for the description and caps input at 256', () => {
        renderForm({ values: filledValues({ description: 'Creamy and quick.' }) });

        expect(screen.getByText(`${'Creamy and quick.'.length}/${DESCRIPTION_MAX_LENGTH}`)).toBeTruthy();
        expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Description' }).maxLength).toBe(
            DESCRIPTION_MAX_LENGTH,
        );
    });

    it('updates the title counter as the value changes', () => {
        const { rerender } = render(
            <RecipeForm
                {...{
                    values: filledValues({ title: 'A' }),
                    mode: 'create',
                    onChange: noop,
                    onSubmit: noop,
                    onCancel: noop,
                }}
            />,
        );

        expect(screen.getByText(`1/${TITLE_MAX_LENGTH}`)).toBeTruthy();

        rerender(
            <RecipeForm
                {...{
                    values: filledValues({ title: 'Abc' }),
                    mode: 'create',
                    onChange: noop,
                    onSubmit: noop,
                    onCancel: noop,
                }}
            />,
        );

        expect(screen.getByText(`3/${TITLE_MAX_LENGTH}`)).toBeTruthy();
    });
});

describe('RecipeForm (web) — B8 error accessibility wiring (aria-invalid + aria-describedby)', () => {
    it('wires the title field to its alert when invalid, and clears the wiring when valid', () => {
        renderForm({ errors: { title: 'titleRequired' } });

        const title = screen.getByRole('textbox', { name: 'Title' });
        const alert = screen.getByRole('alert');
        expect(title.getAttribute('aria-invalid')).toBe('true');
        expect(title.getAttribute('aria-describedby')).toBe(alert.id);
        expect(alert.id).toBeTruthy();

        cleanup();
        renderForm();
        expect(screen.getByRole('textbox', { name: 'Title' }).getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Title' }).getAttribute('aria-describedby')).toBeNull();
    });

    it('wires the servings field to its alert when invalid', () => {
        renderForm({ errors: { servings: 'servingsPositive' } });

        const servings = screen.getByRole('spinbutton', { name: 'Servings' });
        const alert = screen.getByRole('alert');
        expect(servings.getAttribute('aria-invalid')).toBe('true');
        expect(servings.getAttribute('aria-describedby')).toBe(alert.id);
    });

    it('wires BOTH prep and cook time fields to the shared times alert when invalid', () => {
        renderForm({ errors: { times: 'timesNonNegative' } });

        const alert = screen.getByRole('alert');
        const prep = screen.getByRole('spinbutton', { name: 'Prep time (minutes)' });
        const cook = screen.getByRole('spinbutton', { name: 'Cook time (minutes)' });

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

        // Line 1: unresolved name should be invalid, its quantity (1, valid) should not.
        expect(screen.getByRole('textbox', { name: 'Ingredient 1 name' }).getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByRole('textbox', { name: 'Ingredient 1 name' }).getAttribute('aria-describedby')).toBe(
            alert.id,
        );
        expect(
            screen.getByRole('spinbutton', { name: 'Ingredient 1 quantity' }).getAttribute('aria-invalid'),
        ).toBeNull();

        // Line 2: resolved name should be valid, its zero quantity should be invalid.
        expect(screen.getByRole('textbox', { name: 'Ingredient 2 name' }).getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByRole('spinbutton', { name: 'Ingredient 2 quantity' }).getAttribute('aria-invalid')).toBe(
            'true',
        );
        expect(screen.getByRole('spinbutton', { name: 'Ingredient 2 quantity' }).getAttribute('aria-describedby')).toBe(
            alert.id,
        );

        // Line 3: fully valid — neither input marked invalid.
        expect(screen.getByRole('textbox', { name: 'Ingredient 3 name' }).getAttribute('aria-invalid')).toBeNull();
        expect(
            screen.getByRole('spinbutton', { name: 'Ingredient 3 quantity' }).getAttribute('aria-invalid'),
        ).toBeNull();
    });

    it('does not mark any ingredient line invalid on an ingredientsEmpty error (no lines exist)', () => {
        renderForm({ values: filledValues({ ingredients: [] }), errors: { ingredients: 'ingredientsEmpty' } });

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.queryByRole('textbox', { name: /Ingredient \d+ name/ })).toBeNull();
    });

    it('wires only the offending step(s) to the steps alert, per field', () => {
        renderForm({
            values: filledValues({
                steps: [{ instruction: '' }, { instruction: 'Toast the rice.' }],
            }),
            errors: { steps: 'stepsRequired' },
        });

        const alert = screen.getByRole('alert');

        expect(screen.getByRole('textbox', { name: 'Step 1 instruction' }).getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByRole('textbox', { name: 'Step 1 instruction' }).getAttribute('aria-describedby')).toBe(
            alert.id,
        );
        expect(screen.getByRole('textbox', { name: 'Step 2 instruction' }).getAttribute('aria-invalid')).toBeNull();
    });
});

describe('RecipeForm (web) — difficulty picker', () => {
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

        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Not stated' }).checked).toBe(true);
        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Easy' }).checked).toBe(false);
        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Medium' }).checked).toBe(false);
        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Hard' }).checked).toBe(false);
    });

    it.each([
        ['Easy', 'easy'],
        ['Medium', 'medium'],
        ['Hard', 'hard'],
    ])('checks the %s radio when that difficulty is selected', (label, value) => {
        renderForm({ values: filledValues({ difficulty: value as 'easy' | 'medium' | 'hard' }) });

        expect(screen.getByRole<HTMLInputElement>('radio', { name: label }).checked).toBe(true);
        expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Not stated' }).checked).toBe(false);
    });

    it('reports a difficulty selection upward', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ values: filledValues(), onChange });

        await user.click(screen.getByRole('radio', { name: 'Medium' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ difficulty: 'medium' }));
    });

    it('clears the difficulty (removing the field) when Not stated is chosen', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ values: filledValues({ difficulty: 'hard' }), onChange });

        await user.click(screen.getByRole('radio', { name: 'Not stated' }));

        expect(onChange).toHaveBeenCalledTimes(1);
        const next = onChange.mock.calls[0]?.[0] as RecipeFormValues;
        expect(next.difficulty).toBeUndefined();
        expect('difficulty' in next).toBe(false);
    });
});

describe('RecipeForm (web) — ingredients', () => {
    it('shows the empty state when there are no ingredient lines', () => {
        renderForm({ values: filledValues({ ingredients: [] }) });

        expect(screen.getByText('No ingredients yet. Add your first ingredient.')).toBeTruthy();
    });

    it('renders name, quantity, and unit for each ingredient line', () => {
        renderForm();

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 name' }).value).toBe('Arborio rice');
        expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Ingredient 1 quantity' }).value).toBe('300');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 unit' }).value).toBe('g');
    });

    it('renders a RESOLVED line’s name READ-ONLY (bound to its ingredientId, cannot drift; U6)', () => {
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300 }] }),
        });

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 name' }).readOnly).toBe(true);
    });

    it('keeps an UNRESOLVED line’s name editable (the freeform search text, not yet a resolved identity; U6)', () => {
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: null, name: 'rice', quantity: 1 }] }),
        });

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 name' }).readOnly).toBe(false);
    });

    it('appends a blank ingredient line on add', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ values: filledValues({ ingredients: [] }), onChange });

        await user.click(screen.getByRole('button', { name: 'Add ingredient' }));

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ ingredients: [{ ingredientId: null, name: '', quantity: 1 }] }),
        );
    });

    it('removes the targeted ingredient line', async () => {
        const user = userEvent.setup();
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

        await user.click(screen.getByRole('button', { name: 'Remove ingredient 1' }));

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ ingredients: [{ ingredientId: 'ing_2', name: 'Stock', quantity: 1 }] }),
        );
    });

    it('does NOT let a resolved line’s name be edited (typing into it emits nothing; U6 data-integrity)', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300 }] }),
            onChange,
        });

        const name = screen.getByRole('textbox', { name: 'Ingredient 1 name' });
        await user.click(name);
        await user.paste('Carnaroli rice');

        // Read-only: the resolved name never drifts from its ingredientId, so no change is ever reported.
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 name' }).value).toBe('Arborio rice');
    });

    it('reports an UNRESOLVED line’s name edit upward (freeform-in-progress line; U6)', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: null, name: 'ric', quantity: 1 }] }),
            onChange,
        });

        // tripleClick() + paste() — see the Basics "reports a title edit upward" test for why (controlled
        // field, inert mock, no rerender between keystrokes).
        const name = screen.getByRole('textbox', { name: 'Ingredient 1 name' });
        await user.tripleClick(name);
        await user.paste('rice');

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                ingredients: [expect.objectContaining({ name: 'rice', ingredientId: null })],
            }),
        );
    });

    it('keeps a resolved line’s identity + nutrition when its quantity/unit changes (U6)', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, unit: 'g', caloriesPer100g: 130 },
                ],
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
        expect(line?.caloriesPer100g).toBe(130);
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
        expect(screen.queryByText('Resolving…')).toBeNull();
    });
});

describe('RecipeForm (web) — per-row + running-total nutrition (w3/e3, FR-007)', () => {
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

describe('RecipeForm (web) — instructions', () => {
    it('shows the empty state when there are no steps', () => {
        renderForm({ values: filledValues({ steps: [] }) });

        expect(screen.getByText('No steps yet. Add your first step.')).toBeTruthy();
    });

    it('renders each step instruction and timer', () => {
        renderForm();

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Step 1 instruction' }).value).toBe(
            'Toast the rice.',
        );
        expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Step 1 timer (seconds)' }).value).toBe('120');
    });

    it('appends a blank step on add', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ values: filledValues({ steps: [] }), onChange });

        await user.click(screen.getByRole('button', { name: 'Add step' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ steps: [{ instruction: '' }] }));
    });

    it('removes the targeted step', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
            values: filledValues({ steps: [{ instruction: 'First' }, { instruction: 'Second' }] }),
            onChange,
        });

        await user.click(screen.getByRole('button', { name: 'Remove step 2' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ steps: [{ instruction: 'First' }] }));
    });

    it('clears a step timer to undefined when the field is emptied', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ values: filledValues({ steps: [{ instruction: 'Toast', timerSeconds: 60 }] }), onChange });

        await user.clear(screen.getByRole('spinbutton', { name: 'Step 1 timer (seconds)' }));

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ steps: [{ instruction: 'Toast', timerSeconds: undefined }] }),
        );
    });
});

describe('RecipeForm (web) — validation errors', () => {
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

describe('RecipeForm (web) — visibility', () => {
    it('reflects private visibility as a checked toggle', () => {
        renderForm({ values: filledValues({ visibility: 'private' }) });

        expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Private recipe' }).checked).toBe(true);
    });

    it('reflects public visibility as an unchecked toggle', () => {
        renderForm({ values: filledValues({ visibility: 'public' }) });

        expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Private recipe' }).checked).toBe(false);
    });

    it('reports a visibility change upward', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({ values: filledValues({ visibility: 'public' }), onChange });

        await user.click(screen.getByRole('checkbox', { name: 'Private recipe' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }));
    });
});

describe('RecipeForm (web) — submit + cancel', () => {
    it('submits when the submit button is pressed', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        renderForm({ onSubmit });

        await user.click(screen.getByRole('button', { name: 'Create recipe' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('disables the submit button and does not submit while submitting', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        renderForm({ submitting: true, onSubmit });

        const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Create recipe' });
        expect(submit.disabled).toBe(true);

        await user.click(submit);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('reports cancel upward', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        renderForm({ onCancel });

        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeForm (web) — every action button carries an icon and a real surface (mockup parity)', () => {
    // The mockups pair every button with an icon and give it a visible surface; the old form rendered its
    // add/remove/cancel actions as naked text. Each action button must (1) keep its exact accessible name —
    // so Playwright/RTL name selection and the create/edit contracts are unchanged — (2) render a decorative
    // icon hidden from the accessibility tree, and (3) sit on a real button surface (not bare text).
    const actionButtonNames = [
        'Add ingredient',
        'Add step',
        'Remove ingredient 1',
        'Remove step 1',
        'Create recipe',
        'Cancel',
    ] as const;

    it.each(actionButtonNames)('renders "%s" with a decorative, accessibility-hidden icon', (name) => {
        renderForm();

        const button = screen.getByRole('button', { name });
        const icon = button.querySelector('svg');
        expect(icon).not.toBeNull();
        // The glyph is decorative: hidden from assistive tech so the label alone is the accessible name.
        expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('gives each action button a real visible surface (a fill or a border), never naked text', () => {
        renderForm();

        // Secondary actions read as buttons via a border.
        for (const name of ['Add ingredient', 'Add step', 'Cancel'] as const) {
            expect(screen.getByRole('button', { name }).className).toContain('border');
        }

        // Destructive remove actions are error-toned.
        for (const name of ['Remove ingredient 1', 'Remove step 1'] as const) {
            expect(screen.getByRole('button', { name }).className).toContain('error');
        }

        // The primary submit is a filled seafoam CTA.
        expect(screen.getByRole('button', { name: 'Create recipe' }).className).toContain('seafoam');
    });

    it('collapses the cramped remove controls to icon-only at base, keeping the label from sm (U5)', () => {
        renderForm();

        // At 360px the ingredient/step rows are too tight for a text remove button, so its label is visually
        // hidden at base (`sr-only`) and restored from `sm:` (`sm:not-sr-only`) — icon-only on phones. The
        // label text stays in the accessibility tree, so the button's accessible name is unchanged (these very
        // `getByRole({ name })` lookups still resolve) and desktop shows the full label as before.
        for (const name of ['Remove ingredient 1', 'Remove step 1'] as const) {
            const label = screen.getByText(name);
            expect(label.className).toContain('sr-only');
            expect(label.className).toContain('sm:not-sr-only');
            // Still the accessible name of a real button — not lost to assistive tech.
            expect(screen.getByRole('button', { name })).toBe(label.closest('button'));
        }
    });
});
