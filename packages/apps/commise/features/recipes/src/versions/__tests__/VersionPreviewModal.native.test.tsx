/**
 * Native component tests for the version preview modal (W6 Task 3 / FR-007b), rendered via react-native-web
 * under jsdom. Mirrors the web leaf across every branch — closed, loading, populated version (snapshot
 * fields, ingredient lines with/without a calorie chip, the "changed from current" summary), error (not a
 * dead end), Restore, and dismissal (Cancel) — so the two platform renders can't drift on behaviour.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { RecipeIngredient, RecipeSnapshot, RecipeStep, RecipeVersion } from '@kitchensink/recipe-core';

import { diffSnapshots } from '../diff.js';
import type { VersionPreviewModalProps } from '../model.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { VersionPreviewModal } from '../VersionPreviewModal.native.js';

afterEach(cleanup);

const noop = () => undefined;

const makeStep = (overrides: Partial<RecipeStep> = {}): RecipeStep => ({
    id: 'step_1',
    recipeId: 'rec_1',
    stepNumber: 1,
    instruction: 'Boil the pasta.',
    ...overrides,
});

const makeIngredient = (overrides: Partial<RecipeIngredient> = {}): RecipeIngredient => ({
    id: 'ri_1',
    recipeId: 'rec_1',
    ingredientId: 'ing_1',
    quantity: 200,
    unit: 'g',
    sortOrder: 1,
    ingredientName: 'Pasta',
    isUserEntered: false,
    ...overrides,
});

const makeSnapshot = (overrides: Partial<RecipeSnapshot> = {}): RecipeSnapshot => ({
    version: 10,
    title: "Grandma's Pasta",
    description: 'A family recipe passed down through three generations.',
    servings: 4,
    prepTimeMinutes: 15,
    cookTimeMinutes: 30,
    steps: [makeStep()],
    ingredients: [
        makeIngredient({ id: 'ri_1', quantity: 200, unit: 'g', ingredientName: 'Pasta', userCalories: 420 }),
        makeIngredient({
            id: 'ri_2',
            ingredientId: 'ing_2',
            quantity: 1,
            unit: 'cup',
            sortOrder: 2,
            ingredientName: 'Cherry tomatoes',
        }),
    ],
    ...overrides,
});

const makeVersion = (overrides: Partial<RecipeVersion> = {}): RecipeVersion => ({
    id: 'ver_10',
    recipeId: 'rec_1',
    versionNumber: 10,
    snapshot: makeSnapshot(),
    createdBy: 'usr_1',
    createdAt: '2026-05-07T18:55:00.000Z',
    ...overrides,
});

const populatedVersion = makeVersion();

const currentSnapshot = makeSnapshot({
    ingredients: [
        makeIngredient({ id: 'ri_1', quantity: 220, unit: 'g', ingredientName: 'Pasta', userCalories: 460 }),
        makeIngredient({
            id: 'ri_3',
            ingredientId: 'ing_3',
            quantity: 2,
            unit: 'tbsp',
            sortOrder: 3,
            ingredientName: 'Basil',
        }),
    ],
    steps: [makeStep({ instruction: 'Boil the pasta until al dente.' })],
});

const populatedDiff = diffSnapshots(populatedVersion.snapshot, currentSnapshot);

function baseProps(overrides: Partial<VersionPreviewModalProps> = {}): VersionPreviewModalProps {
    return {
        open: true,
        isLoading: false,
        onCancel: noop,
        onRestore: noop,
        locale: 'en-US',
        ...overrides,
    };
}

describe('VersionPreviewModal (native) — closed', () => {
    it('renders nothing while closed', () => {
        render(<VersionPreviewModal {...baseProps({ open: false, version: populatedVersion })} />);

        expect(screen.queryByText("Grandma's Pasta")).toBeNull();
    });
});

describe('VersionPreviewModal (native) — loading', () => {
    it('shows a progress affordance and no content while loading', () => {
        render(<VersionPreviewModal {...baseProps({ isLoading: true })} />);

        expect(screen.getByRole('progressbar')).toBeTruthy();
        expect(screen.queryByText("Grandma's Pasta")).toBeNull();
        expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull();
    });
});

describe('VersionPreviewModal (native) — populated version', () => {
    it('renders the snapshot title, description, servings, and prep/cook/total time', () => {
        render(<VersionPreviewModal {...baseProps({ version: populatedVersion, diffFromCurrent: populatedDiff })} />);

        expect(screen.getByText("Version 10 Preview: Grandma's Pasta")).toBeTruthy();
        expect(screen.getByText("Grandma's Pasta")).toBeTruthy();
        expect(screen.getByText('A family recipe passed down through three generations.')).toBeTruthy();
        expect(screen.getByText('4')).toBeTruthy();
        expect(screen.getByText('15 min')).toBeTruthy();
        expect(screen.getByText('30 min')).toBeTruthy();
        expect(screen.getByText('45 min')).toBeTruthy();
    });

    it('renders each ingredient line, with a calorie chip only when the line carries userCalories', () => {
        render(<VersionPreviewModal {...baseProps({ version: populatedVersion, diffFromCurrent: populatedDiff })} />);

        expect(screen.getByText('Ingredients at v10')).toBeTruthy();
        expect(screen.getByText('200 g Pasta')).toBeTruthy();
        expect(screen.getByText('420 cal')).toBeTruthy();
        expect(screen.getByText('1 cup Cherry tomatoes')).toBeTruthy();
        // Cherry tomatoes carries no userCalories — no calorie chip is fabricated for it.
        expect(screen.queryByText(/^\s*cal$/)).toBeNull();
    });

    it('renders the "changed from current" summary from diffFromCurrent', () => {
        render(<VersionPreviewModal {...baseProps({ version: populatedVersion, diffFromCurrent: populatedDiff })} />);

        expect(screen.getByText('Changed from current: 3 ingredients, 1 steps')).toBeTruthy();
    });

    it('omits the "changed from current" line when no diff was supplied', () => {
        render(<VersionPreviewModal {...baseProps({ version: populatedVersion })} />);

        expect(screen.queryByText(/^Changed from current:/)).toBeNull();
    });

    it('"Restore this version" fires onRestore with the previewed version number', async () => {
        const user = userEvent.setup();
        const onRestore = vi.fn();
        render(
            <VersionPreviewModal
                {...baseProps({ version: populatedVersion, diffFromCurrent: populatedDiff, onRestore })}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Restore this version' }));

        expect(onRestore).toHaveBeenCalledExactlyOnceWith(10);
    });
});

describe('VersionPreviewModal (native) — error', () => {
    it('shows an error affordance, not a dead end — Keep current version still works', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<VersionPreviewModal {...baseProps({ error: true, onCancel })} />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t load that version. Please try again.');
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Keep current version' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('VersionPreviewModal (native) — dismissal', () => {
    it('Keep current version fires onCancel', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<VersionPreviewModal {...baseProps({ version: populatedVersion, onCancel })} />);

        await user.click(screen.getByRole('button', { name: 'Keep current version' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
