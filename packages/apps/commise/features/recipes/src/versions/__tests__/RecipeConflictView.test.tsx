// @vitest-environment jsdom
/**
 * Component tests for the web concurrent-edit conflict view (T070 / C-005). Covers both sides rendered
 * with their differing fields (title, servings, times, ingredient/step counts) as accessible regions, that
 * the user's OWN draft title (`mineTitle`, not `mine.title`) drives the mine side, and that the two
 * resolution choices fire their handlers — asserting on role/name/text so a dropped side or field fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { makeIngredientView, makeRecipeDetail, makeRecipeFormValues, makeStepView } from '../../__fixtures__/index.js';
import { RecipeConflictView } from '../RecipeConflictView.js';
import type { RecipeConflictViewProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

const ingredients = (count: number) =>
    Array.from({ length: count }, (_unused, index) => makeIngredientView({ ingredientId: `ing_${index}` }));
const steps = (count: number) =>
    Array.from({ length: count }, (_unused, index) => makeStepView({ stepNumber: index + 1 }));

const mine = makeRecipeDetail({
    title: 'IGNORED_MINE_TITLE',
    servings: 6,
    prepTimeMinutes: 15,
    cookTimeMinutes: 25,
    totalTimeMinutes: 50,
    ingredients: ingredients(3),
    steps: steps(5),
});

const theirs = makeRecipeDetail({
    title: 'Latest Saved Title',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    totalTimeMinutes: 30,
    ingredients: ingredients(2),
    steps: steps(4),
});

const mineValues = makeRecipeFormValues({ title: 'My Draft Title', servings: 6 });
const theirsValues = makeRecipeFormValues({ title: 'Latest Saved Title', servings: 4 });

function renderConflict(overrides: Partial<RecipeConflictViewProps> = {}) {
    const props: RecipeConflictViewProps = {
        mineTitle: 'My Draft Title',
        theirs,
        mine,
        mineValues,
        theirsValues,
        onKeepMine: noop,
        onUseTheirs: noop,
        onMerge: noop,
        ...overrides,
    };
    render(<RecipeConflictView {...props} />);

    return props;
}

describe('RecipeConflictView (web) — structure', () => {
    it('renders a heading for each side', () => {
        renderConflict();

        expect(screen.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Your version' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Latest saved version' })).toBeTruthy();
    });
});

describe('RecipeConflictView (web) — mine side', () => {
    it('shows the user’s own draft title, not the base recipe title', () => {
        renderConflict();

        const region = screen.getByRole('region', { name: 'Your version' });
        expect(within(region).getByText('My Draft Title')).toBeTruthy();
        expect(screen.queryByText('IGNORED_MINE_TITLE')).toBeNull();
    });

    it('shows the mine side’s differing fields', () => {
        renderConflict();

        const region = screen.getByRole('region', { name: 'Your version' });
        expect(within(region).getByText('6')).toBeTruthy();
        expect(within(region).getByText('15 min')).toBeTruthy();
        expect(within(region).getByText('25 min')).toBeTruthy();
        expect(within(region).getByText('50 min')).toBeTruthy();
        expect(within(region).getByText('3 ingredients')).toBeTruthy();
        expect(within(region).getByText('5 steps')).toBeTruthy();
    });
});

describe('RecipeConflictView (web) — theirs side', () => {
    it('shows the latest saved version’s differing fields', () => {
        renderConflict();

        const region = screen.getByRole('region', { name: 'Latest saved version' });
        expect(within(region).getByText('Latest Saved Title')).toBeTruthy();
        expect(within(region).getByText('4')).toBeTruthy();
        expect(within(region).getByText('10 min')).toBeTruthy();
        expect(within(region).getByText('20 min')).toBeTruthy();
        expect(within(region).getByText('30 min')).toBeTruthy();
        expect(within(region).getByText('2 ingredients')).toBeTruthy();
        expect(within(region).getByText('4 steps')).toBeTruthy();
    });
});

describe('RecipeConflictView (web) — choices', () => {
    it('fires keep-mine when the user keeps their version', () => {
        const onKeepMine = vi.fn();
        renderConflict({ onKeepMine });

        fireEvent.click(screen.getByRole('button', { name: 'Keep my version' }));

        expect(onKeepMine).toHaveBeenCalledTimes(1);
    });

    it('fires use-theirs when the user takes the latest version', () => {
        const onUseTheirs = vi.fn();
        renderConflict({ onUseTheirs });

        fireEvent.click(screen.getByRole('button', { name: 'Use the latest version' }));

        expect(onUseTheirs).toHaveBeenCalledTimes(1);
    });

    it('offers all three FR-007c options up front (keep mine, use theirs, merge)', () => {
        renderConflict();

        expect(screen.getByRole('button', { name: 'Keep my version' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Use the latest version' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Merge field by field' })).toBeTruthy();
    });
});

describe('RecipeConflictView (web) — field-by-field merge (FR-007c option c)', () => {
    const enterMerge = () => fireEvent.click(screen.getByRole('button', { name: 'Merge field by field' }));

    it('enters merge mode with a per-field chooser defaulting to the user’s draft', () => {
        renderConflict();
        enterMerge();

        expect(screen.getByRole('heading', { name: 'Merge changes field by field' })).toBeTruthy();
        // Each editable field is its own radio group; title defaults to the user's draft value.
        const titleGroup = screen.getByRole('radiogroup', { name: 'Title' });
        const mineRadio = within(titleGroup).getByRole('radio', { name: 'Your version: My Draft Title' });
        const theirsRadio = within(titleGroup).getByRole('radio', { name: 'Latest saved version: Latest Saved Title' });
        expect((mineRadio as HTMLInputElement).checked).toBe(true);
        expect((theirsRadio as HTMLInputElement).checked).toBe(false);
    });

    it('toggles a field between mine and theirs', () => {
        renderConflict();
        enterMerge();

        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        const theirsRadio = within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 4' });
        fireEvent.click(theirsRadio);

        expect((theirsRadio as HTMLInputElement).checked).toBe(true);
        expect(
            (within(servingsGroup).getByRole('radio', { name: 'Your version: 6' }) as HTMLInputElement).checked,
        ).toBe(false);
    });

    it('submits the merged draft reflecting each per-field choice (my title + their servings)', () => {
        const onMerge = vi.fn();
        renderConflict({ onMerge });
        enterMerge();

        // Keep the title on mine (default); pull servings from theirs.
        const servingsGroup = screen.getByRole('radiogroup', { name: 'Servings' });
        fireEvent.click(within(servingsGroup).getByRole('radio', { name: 'Latest saved version: 4' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save merged version' }));

        expect(onMerge).toHaveBeenCalledTimes(1);
        const merged = onMerge.mock.calls[0]?.[0];
        expect(merged).toMatchObject({ title: 'My Draft Title', servings: 4 });
    });

    it('submitting with no changes composes the user’s draft (a field left at its default)', () => {
        const onMerge = vi.fn();
        renderConflict({ onMerge });
        enterMerge();

        fireEvent.click(screen.getByRole('button', { name: 'Save merged version' }));

        expect(onMerge).toHaveBeenCalledWith(expect.objectContaining({ title: 'My Draft Title', servings: 6 }));
    });

    it('returns to the three options via back', () => {
        renderConflict();
        enterMerge();

        fireEvent.click(screen.getByRole('button', { name: 'Back to options' }));

        expect(screen.getByRole('button', { name: 'Keep my version' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Merge changes field by field' })).toBeNull();
    });
});
