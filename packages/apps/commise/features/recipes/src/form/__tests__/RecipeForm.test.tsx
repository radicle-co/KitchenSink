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
import { useState, type FC } from 'react';

import { compositeOver, ringContrast, utilityContrast } from '@commise/test-utils';
import { palette, semantic } from '@commise/ui';
import { CUISINES, FoodResolutionStatus } from '@kitchensink/recipe-core';

import { tintOf } from '../../__tests__/cssColor.js';
import { RecipeForm } from '../RecipeForm.js';
import { DESCRIPTION_MAX_LENGTH, defaultRecipeFormValues, TITLE_MAX_LENGTH, type RecipeFormValues } from '../model.js';
import { resolutionStatusLabel, type RecipeFormProps } from '../props.js';
import { recipeFormMessages } from '../messages.js';

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
        // U28 — REQUIRED, so a composition cannot forget to say where "+ Add ingredient" leads. `RecipeForm`
        // forwards it to the ingredients leaf exactly as it forwards `onSubmit`/`onCancel`.
        onRequestAddIngredient: noop,
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

/**
 * The form's seafoam-tinted leaves (`ChipInput`'s chips,
 * `../RecipeIngredientsFields.tsx`'s per-row calories badge) render through THIS form, so their
 * contrast is asserted here rather than by reaching past the public component. Ratios are measured from the
 * class list each leaf actually rendered — see `@commise/ui`'s palette JSDoc for which seafoam sites are
 * accents (3:1) and which are text (4.5:1).
 */
describe('RecipeForm (web) — tinted chip + badge text is WCAG-AA legible', () => {
    /** The chip element wrapping `value`, reached through its remove control's accessible name. */
    function chipFor(value: string): { readonly chip: HTMLElement; readonly remove: HTMLElement } {
        const remove = screen.getByRole('button', { name: `Remove ${value}` });
        const chip = remove.parentElement;

        if (chip === null) {
            throw new Error(`Expected the "Remove ${value}" control to sit inside its chip.`);
        }

        return { chip, remove };
    }

    it('makes the tag chip LABEL legible over the chip’s own seafoam tint', () => {
        renderForm({ values: filledValues({ tags: ['quick'] }) });

        const { chip } = chipFor('quick');

        // Seafoam-as-text on its own `/10` tint is 3.57:1 — under the 4.5:1 body-text floor.
        expect(utilityContrast(chip.className), 'tag chip label').toBeGreaterThanOrEqual(4.5);
    });

    it('makes the chip’s × remove glyph legible AT REST AND ON HOVER', () => {
        renderForm({ values: filledValues({ tags: ['quick'] }) });

        const { chip, remove } = chipFor('quick');

        // The × is a rendered TEXT glyph, and it is painted INSIDE the chip — so the colour behind it is the
        // chip's own tint, not the white field behind that, and the control's `hover:` tint STACKS on top.
        // Measuring it over plain white would flatter both states and let a failing hover through (which is
        // exactly what happened: ocean-dark over `seafoam/20` is 4.90:1 on white but only 4.41:1 once the
        // chip's own `/10` is underneath it).
        expect(chip.className, 'the chip’s tint the × is measured against').toContain('bg-seafoam/10');
        const surface = compositeOver(tintOf(palette.seafoam, 0.1), palette.white);

        expect(utilityContrast(remove.className, { surface }), '× glyph at rest').toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(remove.className, { surface, variant: 'hover' }),
            '× glyph on hover',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('makes the per-row calories badge legible over its seafoam tint', () => {
        renderForm({
            values: filledValues({
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, unit: 'g', caloriesPer100g: 130 },
                ],
            }),
        });

        expect(utilityContrast(screen.getByText('390 cal').className), 'calories badge').toBeGreaterThanOrEqual(4.5);
    });
});

/**
 * Keyboard focus is the ONLY way a non-pointer viewer knows which field they are typing into, so the ring is
 * as load-bearing as the label — and it is governed by SC 1.4.11 (3:1, a non-text UI component boundary), not
 * by the 4.5:1 text floor.
 *
 * Every ring here shipped as `ring-seafoam-light`, which measures 2.78:1 on the form's own `bg-card` sections
 * and 2.45:1 on the tag chip's seafoam tint (#114). The token is deliberately NOT being darkened — it is the
 * light teal of `semantic.primary`, and the lightness a ring needs would collapse it into `seafoam` (palette
 * JSDoc) — so the fix is to point these rings at `seafoam`, and the measurement is what pins that.
 *
 * `ringContrast` measures the ring against the backdrop the ring is DRAWN ON, never the control's own fill: a
 * Tailwind ring is a spread box-shadow outside the border box, so the field's white background is irrelevant
 * and the chip's tint is not.
 */
describe('RecipeForm (web) — focus rings clear the 3:1 SC 1.4.11 floor', () => {
    /** The form's fields all sit inside `bg-card` sections, so that is the surface every ring is drawn on. */
    const CARD = semantic.card;

    it('rings the text and numeric fields legibly against the card they sit on', () => {
        renderForm();

        const fields = [
            screen.getByRole('textbox', { name: 'Title' }),
            screen.getByRole('textbox', { name: 'Description' }),
            screen.getByRole('spinbutton', { name: 'Servings' }),
            screen.getByRole('spinbutton', { name: 'Prep time (minutes)' }),
            screen.getByRole('spinbutton', { name: 'Cook time (minutes)' }),
        ];

        for (const field of fields) {
            expect(
                ringContrast(field.className, { surface: CARD }),
                `${field.getAttribute('aria-label') ?? 'field'} focus ring`,
            ).toBeGreaterThanOrEqual(3);
        }
    });

    it('rings the cuisine select legibly', () => {
        renderForm();

        expect(
            ringContrast(screen.getByRole('combobox', { name: 'Cuisine' }).className, { surface: CARD }),
            'cuisine select focus ring',
        ).toBeGreaterThanOrEqual(3);
    });

    it('rings the difficulty chips legibly (the ring is on the label, which owns focus-within)', () => {
        renderForm();

        for (const label of ['Easy', 'Medium', 'Hard', 'Not stated']) {
            const chip = screen.getByRole('radio', { name: label }).parentElement;

            if (chip === null) {
                throw new Error(`Expected the "${label}" radio to sit inside its chip label.`);
            }

            expect(ringContrast(chip.className, { surface: CARD }), `${label} difficulty chip focus ring`) //
                .toBeGreaterThanOrEqual(3);
        }
    });

    it('rings the chip INPUT (its focus-within box) legibly against the card', () => {
        renderForm({ values: filledValues({ tags: ['quick'] }) });

        // The chip field is the `focus-within` box that wraps the committed chips and the draft input.
        const field = screen.getByRole('textbox', { name: 'Tags' }).parentElement;

        if (field === null) {
            throw new Error('Expected the tags draft input to sit inside its chip field.');
        }

        expect(ringContrast(field.className, { surface: CARD }), 'chip field focus ring').toBeGreaterThanOrEqual(3);
    });

    it('rings the chip’s × remove control against the chip’s own TINT, not the white field behind it', () => {
        renderForm({ values: filledValues({ tags: ['quick'] }) });

        const remove = screen.getByRole('button', { name: 'Remove quick' });
        const chip = remove.parentElement;

        if (chip === null) {
            throw new Error('Expected the "Remove quick" control to sit inside its chip.');
        }

        // Two surfaces deep: the ring is drawn on the chip's `bg-seafoam/10`, itself over the white field.
        // Measuring it against a nominal white overstates the ratio by 0.57 — enough to hide a failure.
        expect(chip.className, 'the chip tint the ring is measured against').toContain('bg-seafoam/10');
        const surface = compositeOver(tintOf(palette.seafoam, 0.1), CARD);

        expect(ringContrast(remove.className, { surface }), '× remove focus ring on the chip tint') //
            .toBeGreaterThanOrEqual(3);
        expect(
            ringContrast(remove.className, { surface }),
            '× remove focus ring vs the seafoam-light it replaced',
        ).toBeGreaterThan(ringContrast(`ring-2 ring-seafoam-light`, { surface }));
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
                    onRequestAddIngredient: noop,
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
                    onRequestAddIngredient: noop,
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
                ingredients: [
                    { ingredientId: null, name: 'Unresolved', quantity: 1 },
                    { ingredientId: 'ing_2', name: 'Salt', quantity: 0 },
                    { ingredientId: 'ing_3', name: 'Pepper', quantity: 1 },
                ],
            }),
            errors: { ingredients: 'ingredientsUnresolved' },
        });

        const alert = screen.getByRole('alert');

        // Line 1 — the unresolved name is the offending control.
        //
        // ⚠️ WIDENED BY U28 (was `toBe(alert.id)`): the field is now described by its OWN "no food chosen"
        // note as well as the section alert. The property this test proves is unchanged — the offending
        // control is wired to the alert — and is now sharper, because the row also says which row and what
        // to do. Asserting the alert id is still REACHED (rather than dropping the assertion) is the point.
        expect(screen.getByRole('textbox', { name: 'Ingredient 1 name' }).getAttribute('aria-invalid')).toBe('true');
        expect(
            screen.getByRole('textbox', { name: 'Ingredient 1 name' }).getAttribute('aria-describedby')?.split(' '),
        ).toContain(alert.id);
        expect(
            screen.getByRole('spinbutton', { name: 'Ingredient 1 quantity' }).getAttribute('aria-invalid'),
        ).toBeNull();

        // Line 2 — resolved, so nothing is marked, INCLUDING its zero quantity: this alert is not about it.
        expect(screen.getByRole('textbox', { name: 'Ingredient 2 name' }).getAttribute('aria-invalid')).toBeNull();
        expect(
            screen.getByRole('spinbutton', { name: 'Ingredient 2 quantity' }).getAttribute('aria-invalid'),
        ).toBeNull();

        // Line 3: fully valid — neither input marked invalid.
        expect(screen.getByRole('textbox', { name: 'Ingredient 3 name' }).getAttribute('aria-invalid')).toBeNull();
        expect(
            screen.getByRole('spinbutton', { name: 'Ingredient 3 quantity' }).getAttribute('aria-invalid'),
        ).toBeNull();
    });

    it('wires only the offending QUANTITY lines to an ingredientsQuantityInvalid alert (WCAG 3.3.1)', () => {
        renderForm({
            values: filledValues({
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Salt', quantity: 0 },
                    { ingredientId: 'ing_2', name: 'Pepper', quantity: 1 },
                ],
            }),
            errors: { ingredients: 'ingredientsQuantityInvalid' },
        });

        const alert = screen.getByRole('alert');

        expect(screen.getByRole('spinbutton', { name: 'Ingredient 1 quantity' }).getAttribute('aria-invalid')).toBe(
            'true',
        );
        expect(screen.getByRole('spinbutton', { name: 'Ingredient 1 quantity' }).getAttribute('aria-describedby')).toBe(
            alert.id,
        );
        expect(screen.getByRole('textbox', { name: 'Ingredient 1 name' }).getAttribute('aria-invalid')).toBeNull();
        expect(
            screen.getByRole('spinbutton', { name: 'Ingredient 2 quantity' }).getAttribute('aria-invalid'),
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
    /** The difficulty chips sit inside a `bg-card` section, so that is the surface behind them. */
    const CARD = semantic.card;

    // REGRESSION: the selected chip layered `bg-seafoam text-white` on top of a base that already set
    // `bg-white text-charcoal`. Tailwind orders utilities by its own EMISSION order, not by the order they
    // appear in the class attribute, so `.bg-white` (emitted later) beat `.bg-seafoam` while `.text-white`
    // (emitted later) beat `.text-charcoal` — the selected label rendered white-on-white, invisible in every
    // browser, in dev and in prod. Worse, `values.difficulty === option.value` is `undefined === undefined`
    // for "Not stated", so a FRESH form opened with a blank pill.
    //
    // The existing focus-ring test above measures only the ring, never text-against-fill, which is how this
    // survived. `utilityContrast` THROWS on exactly this ambiguity (two palette-coloured utilities of one
    // role), so on the shipped code this goes red before it ever computes a ratio.
    it.each([
        ['Not stated', undefined],
        ['Easy', 'easy'],
        ['Medium', 'medium'],
        ['Hard', 'hard'],
    ])('renders the selected %s chip legibly (its own fill, not the card behind it)', (label, value) => {
        renderForm({
            values:
                value === undefined
                    ? filledValues()
                    : filledValues({ difficulty: value as 'easy' | 'medium' | 'hard' }),
        });

        const chip = screen.getByRole('radio', { name: label }).parentElement;

        if (chip === null) {
            throw new Error(`Expected the "${label}" radio to sit inside its chip label.`);
        }

        // The chip text is `text-body-sm` — normal-size body copy, so WCAG AA is 4.5:1, not the 3:1
        // large-text allowance. Seafoam-on-white measures ~4.67, so this threshold has real teeth.
        expect(utilityContrast(chip.className, { surface: CARD }), `${label} selected chip label`) //
            .toBeGreaterThanOrEqual(4.5);
    });

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
    it('renders an UNRESOLVED line’s name READ-ONLY too — a food is picked, never typed (U28)', () => {
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: null, name: 'rice', quantity: 1 }] }),
        });

        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 name' }).readOnly).toBe(true);
        // The text the cook wrote is PRESERVED and visible — read-only is not hidden.
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 name' }).value).toBe('rice');
    });

    /**
     * REWRITTEN for U28 (was: "appends a blank ingredient line on add").
     *
     * ⛔ THIS IS THE MUTANT GUARD FOR "restore the append-an-empty-row behaviour". The old assertion PINNED
     * the dead end: the button emitted `{ ingredientId: null, name: '', quantity: 1 }`, which
     * `validateRecipeForm` then refused and `toCreateRecipeInput` silently dropped. The button is now a
     * REQUEST — it opens the picker and touches no values at all — so this asserts both halves: the request
     * fires, and `onChange` is never called.
     */
    it('⛔ asks for the PICKER on add — and changes no values (U28)', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const onRequestAddIngredient = vi.fn();
        renderForm({ values: filledValues({ ingredients: [] }), onChange, onRequestAddIngredient });

        await user.click(screen.getByRole('button', { name: 'Add ingredient' }));

        expect(onRequestAddIngredient).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
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

    /**
     * REWRITTEN for U28 (was: "reports an UNRESOLVED line’s name edit upward ... U6") — the inverse
     * assertion, for the reason recorded on the read-only test above. Typing a name could never resolve the
     * line, so reporting the edit upward only produced text the wire mapper threw away.
     */
    it('emits NOTHING when an unresolved line’s name is typed into (U28)', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: null, name: 'ric', quantity: 1 }] }),
            onChange,
        });

        const name = screen.getByRole('textbox', { name: 'Ingredient 1 name' });
        await user.click(name);
        await user.paste('rice');

        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 name' }).value).toBe('ric');
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
        // ⚠️ EXTENDED for U14, not rewritten: the union gained a sixth member, and a table that only covers
        // the five it had when it was written is a totality claim that stopped being true.
        [FoodResolutionStatus.NEEDS_REVIEW, 'Needs review'],
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

    it('⛔ styles the NEEDS_REVIEW badge differently from every other status (U14)', () => {
        // A doubted line is the ONE status a cook can act on — re-pick the food — and the editor is the
        // surface where they do it. Rendering it in the same neutral pearl as "Resolved" would put the
        // affordance in front of them wearing the colour of "nothing to do here", which is how a caveat gets
        // scrolled past. Asserted against the OTHER statuses rather than against a literal class string, so
        // it pins the DISTINCTION rather than today's palette.
        const classOf = (status: (typeof FoodResolutionStatus)[keyof typeof FoodResolutionStatus]): string => {
            cleanup();
            renderForm({
                values: filledValues({
                    ingredients: [{ ingredientId: 'ing_1', name: 'Rice', quantity: 1, resolutionStatus: status }],
                }),
            });

            return screen.getByText(resolutionStatusLabel(recipeFormMessages.en, status)).className;
        };

        const review = classOf(FoodResolutionStatus.NEEDS_REVIEW);

        for (const other of [
            FoodResolutionStatus.PENDING,
            FoodResolutionStatus.UNRESOLVED,
            FoodResolutionStatus.RESOLVED,
            FoodResolutionStatus.NOT_FOUND,
            FoodResolutionStatus.FAILED,
        ] as const) {
            expect(review).not.toBe(classOf(other));
        }
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
                onRequestAddIngredient={noop}
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
                onRequestAddIngredient={noop}
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
                onRequestAddIngredient={noop}
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
                onRequestAddIngredient={noop}
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
                onRequestAddIngredient={noop}
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
                onRequestAddIngredient={noop}
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

/**
 * Cross-platform parity for the native leaf's instruction-row fix (the Maestro dump where "Remove step 1" was
 * laid out at x=999..1080 on a 1080px display — half past the screen edge, untappable). This leaf was already
 * the SAFE one: the instruction field is `min-w-0 flex-1` so IT yields the width instead of the action, the
 * step marker is `shrink-0`, and the remove label collapses to icon-only below `sm` — three mitigations the
 * native leaf had none of. Pinning them here keeps the two leaves' overflow behaviour from drifting again.
 */
describe('RecipeForm (web) — an instruction row cannot push its remove action off the screen edge', () => {
    it('lets the instruction field yield width rather than claim its full intrinsic size', () => {
        renderForm();

        const field = screen.getByLabelText('Step 1 instruction');

        expect(field.className).toContain('min-w-0');
        expect(field.className).toContain('flex-1');
    });

    it('never shrinks the step marker', () => {
        renderForm();

        const row = screen.getByLabelText('Step 1 instruction').parentElement as HTMLElement;
        const marker = row.firstElementChild as HTMLElement;

        expect(marker.className).toContain('shrink-0');
    });

    it('applies the same treatment to the ingredient row (one row contract, both rows)', () => {
        renderForm();

        expect(screen.getByLabelText('Ingredient 1 name').className).toContain('min-w-0');
        expect(screen.getByLabelText('Ingredient 1 name').parentElement?.className).toContain('flex-wrap');
    });
});

/**
 * Cross-platform parity for the native chip fix: a long tag must never push its own remove control out, since
 * that control is the field's only removal path. Web shrinks flex items by default — which here means the
 * `size-5` remove button was the thing that got squeezed — so the treatment is the same on both leaves: the
 * tag text yields (and breaks), the remove control never does.
 */
describe('RecipeForm (web) — a long tag cannot push its own remove control out of the chip', () => {
    const longTag = 'weeknight-dinner-for-a-crowd-of-hungry-teenagers';

    it('lets the chip text break instead of overflowing, and never shrinks the remove control', () => {
        renderForm({ values: filledValues({ tags: [longTag] }) });

        const remove = screen.getByRole('button', { name: `Remove ${longTag}` });
        const chip = remove.parentElement;

        expect(chip?.className).toContain('min-w-0');
        expect(chip?.className).toContain('break-words');
        expect(remove.className).toContain('shrink-0');
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
describe('RecipeForm (web) — ranged quantity (U9/R42)', () => {
    const lowField = (number = 1) =>
        screen.getByRole<HTMLInputElement>('spinbutton', { name: `Ingredient ${number} quantity` });
    const highField = (number = 1) =>
        screen.getByRole<HTMLInputElement>('spinbutton', { name: `Ingredient ${number} maximum quantity` });

    it('renders BOTH bounds of a stated range, sharing one unit field', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 2, quantityHigh: 3, unit: 'cups' }],
            }),
        });

        expect(lowField().value).toBe('2');
        expect(highField().value).toBe('3');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 unit' }).value).toBe('cups');
    });

    it('leaves the upper bound EMPTY for a single stated value', () => {
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 2 }] }),
        });

        expect(lowField().value).toBe('2');
        expect(highField().value).toBe('');
    });

    it('renders an ABSENT quantity as an empty field, never a zero (R40)', () => {
        renderForm({
            values: filledValues({
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Butter', quantity: Number.NaN, unit: 'the size of an egg' },
                ],
            }),
        });

        expect(lowField().value).toBe('');
        expect(highField().value).toBe('');
    });

    it('states an upper bound when the user types one', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 2 }] }),
            onChange,
        });

        await user.type(highField(), '3');

        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({
                ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 2, quantityHigh: 3 }],
            }),
        );
    });

    it('CLEARS the upper bound back to a single value when the field is emptied', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 2, quantityHigh: 3 }],
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
            values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 2 }] }),
            onChange,
        });

        await user.clear(lowField());

        const next = onChange.mock.calls.at(-1)?.[0] as RecipeFormValues;
        expect(next.ingredients[0]?.quantity).toBeNaN();
    });

    it('marks BOTH bounds invalid and wires them to the alert when the range is incoherent (WCAG 3.3.1)', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 3, quantityHigh: 2 }],
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
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Butter', quantity: Number.NaN },
                    { ingredientId: 'ing_2', name: 'Flour', quantity: 3, quantityHigh: 2 },
                ],
            }),
            errors: { ingredients: 'ingredientsQuantityInvalid' },
        });

        expect(lowField(1).getAttribute('aria-invalid')).toBeNull();
        expect(highField(1).getAttribute('aria-invalid')).toBeNull();
        expect(lowField(2).getAttribute('aria-invalid')).toBe('true');
    });

    it('does NOT mark a quantity on an ingredientsUnresolved error — that error is about the picker', () => {
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: null, name: 'Flour', quantity: 0 }] }),
            errors: { ingredients: 'ingredientsUnresolved' },
        });

        expect(screen.getByRole('textbox', { name: 'Ingredient 1 name' }).getAttribute('aria-invalid')).toBe('true');
        expect(lowField().getAttribute('aria-invalid')).toBeNull();
    });

    it('discloses that the running total was computed from one bound of a range (R38)', () => {
        renderForm({
            values: filledValues({
                ingredients: [
                    {
                        ingredientId: 'ing_1',
                        name: 'Flour',
                        quantity: 100,
                        quantityHigh: 200,
                        unit: 'g',
                        caloriesPer100g: 364,
                    },
                ],
            }),
        });

        expect(screen.getByText('Estimated from the lower amount of each stated range')).toBeTruthy();
    });

    it('shows NO range disclosure when no line states a range', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 100, unit: 'g', caloriesPer100g: 364 }],
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
describe('RecipeForm (web) — the range separator is decorative', () => {
    it('hides the separator glyph from the accessibility tree', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 2, quantityHigh: 3 }],
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
describe('RecipeForm (web) — preparation, section and unit class (U25/U26/U27)', () => {
    it('renders a preparation field per line, seeded from the draft', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2, preparation: 'finely chopped' }],
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
            values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2 }] }),
            onChange,
        });

        await user.type(screen.getByRole('textbox', { name: 'Ingredient 1 preparation' }), 'd');

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2, preparation: 'd' }],
            }),
        );
    });

    it('renders a section field per line, seeded from the draft', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2, groupLabel: 'For the marinade' }],
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
                ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2, unit: 'cup', preparation: 'diced' }],
            }),
            onChange,
        });

        await user.type(screen.getByRole('textbox', { name: 'Ingredient 1 section' }), 'D');

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                ingredients: [
                    {
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
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Rice', quantity: 300 },
                    { ingredientId: 'ing_2', name: 'Stock', quantity: 1 },
                ],
            }),
        });

        // `level: 3` is the section-heading level; the section's own `h2` ("Ingredients") is unaffected.
        expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    });

    it('a GROUPED recipe renders one heading per section, in stored order', () => {
        renderForm({
            values: filledValues({
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Flour', quantity: 2, groupLabel: 'Dry' },
                    { ingredientId: 'ing_2', name: 'Sugar', quantity: 1, groupLabel: 'Dry' },
                    { ingredientId: 'ing_3', name: 'Milk', quantity: 1, groupLabel: 'Wet' },
                ],
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
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Flour', quantity: 2, groupLabel: 'Dry' },
                    { ingredientId: 'ing_2', name: 'Milk', quantity: 1, groupLabel: 'Wet' },
                    { ingredientId: 'ing_3', name: 'Sugar', quantity: 1, groupLabel: 'Dry' },
                ],
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
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Salt', quantity: 1 },
                    { ingredientId: 'ing_2', name: 'Flour', quantity: 2, groupLabel: 'Dry' },
                ],
            }),
        });

        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Dry']);
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 name' }).value).toBe('Salt');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 2 name' }).value).toBe('Flour');
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
                ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2, unit: 'cups' }],
            }),
        });

        expect(screen.queryByText('Cook’s measure')).toBeNull();
        expect(screen.queryByText('Unrecognised unit')).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Ingredient 1 unit' }).getAttribute('aria-describedby')).toBeNull();
    });

    it('marks a SUBJECTIVE unit as a cook’s measure, and describes the field with it', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Basil', quantity: 1, unit: 'handful' }],
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
                ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2, unit: 'blorp' }],
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
            values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Eggs', quantity: 2 }] }),
        });

        expect(screen.queryByText('Unrecognised unit')).toBeNull();
        expect(screen.queryByText('Cook’s measure')).toBeNull();
    });

    // ⛔ Two lines, two different units, ONE render: each note describes ITS OWN row. A shared id would make
    // every unit field point at the first row's note — the defect `fieldErrorIds` exists to avoid.
    it('scopes each unit note to its own row', () => {
        renderForm({
            values: filledValues({
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Basil', quantity: 1, unit: 'handful' },
                    { ingredientId: 'ing_2', name: 'Onion', quantity: 2, unit: 'blorp' },
                ],
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
describe('RecipeForm (web) — typing a section keeps focus (U27)', () => {
    /** Render the form as the real editor does: every `onChange` is applied and re-rendered. */
    const renderStateful = (initial: RecipeFormValues) => {
        const Harness: FC = () => {
            const [values, setValues] = useState(initial);

            return (
                <RecipeForm
                    values={values}
                    mode="create"
                    onChange={setValues}
                    onRequestAddIngredient={noop}
                    onSubmit={noop}
                    onCancel={noop}
                />
            );
        };

        return render(<Harness />);
    };

    const THREE_UNGROUPED = filledValues({
        ingredients: [
            { ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
            { ingredientId: 'ing_2', name: 'Milk', quantity: 1 },
            { ingredientId: 'ing_3', name: 'Sugar', quantity: 1 },
        ],
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
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 1 name' }).value).toBe('Flour');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 2 name' }).value).toBe('Milk');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Ingredient 3 name' }).value).toBe('Sugar');
    });

    // ⛔ F2's half: clearing a label must REJOIN the run above, not leave an empty heading behind.
    it('⛔ CLEARING a section leaves NO empty heading, and rejoins the ungrouped run', async () => {
        const user = userEvent.setup();
        renderStateful(
            filledValues({
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                    { ingredientId: 'ing_2', name: 'Milk', quantity: 1, groupLabel: 'Wet' },
                ],
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
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Flour', quantity: 2, groupLabel: 'Dry' },
                    { ingredientId: 'ing_2', name: 'Sugar', quantity: 1, groupLabel: '  Dry  ' },
                ],
            }),
        );

        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Dry']);
    });
});
