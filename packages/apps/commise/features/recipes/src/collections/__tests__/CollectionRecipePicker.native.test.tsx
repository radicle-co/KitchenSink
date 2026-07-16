/**
 * Native component tests for the collection recipe-picker (rendered via react-native-web under jsdom) — the
 * ADD half of FR-009 (T072). Mirrors the web leaf across EVERY branch so the two platform renders cannot
 * drift: chrome (heading names the collection, search reports upward, done), the fetch states (loading, load
 * error + retry, no-recipes empty + create CTA, no-matches search), and adding (row per candidate, add id
 * reported upward, member marker + suppressed re-add, in-flight busy + suppressed duplicate, the polite
 * success announcement, and the add-failure alert). The member/in-flight controls stay MOUNTED (never
 * unmounted on activation) and mark themselves inert via `accessibilityState.disabled` (which RN announces to
 * screen readers) while suppressing re-activation in the handler — the parallel to the web leaf's
 * `aria-disabled` decision. react-native-web under jsdom does not surface `accessibilityState` as a DOM
 * attribute, so these assert the BEHAVIOR (the inert text marker, the busy label, that the row is still there,
 * and that no `onAdd` fires) rather than the attribute, which a control that merely LOOKED inert would fail.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { CollectionRecipePicker } from '../CollectionRecipePicker.native.js';
import type { CollectionRecipePickerProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

const RECIPES = [
    { id: 'rec_1', title: 'Weeknight Pasta', totalTimeMinutes: 30, updatedAt: '2026-04-19T09:30:00.000Z' },
    { id: 'rec_2', title: 'Sheet-Pan Chicken', totalTimeMinutes: 45, updatedAt: '2026-04-18T09:30:00.000Z' },
] as const;

function renderPicker(overrides: Partial<CollectionRecipePickerProps> = {}) {
    const props: CollectionRecipePickerProps = {
        collectionName: 'Weeknight Dinners',
        status: 'ready',
        recipes: RECIPES,
        memberRecipeIds: [],
        query: '',
        onQueryChange: noop,
        onAdd: noop,
        onRetry: noop,
        onCreateRecipe: noop,
        onDone: noop,
        ...overrides,
    };
    render(<CollectionRecipePicker {...props} />);

    return props;
}

describe('CollectionRecipePicker (native) — chrome', () => {
    it('names the collection it adds to in the heading', () => {
        renderPicker({ collectionName: 'Holiday Baking' });

        expect(screen.getByRole('heading', { name: 'Add recipes to Holiday Baking' })).toBeTruthy();
    });

    it('reports search input upward', () => {
        const onQueryChange = vi.fn();
        renderPicker({ onQueryChange });

        fireEvent.change(screen.getByLabelText('Search your recipes'), { target: { value: 'pasta' } });

        expect(onQueryChange).toHaveBeenCalledWith('pasta');
    });

    it('reports done upward', () => {
        const onDone = vi.fn();
        renderPicker({ onDone });

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        expect(onDone).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionRecipePicker (native) — fetch states', () => {
    it('shows the loading label and no rows while loading', () => {
        renderPicker({ status: 'loading', recipes: [] });

        expect(screen.getByLabelText('Loading your recipes')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Add Weeknight Pasta' })).toBeNull();
    });

    it('shows an alert and retries on request when the load fails', () => {
        const onRetry = vi.fn();
        renderPicker({ status: 'error', recipes: [], onRetry });

        expect(screen.getByRole('alert')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('offers to create a recipe when the caller owns none', () => {
        const onCreateRecipe = vi.fn();
        renderPicker({ recipes: [], query: '', onCreateRecipe });

        expect(screen.getByText('No recipes yet')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));

        expect(onCreateRecipe).toHaveBeenCalledTimes(1);
    });

    it('distinguishes a search with no matches from owning no recipes', () => {
        renderPicker({ recipes: [], query: 'zzz' });

        expect(screen.getByText('No recipes match your search')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        expect(screen.queryByText('No recipes yet')).toBeNull();
    });
});

describe('CollectionRecipePicker (native) — adding', () => {
    it('renders one add control per candidate recipe', () => {
        renderPicker();

        expect(screen.getByRole('button', { name: 'Add Weeknight Pasta' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Add Sheet-Pan Chicken' })).toBeTruthy();
    });

    it('reports the added recipe id upward', () => {
        const onAdd = vi.fn();
        renderPicker({ onAdd });

        fireEvent.click(screen.getByRole('button', { name: 'Add Sheet-Pan Chicken' }));

        expect(onAdd).toHaveBeenCalledWith('rec_2');
    });

    it('marks a member row in text and keeps its control mounted and re-add-suppressed', () => {
        const onAdd = vi.fn();
        renderPicker({ memberRecipeIds: ['rec_1'], onAdd });

        expect(screen.getByText('In this collection')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Add Weeknight Pasta' })).toBeNull();
        // The non-member row is unaffected — membership is per row, not per screen.
        expect(screen.getByRole('button', { name: 'Add Sheet-Pan Chicken' })).toBeTruthy();

        // The control is present and NAMED (not unmounted); activating it adds nothing.
        const control = screen.getByRole('button', { name: 'Weeknight Pasta is in this collection' });

        fireEvent.click(control);
        expect(onAdd).not.toHaveBeenCalled();
    });

    it('marks the in-flight row as busy and suppresses duplicate submissions', () => {
        const onAdd = vi.fn();
        renderPicker({ pendingRecipeId: 'rec_1', onAdd });

        const control = screen.getByRole('button', { name: 'Add Weeknight Pasta' });

        expect(within(control).getByText('Adding…')).toBeTruthy();

        fireEvent.click(control);
        expect(onAdd).not.toHaveBeenCalled();

        // Other rows stay live while one add is in flight.
        fireEvent.click(screen.getByRole('button', { name: 'Add Sheet-Pan Chicken' }));
        expect(onAdd).toHaveBeenCalledWith('rec_2');
    });

    it('announces a successful add', () => {
        renderPicker({ memberRecipeIds: ['rec_1'], lastAddedRecipeId: 'rec_1' });

        expect(screen.getByText('Added Weeknight Pasta')).toBeTruthy();
    });

    it('announces nothing when no add has succeeded', () => {
        renderPicker();

        expect(screen.queryByText('Added Weeknight Pasta')).toBeNull();
    });

    it('surfaces an add failure as an alert without hiding the rows', () => {
        renderPicker({ addFailed: true });

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t add that recipe. Please try again.');
        expect(screen.getByRole('button', { name: 'Add Weeknight Pasta' })).toBeTruthy();
    });
});
