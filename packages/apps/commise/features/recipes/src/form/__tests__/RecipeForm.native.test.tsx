/**
 * Native component tests for the recipe create/edit form (T067), rendered via react-native-web under jsdom.
 * Mirrors the web leaf across EVERY branch — mode-driven headings + submit copy, all Basics fields, the
 * READ-ONLY computed total, dynamic ingredient/step add/remove/change, EVERY resolution-status badge, each
 * validation error, the submitting (disabled) state, the visibility toggle, and submit/cancel — so the two
 * platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { compositeOver, computedContrast, contrastRatio, placeholderContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';
import { CUISINES, FoodResolutionStatus } from '@kitchensink/recipe-core';

// What each Feather glyph was asked to draw. A Feather colour arrives as a PROP, not a style, so
// react-native-web compiles no rule for jsdom to compute — recording the prop is the only way an icon's
// colour stays assertable (see the contrast describe below).
const featherCalls = vi.hoisted(() => [] as { readonly name: string; readonly color: string }[]);

// The native leaf renders its button glyphs via `@expo/vector-icons` (Feather), which needs the Expo font
// runtime — absent under jsdom. Stub it to a decorative no-op; the Button primitive hides the icon from the
// accessibility tree regardless, so what Feather draws is irrelevant to these behavioural/a11y assertions.
// The stub still renders NOTHING — it only records the props it was handed.
vi.mock('@expo/vector-icons', () => ({
    Feather: ({ name, color }: { readonly name: string; readonly color: string }) => {
        featherCalls.push({ name, color });

        return null;
    },
}));

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeForm } from '../RecipeForm.native.js';
import { DESCRIPTION_MAX_LENGTH, defaultRecipeFormValues, TITLE_MAX_LENGTH, type RecipeFormValues } from '../model.js';
import { resolutionStatusLabel, type RecipeFormProps } from '../props.js';
import { recipeFormMessages } from '../messages.js';

afterEach(cleanup);
afterEach(() => {
    featherCalls.length = 0;
});

/**
 * The DISTINCT colours every Feather glyph named `name` was drawn in, in first-seen order. Distinct-and-whole
 * rather than "the first one": several chips draw the same glyph, so `toEqual([token])` proves that EVERY one
 * of them carries the token (and that at least one rendered) instead of measuring whichever came first.
 */
const featherColors = (name: string): readonly string[] => [
    ...new Set(featherCalls.filter((call) => call.name === name).map((call) => call.color)),
];

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
        // U28 — REQUIRED, so a composition cannot forget to say where "+ Add ingredient" leads.
        onRequestAddIngredient: noop,
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
        // U6: cuisine is a Select/dropdown (button trigger showing the current value), not a radio cloud.
        expect(screen.getByRole('button', { name: 'Cuisine' })).toBeTruthy();
        expect(screen.getByText('Italian')).toBeTruthy();
        // U6: tags + dietary flags are CHIP inputs — committed values render as removable chips; drafts empty.
        expect(screen.getByRole('button', { name: 'Remove quick' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove dinner' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove vegetarian' })).toBeTruthy();
        expect(inputValue('Tags')).toBe('');
        expect(inputValue('Dietary flags')).toBe('');
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

    it('adds a tag chip when the draft is submitted (no comma parsing; U6) — appended to existing chips', () => {
        const onChange = vi.fn();
        renderForm({ onChange });

        const draft = screen.getByLabelText('Tags');
        fireEvent.change(draft, { target: { value: 'easy' } });
        // react-native-web maps a single-line TextInput's onSubmitEditing to Enter keydown.
        fireEvent.keyDown(draft, { key: 'Enter' });

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['quick', 'dinner', 'easy'] }));
    });

    it('adds a tag chip via the explicit Add control (U6)', () => {
        const onChange = vi.fn();
        renderForm({ values: filledValues({ tags: [] }), onChange });

        fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'gluten free' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add Tags' }));

        // The whole phrase becomes ONE chip — a space (or comma) is never a separator.
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['gluten free'] }));
    });

    it('removes a tag chip when its remove control is pressed (U6)', () => {
        const onChange = vi.fn();
        renderForm({ onChange });

        fireEvent.click(screen.getByRole('button', { name: 'Remove quick' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ['dinner'] }));
    });
});

/**
 * Cross-platform mirror of the web leaf's `RecipeForm (web) — tinted chip + badge text is WCAG-AA legible`.
 * Every surface is read off the DOM (the tint from the element that paints it, the text colour from the leaf
 * that carries it) so a re-theme of the palette moves the measurement instead of quietly invalidating it —
 * which an `expect(color).toBe(token)` equality check cannot do. Which seafoam sites are accents (3:1) and
 * which are text (4.5:1) is stated once, in `@commise/ui`'s palette JSDoc.
 */
describe('RecipeForm (native) — tinted chip + badge text is WCAG-AA legible', () => {
    /** The opaque colour a chip's contents actually sit on: the chip's OWN tint, flattened onto the field. */
    function chipSurface(value: string): string {
        const chip = screen.getByRole('button', { name: `Remove ${value}` }).parentElement;

        if (chip === null) {
            throw new Error(`Expected the "Remove ${value}" control to sit inside its chip.`);
        }

        return compositeOver(window.getComputedStyle(chip).backgroundColor, palette.white);
    }

    it('makes the tag chip LABEL legible over the chip’s own tint', () => {
        renderForm({ values: filledValues({ tags: ['quick'] }) });

        expect(
            computedContrast(screen.getByText('quick'), { surface: chipSurface('quick') }),
            'tag chip label',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('draws the chip’s × remove glyph in the same legible tone as the label beside it', () => {
        renderForm({ values: filledValues({ tags: ['quick'], dietaryFlags: [] }) });

        // The form's Cancel button draws an `x` of its own (charcoal), so forget what the first paint drew and
        // provoke a repaint of JUST this field — typing in the draft is local ChipInput state, so the only `x`
        // recorded afterwards is this chip's remove glyph.
        featherCalls.length = 0;
        fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'e' } });

        // The glyph's colour is a PROP, so there is no computed style to read — assert the token AND the ratio
        // it buys, so the number stays load-bearing rather than the spelling. Leaving the × seafoam while the
        // label moves would also render one chip in two greens.
        expect(featherColors('x'), 'chip remove glyph colour').toEqual([palette['ocean-dark']]);
        expect(
            contrastRatio(palette['ocean-dark'], chipSurface('quick')),
            'chip remove glyph over the chip tint',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('makes the per-row calories badge legible on the form card', () => {
        renderForm({
            values: filledValues({
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300, unit: 'g', caloriesPer100g: 130 },
                ],
            }),
        });

        expect(computedContrast(screen.getByText('390 cal')), 'calories badge').toBeGreaterThanOrEqual(4.5);
    });

    it('makes the SELECTED cuisine option — label AND check — legible on its highlight', () => {
        renderForm({ values: filledValues({ cuisine: 'Italian' }) });

        // The submit button draws a `check` glyph of its own (white, on its filled background), so forget what
        // the closed form drew: after this point the only `check` on screen is the selected row's affordance.
        featherCalls.length = 0;
        fireEvent.click(screen.getByRole('button', { name: 'Cuisine' }));

        // The selected row paints its own pearl highlight, so that (not white) is what its label sits on.
        const option = screen.getByRole('menuitem', { name: 'Italian' });
        const surface = compositeOver(window.getComputedStyle(option).backgroundColor, palette.white);

        expect(
            computedContrast(within(option).getByText('Italian'), { surface }),
            'selected cuisine label',
        ).toBeGreaterThanOrEqual(4.5);
        expect(featherColors('check'), 'selected cuisine check colour').toEqual([palette['ocean-dark']]);
        expect(
            contrastRatio(palette['ocean-dark'], surface),
            'selected cuisine check over its highlight',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

describe('RecipeForm (native) — cuisine dropdown (w3/e5; U6 Select, not a radio cloud)', () => {
    /** Open the collapsed dropdown so its options render. */
    const openMenu = (): void => {
        fireEvent.click(screen.getByRole('button', { name: 'Cuisine' }));
    };

    it('renders a collapsed Select trigger showing the current cuisine (no radio cloud)', () => {
        renderForm({ values: filledValues({ cuisine: 'Italian' }) });

        expect(screen.getByRole('button', { name: 'Cuisine' })).toBeTruthy();
        expect(screen.getByText('Italian')).toBeTruthy();
        // The options are collapsed until opened — no radio group.
        expect(screen.queryByRole('radiogroup', { name: 'Cuisine' })).toBeNull();
        expect(screen.queryByRole('menuitem', { name: 'Thai' })).toBeNull();
    });

    it('lists every curated CUISINES option plus the explicit "no cuisine" choice when opened', () => {
        renderForm({ values: filledValues({ cuisine: '' }) });

        openMenu();

        for (const cuisine of CUISINES) {
            expect(screen.getByRole('menuitem', { name: cuisine })).toBeTruthy();
        }

        expect(screen.getByRole('menuitem', { name: 'No cuisine' })).toBeTruthy();
    });

    it('keeps a preselected CUSTOM cuisine (not in CUISINES) visible + selected, never lost', () => {
        renderForm({ values: filledValues({ cuisine: 'Grandma’s Secret Blend' }) });

        // Visible on the collapsed trigger…
        expect(screen.getByText('Grandma’s Secret Blend')).toBeTruthy();
        // …and present as a selected option once opened.
        openMenu();
        expect(screen.getByRole('menuitem', { name: 'Grandma’s Secret Blend' }).getAttribute('aria-selected')).toBe(
            'true',
        );
    });

    it('reports a cuisine selection upward, preserving the free-text wire contract', () => {
        const onChange = vi.fn();
        renderForm({ values: filledValues({ cuisine: 'Italian' }), onChange });

        openMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Thai' }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cuisine: 'Thai' }));
    });

    it('reports the explicit clear ("No cuisine") selection upward', () => {
        const onChange = vi.fn();
        renderForm({ values: filledValues({ cuisine: 'Italian' }), onChange });

        openMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'No cuisine' }));

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

    /** REWRITTEN + SPLIT for U9 — see the web suite for the rationale. One test per error code. */
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

        expect(screen.getByLabelText('Ingredient 1 name').getAttribute('aria-invalid')).toBe('true');
        // ⚠️ WIDENED BY U28 (was `toBe(alert.id)`) — see the web leaf's test for the reasoning: the field is
        // now described by its OWN "no food chosen" note as well as the section alert, and what must stay
        // true is that the alert is still REACHED.
        expect(screen.getByLabelText('Ingredient 1 name').getAttribute('aria-describedby')?.split(' ')).toContain(
            alert.id,
        );
        expect(screen.getByLabelText('Ingredient 1 quantity').getAttribute('aria-invalid')).toBeNull();

        expect(screen.getByLabelText('Ingredient 2 name').getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByLabelText('Ingredient 2 quantity').getAttribute('aria-invalid')).toBeNull();

        expect(screen.getByLabelText('Ingredient 3 name').getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByLabelText('Ingredient 3 quantity').getAttribute('aria-invalid')).toBeNull();
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

    /**
     * REWRITTEN for U28 (was: "… and an UNRESOLVED line’s name editable (U6)") — see the web leaf's test
     * for the full reasoning. Every name field is read-only now: a food is picked, never typed.
     */
    it('renders EVERY line’s name READ-ONLY, resolved or not (U28)', () => {
        cleanup();
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Arborio rice', quantity: 300 }] }),
        });
        // `editable={false}` renders a readOnly DOM input under react-native-web.
        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 1 name').readOnly).toBe(true);

        cleanup();
        renderForm({ values: filledValues({ ingredients: [{ ingredientId: null, name: 'rice', quantity: 1 }] }) });
        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 1 name').readOnly).toBe(true);
        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 1 name').value).toBe('rice');
    });

    /**
     * REWRITTEN for U28 (was: "appends a blank ingredient line on add") — the mutant guard for "restore the
     * append-an-empty-row behaviour" on this platform. See the web leaf's test for the full reasoning.
     */
    it('⛔ asks for the PICKER on add — and changes no values (U28)', () => {
        const onChange = vi.fn();
        const onRequestAddIngredient = vi.fn();
        renderForm({ values: filledValues({ ingredients: [] }), onChange, onRequestAddIngredient });

        fireEvent.click(screen.getByRole('button', { name: 'Add ingredient' }));

        expect(onRequestAddIngredient).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
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

    /**
     * REWRITTEN for U28 (was: "reports an UNRESOLVED line’s name edit upward ... U6") — the inverse
     * assertion; see the web leaf's test for the reasoning.
     */
    it('emits NOTHING when an unresolved line’s name is typed into (U28)', () => {
        const onChange = vi.fn();
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: null, name: 'ric', quantity: 1 }] }),
            onChange,
        });

        fireEvent.change(screen.getByLabelText('Ingredient 1 name'), { target: { value: 'rice' } });

        expect(onChange).not.toHaveBeenCalled();
    });

    it.each([
        [FoodResolutionStatus.PENDING, 'Resolving…'],
        [FoodResolutionStatus.UNRESOLVED, 'Not resolved'],
        [FoodResolutionStatus.RESOLVED, 'Resolved'],
        [FoodResolutionStatus.NOT_FOUND, 'No match found'],
        [FoodResolutionStatus.FAILED, 'Resolution failed'],
        // ⚠️ EXTENDED for U14, not rewritten — see the web mirror.
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
    });

    it('⛔ styles the NEEDS_REVIEW badge differently from every other status (U14)', () => {
        // The native mirror of the web assertion, case for case: a doubted line is the ONE status a cook can
        // act on, and the editor is where they act. Compared against the OTHER statuses rather than against a
        // literal colour, so it pins the DISTINCTION rather than today's palette.
        const styleOf = (status: (typeof FoodResolutionStatus)[keyof typeof FoodResolutionStatus]): string => {
            cleanup();
            renderForm({
                values: filledValues({
                    ingredients: [{ ingredientId: 'ing_1', name: 'Rice', quantity: 1, resolutionStatus: status }],
                }),
            });

            const badge = screen.getByText(resolutionStatusLabel(recipeFormMessages.en, status));

            return getComputedStyle(badge).color + '|' + getComputedStyle(badge).backgroundColor;
        };

        const review = styleOf(FoodResolutionStatus.NEEDS_REVIEW);

        for (const other of [
            FoodResolutionStatus.PENDING,
            FoodResolutionStatus.UNRESOLVED,
            FoodResolutionStatus.RESOLVED,
            FoodResolutionStatus.NOT_FOUND,
            FoodResolutionStatus.FAILED,
        ] as const) {
            expect(review).not.toBe(styleOf(other));
        }
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
 * Regression (Maestro CI view-hierarchy dump): the instruction row is
 * `[number][instruction input][timer input][Remove step N]` on ONE non-wrapping line, and React Native
 * defaults `flexShrink` to 0 — so its ~28 + 178 + 88 + ~160dp of children could not fit the ~296dp a 360dp
 * phone leaves inside the screen's and the card's paddings. On-device the remove button was laid out at
 * x=999..1080 on a 1080px-wide display: half of it past the screen edge, so the only way to delete an
 * instruction was untappable. Same family as `CollectionHeader.native.tsx`'s clipped Rename/absent Delete.
 *
 * The fix is the treatment this file's INGREDIENT row already carries (and the web leaf's `min-w-0 flex-1`
 * field + wrapping row): the row WRAPS, the flexible field yields width, and the destructive action never
 * shrinks. Note that shrinking ALONE would not do — with all four children on one line the instruction field
 * would be squeezed to a few dp — which is why the wrap is the load-bearing half. jsdom has no layout engine,
 * so this pins the flex CONTRACT that makes the off-screen action unrepresentable.
 */
describe('RecipeForm (native) — an instruction row cannot push its remove action off the screen edge', () => {
    /** The instruction row itself — the `stepRow` View laying out marker + inputs + Remove. */
    const stepRow = (): HTMLElement => screen.getByLabelText('Step 1 instruction').parentElement as HTMLElement;

    /** The row-level slot holding the remove control (the child of the row that the button lives inside). */
    const removeSlot = (): HTMLElement => {
        const row = stepRow();
        let node = screen.getByRole('button', { name: 'Remove step 1' });

        while (node.parentElement !== null && node.parentElement !== row) {
            node = node.parentElement;
        }

        return node;
    };

    it('wraps the row, so a child that does not fit moves to the next line instead of off the screen', () => {
        renderForm();

        expect(appliedStyle(stepRow(), 'flex-wrap')).toBe('wrap');
    });

    it('lets the instruction field yield width rather than claim its full intrinsic size', () => {
        renderForm();

        expect(appliedStyle(screen.getByLabelText('Step 1 instruction'), 'flex-shrink')).toBe('1');
    });

    it('never shrinks the remove action itself, so its label and touch target are never clipped', () => {
        renderForm();

        expect(appliedStyle(removeSlot(), 'flex-shrink')).toBe('0');
    });

    it('keeps the remove control at the 44pt touch floor', () => {
        renderForm();

        // The row treatment must not squeeze the pill below the comfortable touch target `Button` guarantees.
        const button = screen.getByRole('button', { name: 'Remove step 1' });

        expect(appliedStyle(button.firstElementChild as Element, 'min-height')).toBe('44px');
    });

    it('applies the same non-shrinking treatment to the ingredient row action (one row contract, both rows)', () => {
        renderForm();

        const row = screen.getByLabelText('Ingredient 1 name').parentElement as HTMLElement;
        let node = screen.getByRole('button', { name: 'Remove ingredient 1' });

        while (node.parentElement !== null && node.parentElement !== row) {
            node = node.parentElement;
        }

        expect(appliedStyle(row, 'flex-wrap')).toBe('wrap');
        expect(appliedStyle(node, 'flex-shrink')).toBe('0');
    });
});

/**
 * Same regression sweep, two more rows in this form whose variable text is USER-SUPPLIED:
 *
 *  - the cuisine Select's trigger and its option rows are `[label][chevron|check]` at
 *    `justifyContent: 'space-between'` — and a non-curated CUSTOM cuisine value is deliberately preserved and
 *    shown (see `CuisineSelect.native.tsx`), so a long one pushed the chevron (the only affordance that opens
 *    the menu) and the selected-state check off the field's right edge;
 *  - a tag/dietary-flag chip is `[tag][×]`, so a long tag pushed its OWN remove control out — and that control
 *    is the field's only removal path, making the tag unremovable.
 *
 * The contract is the same one `CollectionHeader.native.tsx` documents: user text shrinks, chrome does not.
 */
describe('RecipeForm (native) — user-supplied values cannot push a row control off the field edge', () => {
    const longCuisine = 'Coastal Ligurian home cooking with a Provençal accent';
    const longTag = 'weeknight-dinner-for-a-crowd-of-hungry-teenagers';

    it('lets the cuisine trigger label shrink, keeping the disclosure chevron on the field', () => {
        renderForm({ values: filledValues({ cuisine: longCuisine }) });

        expect(appliedStyle(screen.getByText(longCuisine), 'flex-shrink')).toBe('1');
    });

    it('lets a cuisine option label shrink, keeping its selected-state check visible', () => {
        renderForm({ values: filledValues({ cuisine: longCuisine }) });

        fireEvent.click(screen.getByRole('button', { name: 'Cuisine' }));

        const option = screen.getByRole('menuitem', { name: longCuisine });

        expect(appliedStyle(within(option).getByText(longCuisine), 'flex-shrink')).toBe('1');
    });

    it('lets a chip label shrink but never its remove control, so a long tag stays removable', () => {
        renderForm({ values: filledValues({ tags: [longTag] }) });

        const remove = screen.getByRole('button', { name: `Remove ${longTag}` });

        expect(appliedStyle(screen.getByText(longTag), 'flex-shrink')).toBe('1');
        expect(appliedStyle(remove, 'flex-shrink')).toBe('0');
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

describe('RecipeForm (native) — PLACEHOLDER text clears the AA body-text floor', () => {
    /**
     * Placeholder copy is TEXT a reader reads — it is a field's only visible instruction before they type — so
     * it owes the 4.5:1 of SC 1.4.3, not the 3:1 an accent owes. Both of this form's field leaves passed
     * `placeholderTextColor={palette.mist}` (1.90:1 on their white fields), which the palette JSDoc in
     * `@commise/ui`'s `tokens/colors.ts` names as a hairline tone that is never a text tone.
     *
     * `placeholderContrast` reads the colour react-native-web actually paints (it lands as the
     * `--placeholderTextColor` custom property that the compiled `::placeholder` rule resolves), so this fails
     * both if the token drifts and if the prop stops being passed at all.
     */
    it('gives the basics fields (RecipeBasicsFields) a legible placeholder', () => {
        renderForm({ values: filledValues({ title: '' }) });

        expect(
            placeholderContrast(screen.getByLabelText('Title')),
            'title-field placeholder on its white field',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('gives the tag/dietary ChipInput a legible placeholder', () => {
        renderForm();

        expect(
            placeholderContrast(screen.getByLabelText('Tags')),
            'ChipInput placeholder on its white field',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

/**
 * U9 / R42 — the two-bound quantity field, native leaf.
 *
 * The one-for-one mirror of the web suite's ranged-quantity block: same states, same accessible names, same
 * marking rules. §14's cross-platform rule is what makes this a mirror rather than a variation — a range
 * that renders on one platform and not the other is the failure both suites exist to catch.
 */
describe('RecipeForm (native) — ranged quantity (U9/R42)', () => {
    const lowField = (number = 1) => screen.getByLabelText<HTMLInputElement>(`Ingredient ${number} quantity`);
    const highField = (number = 1) => screen.getByLabelText<HTMLInputElement>(`Ingredient ${number} maximum quantity`);

    it('renders BOTH bounds of a stated range, sharing one unit field', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 2, quantityHigh: 3, unit: 'cups' }],
            }),
        });

        expect(lowField().value).toBe('2');
        expect(highField().value).toBe('3');
        expect(inputValue('Ingredient 1 unit')).toBe('cups');
    });

    it('leaves the upper bound EMPTY for a single stated value', () => {
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 2 }] }),
        });

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

    it('states an upper bound when the user types one', () => {
        const onChange = vi.fn();
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 2 }] }),
            onChange,
        });

        fireEvent.change(highField(), { target: { value: '3' } });

        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({
                ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 2, quantityHigh: 3 }],
            }),
        );
    });

    it('CLEARS the upper bound back to a single value when the field is emptied', () => {
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 2, quantityHigh: 3 }],
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
            values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Flour', quantity: 2 }] }),
            onChange,
        });

        fireEvent.change(lowField(), { target: { value: '' } });

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

        expect(screen.getByLabelText('Ingredient 1 name').getAttribute('aria-invalid')).toBe('true');
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
 * U9 — the separator glyph is PUNCTUATION, and the native spelling of "hidden" is the load-bearing part.
 *
 * ⛔ THE REGRESSION THIS CATCHES. `importantForAccessibility="no"` reads as correct RN and produces NO DOM
 * attribute under react-native-web, so the web build would carry a bare dash in its accessibility tree with
 * nothing failing. `aria-hidden` reverse-maps onto RN's own pair on device AND emits the attribute here —
 * the same reasoning `RecipeWidgetSkeleton.native.tsx` records, and the same form the web leaf uses.
 */
describe('RecipeForm (native) — the range separator is decorative', () => {
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
 * U25/U26/U27 — the three new ingredient-row affordances on the NATIVE leaf, in every state.
 *
 * ⛔ The cross-platform rule (§14) means these are not "the web tests again": a field that ships to one
 * platform and not the other is precisely what that rule exists to stop, and the two leaves are separate
 * files with no compiler edge between them. The FOLD and the note MAPPING are shared (`props.ts`), so what
 * these prove is that this leaf renders what the shared layer produces.
 */
describe('RecipeForm (native) — preparation, section and unit class (U25/U26/U27)', () => {
    it('renders a preparation field per line, seeded from the draft', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2, preparation: 'finely chopped' }],
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
            values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2 }] }),
            onChange,
        });

        fireEvent.change(screen.getByLabelText('Ingredient 1 preparation'), { target: { value: 'diced' } });

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2, preparation: 'diced' }],
            }),
        );
    });

    it('renders a section field per line, seeded from the draft', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2, groupLabel: 'For the marinade' }],
            }),
        });

        expect(inputValue('Ingredient 1 section')).toBe('For the marinade');
    });

    it('reports a section edit upward, preserving the line’s other fields', () => {
        const onChange = vi.fn();
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2, unit: 'cup', preparation: 'diced' }],
            }),
            onChange,
        });

        fireEvent.change(screen.getByLabelText('Ingredient 1 section'), { target: { value: 'Dry' } });

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                ingredients: [
                    {
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
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Rice', quantity: 300 },
                    { ingredientId: 'ing_2', name: 'Stock', quantity: 1 },
                ],
            }),
        });

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
        expect(inputValue('Ingredient 1 name')).toBe('Salt');
        expect(inputValue('Ingredient 2 name')).toBe('Flour');
    });

    it('marks a CANONICAL unit with no note at all', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2, unit: 'cups' }],
            }),
        });

        expect(screen.queryByText('Cook’s measure')).toBeNull();
        expect(screen.queryByText('Unrecognised unit')).toBeNull();
    });

    it('marks a SUBJECTIVE unit as a cook’s measure, and describes the field with it', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Basil', quantity: 1, unit: 'handful' }],
            }),
        });

        const note = screen.getByText('Cook’s measure');

        expect(screen.getByLabelText('Ingredient 1 unit').getAttribute('aria-describedby')).toBe(note.id);
    });

    it('marks an UNKNOWN unit as unrecognised — and still ACCEPTS it', () => {
        renderForm({
            values: filledValues({
                ingredients: [{ ingredientId: 'ing_1', name: 'Onion', quantity: 2, unit: 'blorp' }],
            }),
        });

        const note = screen.getByText('Unrecognised unit');

        expect(screen.getByLabelText('Ingredient 1 unit').getAttribute('aria-describedby')).toBe(note.id);
        expect(inputValue('Ingredient 1 unit')).toBe('blorp');
    });

    it('marks an EMPTY unit with NO note — a unitless line is not an unrecognised one', () => {
        renderForm({
            values: filledValues({ ingredients: [{ ingredientId: 'ing_1', name: 'Eggs', quantity: 2 }] }),
        });

        expect(screen.queryByText('Unrecognised unit')).toBeNull();
        expect(screen.queryByText('Cook’s measure')).toBeNull();
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
describe('RecipeForm (native) — a section resplit does not remount the rows (U27)', () => {
    /** The form's props for the given lines — `render`ed directly so this test can `rerender` in place. */
    const propsFor = (ingredients: RecipeFormValues['ingredients']): RecipeFormProps => ({
        values: filledValues({ ingredients }),
        mode: 'create',
        onChange: noop,
        onRequestAddIngredient: noop,
        onSubmit: noop,
        onCancel: noop,
    });

    it('⛔ keeps the SAME row input across a resplit — the row is never unmounted', () => {
        const { rerender } = render(
            <RecipeForm
                {...propsFor([
                    { ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                    { ingredientId: 'ing_2', name: 'Milk', quantity: 1 },
                    { ingredientId: 'ing_3', name: 'Sugar', quantity: 1 },
                ])}
            />,
        );

        const before = screen.getByLabelText('Ingredient 2 section');

        rerender(
            <RecipeForm
                {...propsFor([
                    { ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                    { ingredientId: 'ing_2', name: 'Milk', quantity: 1, groupLabel: 'D' },
                    { ingredientId: 'ing_3', name: 'Sugar', quantity: 1 },
                ])}
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
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Flour', quantity: 2 },
                    { ingredientId: 'ing_2', name: 'Milk', quantity: 1, groupLabel: '' },
                ],
            }),
        });

        expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    });

    it('⛔ treats a PADDED label as the same section as its trimmed twin', () => {
        renderForm({
            values: filledValues({
                ingredients: [
                    { ingredientId: 'ing_1', name: 'Flour', quantity: 2, groupLabel: 'Dry' },
                    { ingredientId: 'ing_2', name: 'Sugar', quantity: 1, groupLabel: '  Dry  ' },
                ],
            }),
        });

        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Dry']);
    });
});
