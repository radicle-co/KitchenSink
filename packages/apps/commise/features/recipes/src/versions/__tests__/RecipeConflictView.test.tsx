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

import { makeIngredientView, makeRecipeDetail, makeStepView } from '../../__fixtures__/index.js';
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

function renderConflict(overrides: Partial<RecipeConflictViewProps> = {}) {
    const props: RecipeConflictViewProps = {
        mineTitle: 'My Draft Title',
        theirs,
        mine,
        onKeepMine: noop,
        onUseTheirs: noop,
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
});
