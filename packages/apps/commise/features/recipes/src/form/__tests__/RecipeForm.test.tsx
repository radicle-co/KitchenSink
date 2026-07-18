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
import { fireEvent } from '@testing-library/dom';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { RecipeForm } from '../RecipeForm.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../model.js';
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
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Cuisine' }).value).toBe('Italian');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Tags' }).value).toBe('quick, dinner');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Dietary flags' }).value).toBe('vegetarian');
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

    it('reports a title edit upward', () => {
        const onChange = vi.fn();
        renderForm({ onChange });

        fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Lemon Risotto' } });

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: 'Lemon Risotto' }));
    });

    it('parses a numeric field to a number', () => {
        const onChange = vi.fn();
        renderForm({ onChange });

        fireEvent.change(screen.getByRole('spinbutton', { name: 'Servings' }), { target: { value: '6' } });

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ servings: 6 }));
    });

    it('parses a comma-separated tags edit into a trimmed list', () => {
        const onChange = vi.fn();
        renderForm({ onChange });

        fireEvent.change(screen.getByRole('textbox', { name: 'Tags' }), { target: { value: 'quick,  easy , ' } });

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['quick', 'easy'] }));
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

        fireEvent.change(screen.getByRole('textbox', { name: 'Ingredient 1 name' }), {
            target: { value: 'Carnaroli rice' },
        });

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                ingredients: [expect.objectContaining({ name: 'Carnaroli rice', ingredientId: 'ing_1' })],
            }),
        );
    });

    it('parses an ingredient quantity change to a number', () => {
        const onChange = vi.fn();
        renderForm({ onChange });

        fireEvent.change(screen.getByRole('spinbutton', { name: 'Ingredient 1 quantity' }), {
            target: { value: '250' },
        });

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

        fireEvent.change(screen.getByRole('spinbutton', { name: 'Step 1 timer (seconds)' }), {
            target: { value: '' },
        });

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ steps: [{ instruction: 'Toast', timerSeconds: undefined }] }),
        );
    });
});

describe('RecipeForm (web) — validation errors', () => {
    it('surfaces every provided field error', () => {
        renderForm({
            errors: {
                title: 'A title is required.',
                ingredients: 'Add at least one ingredient.',
                steps: 'Add at least one instruction step.',
                servings: 'Servings must be greater than zero.',
                times: 'Times cannot be negative.',
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

    it('reports a visibility change upward', () => {
        const onChange = vi.fn();
        renderForm({ values: filledValues({ visibility: 'public' }), onChange });

        fireEvent.click(screen.getByRole('checkbox', { name: 'Private recipe' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }));
    });
});

describe('RecipeForm (web) — submit + cancel', () => {
    it('submits when the submit button is pressed', () => {
        const onSubmit = vi.fn();
        renderForm({ onSubmit });

        fireEvent.click(screen.getByRole('button', { name: 'Create recipe' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('disables the submit button and does not submit while submitting', () => {
        const onSubmit = vi.fn();
        renderForm({ submitting: true, onSubmit });

        const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Create recipe' });
        expect(submit.disabled).toBe(true);

        fireEvent.click(submit);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('reports cancel upward', () => {
        const onCancel = vi.fn();
        renderForm({ onCancel });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

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
});
