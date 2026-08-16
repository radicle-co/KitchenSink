/**
 * Component tests for the WEB ingredient-checkoff panel (FR-032a, T-015).
 *
 * Every state the panel can be in is covered — dismissed, open+empty, open+populated with none / some / all
 * checked — plus the two invariants FR-032a is really about:
 *  1. the panel is a pure CONTROLLED surface: checked ids arrive as props and the only thing that leaves is
 *     `onToggleIngredient(id)` with the EXACT ingredient id (the mutation lens — an index-for-id or
 *     name-for-id slip fails here);
 *  2. it MUST NOT mutate the stored recipe — the ingredient fixtures are FROZEN (a write throws in a strict
 *     ES module), are compared against a pristine clone after every interaction, and `fetch` is stubbed and
 *     asserted un-called, which is the "no write request is issued" of ATS-008-J6 / STS-009-E1.
 *
 * Queried through roles and accessible names only (NFR-003) — no `data-testid`, no CSS assertions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import type { RecipeIngredientView } from '@kitchensink/recipe-core';

import { IngredientChecklist } from '../IngredientChecklist';
import type { IngredientChecklistProps } from '../sessionExtras';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const noop = () => undefined;

const FLOUR = 'ing-flour';
const SUGAR = 'ing-sugar';
const SALT = 'ing-salt';

/** Frozen on purpose: the panel is read-only over the recipe, so any in-place write throws instead of hiding. */
const makeIngredient = (overrides: Partial<RecipeIngredientView> = {}): RecipeIngredientView =>
    Object.freeze({
        ingredientId: FLOUR,
        name: 'Flour',
        quantity: 200,
        unit: 'g',
        isUserEntered: false,
        ...overrides,
    });

const makeIngredients = (): readonly RecipeIngredientView[] =>
    Object.freeze([
        makeIngredient(),
        makeIngredient({ ingredientId: SUGAR, name: 'Sugar', quantity: 50 }),
        makeIngredient({ ingredientId: SALT, name: 'Salt', quantity: 1, unit: 'tsp' }),
    ]);

function renderChecklist(overrides: Partial<IngredientChecklistProps> = {}) {
    const props: IngredientChecklistProps = {
        ingredients: makeIngredients(),
        checkedIngredientIds: [],
        isOpen: true,
        onToggleIngredient: noop,
        onDismiss: noop,
        ...overrides,
    };
    render(
        <LocaleProvider locale="en">
            <IngredientChecklist {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('IngredientChecklist (web) — open / dismissed', () => {
    it('renders nothing at all while dismissed, so the active step is untouched', () => {
        renderChecklist({ isOpen: false });

        expect(screen.queryByRole('region', { name: 'Ingredient checklist' })).toBeNull();
        expect(screen.queryByRole('checkbox')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Close ingredients' })).toBeNull();
    });

    it('renders the labelled panel when open', () => {
        renderChecklist();

        expect(screen.getByRole('region', { name: 'Ingredient checklist' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Ingredients' })).toBeTruthy();
    });

    it('reports dismissal upward instead of owning the open state', () => {
        const onDismiss = vi.fn();
        renderChecklist({ onDismiss });

        fireEvent.click(screen.getByRole('button', { name: 'Close ingredients' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('offers NO control that could leave the current step — the close affordance is the only button', () => {
        // FR-032a: the list opens and dismisses WITHOUT leaving the step. A step-navigation control smuggled
        // into this panel (or a link out of it) fails here.
        renderChecklist();

        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0]?.getAttribute('aria-label')).toBe('Close ingredients');
        expect(screen.queryByRole('link')).toBeNull();
    });
});

describe('IngredientChecklist (web) — empty state', () => {
    it('states the recipe has no ingredients, and renders no checkboxes', () => {
        renderChecklist({ ingredients: [] });

        expect(screen.getByRole('region', { name: 'Ingredient checklist' }).textContent).toContain(
            'This recipe has no ingredients listed.',
        );
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });
});

describe('IngredientChecklist (web) — populated states', () => {
    it('lists every ingredient as a checkbox named "quantity unit name"', () => {
        renderChecklist();

        expect(screen.getAllByRole('checkbox')).toHaveLength(3);
        expect(screen.getByRole('checkbox', { name: '200 g Flour' })).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: '50 g Sugar' })).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: '1 tsp Salt' })).toBeTruthy();
    });

    it('shows every box unchecked, and 0-of-N progress, when nothing is checked', () => {
        renderChecklist({ checkedIngredientIds: [] });

        expect(screen.getAllByRole('checkbox', { checked: false })).toHaveLength(3);
        expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
        expect(screen.getByLabelText('0 of 3 checked')).toBeTruthy();
    });

    it('checks EXACTLY the ingredients whose ids arrived as props (mutation lens: id-keyed, not positional)', () => {
        renderChecklist({ checkedIngredientIds: [SALT] });

        expect(screen.getByRole('checkbox', { name: '1 tsp Salt', checked: true })).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: '200 g Flour', checked: false })).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: '50 g Sugar', checked: false })).toBeTruthy();
        expect(screen.getByLabelText('1 of 3 checked')).toBeTruthy();
    });

    it('shows every box checked, and N-of-N progress, when all ids are checked', () => {
        renderChecklist({ checkedIngredientIds: [FLOUR, SUGAR, SALT] });

        expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(3);
        expect(screen.getByLabelText('3 of 3 checked')).toBeTruthy();
    });

    it('ignores a checked id the recipe no longer contains rather than inflating the count', () => {
        // Session restore can carry a ghost id (the recipe changed underneath the session). The panel counts
        // the RECIPE's ingredients, so a ghost cannot push progress past the total.
        renderChecklist({ checkedIngredientIds: [FLOUR, 'ing-removed'] });

        expect(screen.getByLabelText('1 of 3 checked')).toBeTruthy();
    });

    it('conveys checked state with a glyph, not colour alone (NFR-004)', () => {
        renderChecklist({ checkedIngredientIds: [SUGAR] });

        expect(screen.getByRole('checkbox', { name: '50 g Sugar', checked: true }).textContent).toContain('✓');
        expect(screen.getByRole('checkbox', { name: '200 g Flour', checked: false }).textContent).not.toContain('✓');
    });
});

describe('IngredientChecklist (web) — toggling', () => {
    it('reports the toggled ingredient id upward (mutation lens: the id, never the index or the name)', () => {
        const onToggleIngredient = vi.fn();
        renderChecklist({ onToggleIngredient });

        fireEvent.click(screen.getByRole('checkbox', { name: '50 g Sugar' }));

        expect(onToggleIngredient).toHaveBeenCalledTimes(1);
        expect(onToggleIngredient).toHaveBeenCalledWith(SUGAR);
    });

    it('reports an UNcheck the same way — the panel owns no state of its own', () => {
        const onToggleIngredient = vi.fn();
        renderChecklist({ checkedIngredientIds: [SALT], onToggleIngredient });

        fireEvent.click(screen.getByRole('checkbox', { name: '1 tsp Salt' }));

        expect(onToggleIngredient).toHaveBeenCalledWith(SALT);
    });

    it('does not check a box on its own — the rendered state follows props only', () => {
        const onToggleIngredient = vi.fn();
        renderChecklist({ onToggleIngredient });

        fireEvent.click(screen.getByRole('checkbox', { name: '200 g Flour' }));

        // Uncontrolled internal state would flip the box here; the panel must still show it unchecked.
        expect(screen.getByRole('checkbox', { name: '200 g Flour', checked: false })).toBeTruthy();
        expect(screen.getByLabelText('0 of 3 checked')).toBeTruthy();
    });
});

describe('IngredientChecklist (web) — never mutates the stored recipe (FR-032a, REQ-CN-001)', () => {
    it('issues no write of any kind and leaves the recipe data untouched', () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const ingredients = makeIngredients();
        const pristine = structuredClone(ingredients) as RecipeIngredientView[];
        const onToggleIngredient = vi.fn();

        renderChecklist({ ingredients, checkedIngredientIds: [FLOUR], onToggleIngredient, scaleFactor: 2 });

        for (const box of screen.getAllByRole('checkbox')) {
            fireEvent.click(box);
        }

        fireEvent.click(screen.getByRole('button', { name: 'Close ingredients' }));

        // No transport was touched…
        expect(fetchSpy).not.toHaveBeenCalled();
        // …the recipe's own ingredient data is byte-for-byte what it was (a frozen write would have thrown)…
        expect(ingredients).toEqual(pristine);
        // …and the ONLY thing that left the component is intent.
        expect(onToggleIngredient.mock.calls.map(([id]) => id)).toEqual([FLOUR, SUGAR, SALT]);
    });
});

describe('IngredientChecklist (web) — scaled quantities (FR-034a)', () => {
    it('displays stored quantities at 1x', () => {
        renderChecklist({ scaleFactor: 1 });

        expect(screen.getByRole('checkbox', { name: '200 g Flour' })).toBeTruthy();
    });

    it('doubles the DISPLAYED quantity at 2x (ATS-008-J1) without touching the ingredient data', () => {
        const ingredients = makeIngredients();
        renderChecklist({ ingredients, scaleFactor: 2 });

        expect(screen.getByRole('checkbox', { name: '400 g Flour' })).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: '100 g Sugar' })).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: '2 tsp Salt' })).toBeTruthy();
        expect(ingredients[0]?.quantity).toBe(200);
    });

    it('halves the DISPLAYED quantity at 0.5x (ATS-008-J2)', () => {
        renderChecklist({ scaleFactor: 0.5 });

        expect(screen.getByRole('checkbox', { name: '100 g Flour' })).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: '0.5 tsp Salt' })).toBeTruthy();
    });

    it('keeps the checked ids keyed to the ingredient, not to the displayed quantity', () => {
        const onToggleIngredient = vi.fn();
        renderChecklist({ checkedIngredientIds: [FLOUR], scaleFactor: 3, onToggleIngredient });

        expect(screen.getByRole('checkbox', { name: '600 g Flour', checked: true })).toBeTruthy();
        fireEvent.click(screen.getByRole('checkbox', { name: '600 g Flour' }));
        expect(onToggleIngredient).toHaveBeenCalledWith(FLOUR);
    });
});
