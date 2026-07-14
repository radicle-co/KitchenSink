/**
 * Native component tests for the concurrent-edit conflict view (T070 / C-005), rendered via
 * react-native-web under jsdom. Mirrors the web leaf: both sides rendered with their differing fields as
 * labelled groups, the user's own draft title driving the mine side, and the two resolution choices firing
 * their handlers — so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { makeIngredientView, makeRecipeDetail, makeStepView } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeConflictView } from '../RecipeConflictView.native.js';
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

describe('RecipeConflictView (native) — structure', () => {
    it('renders a heading for each side', () => {
        renderConflict();

        expect(screen.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Your version' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Latest saved version' })).toBeTruthy();
    });
});

describe('RecipeConflictView (native) — mine side', () => {
    it('shows the user’s own draft title, not the base recipe title', () => {
        renderConflict();

        const group = screen.getByLabelText('Your version');
        expect(within(group).getByText('My Draft Title')).toBeTruthy();
        expect(screen.queryByText('IGNORED_MINE_TITLE')).toBeNull();
    });

    it('shows the mine side’s differing fields', () => {
        renderConflict();

        const group = screen.getByLabelText('Your version');
        expect(within(group).getByText('6')).toBeTruthy();
        expect(within(group).getByText('15 min')).toBeTruthy();
        expect(within(group).getByText('25 min')).toBeTruthy();
        expect(within(group).getByText('50 min')).toBeTruthy();
        expect(within(group).getByText('3 ingredients')).toBeTruthy();
        expect(within(group).getByText('5 steps')).toBeTruthy();
    });
});

describe('RecipeConflictView (native) — theirs side', () => {
    it('shows the latest saved version’s differing fields', () => {
        renderConflict();

        const group = screen.getByLabelText('Latest saved version');
        expect(within(group).getByText('Latest Saved Title')).toBeTruthy();
        expect(within(group).getByText('4')).toBeTruthy();
        expect(within(group).getByText('10 min')).toBeTruthy();
        expect(within(group).getByText('20 min')).toBeTruthy();
        expect(within(group).getByText('30 min')).toBeTruthy();
        expect(within(group).getByText('2 ingredients')).toBeTruthy();
        expect(within(group).getByText('4 steps')).toBeTruthy();
    });
});

describe('RecipeConflictView (native) — choices', () => {
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
