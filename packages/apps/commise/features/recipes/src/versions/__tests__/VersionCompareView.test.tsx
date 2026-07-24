// @vitest-environment jsdom
/**
 * Component tests for the web two-version compare panel (W6 Task 4 / FR-007b, FR-007c) — the wireframe's
 * "Compare Versions" right sidebar: a Radix `Dialog` styled as a right-side panel (mirroring
 * `VersionPreviewModal.tsx`'s focus-trap / Escape-dismiss / focus-return, W6 Task 3). Covers every branch
 * the mandate requires: closed (nothing rendered), an incomplete selection, a populated diff (Diff Summary
 * counts + ONLY the changed fields, each with both sides' values — unchanged fields absent), a no-change
 * diff, dismissal (close control + Escape/focus-return), and a reorder-only ingredient diff (the Task 1
 * sanity note: same-count A/B, no misleading per-line "N modified" explosion by default).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import type { RecipeIngredient, RecipeSnapshot, RecipeStep, RecipeVersion } from '@kitchensink/recipe-core';

import { diffSnapshots } from '../diff.js';
import type { VersionCompareViewProps } from '../model.js';
import { VersionCompareView } from '../VersionCompareView.js';

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
    ingredientId: 'ing_a',
    quantity: 200,
    unit: 'g',
    sortOrder: 1,
    ingredientName: 'Pasta',
    isUserEntered: false,
    ...overrides,
});

const makeSnapshot = (overrides: Partial<RecipeSnapshot> = {}): RecipeSnapshot => ({
    version: 8,
    title: "Grandma's Pasta",
    description: 'Original description.',
    servings: 4,
    prepTimeMinutes: 15,
    cookTimeMinutes: 30,
    steps: [makeStep()],
    ingredients: [
        makeIngredient({ id: 'ri_a', ingredientId: 'ing_a', quantity: 200, unit: 'g', ingredientName: 'Pasta' }),
        makeIngredient({
            id: 'ri_b',
            ingredientId: 'ing_b',
            quantity: 50,
            unit: 'g',
            sortOrder: 2,
            ingredientName: 'Parmesan',
        }),
    ],
    ...overrides,
});

const makeVersion = (overrides: Partial<RecipeVersion> = {}): RecipeVersion => ({
    id: 'ver_8',
    recipeId: 'rec_1',
    versionNumber: 8,
    snapshot: makeSnapshot(),
    createdBy: 'usr_1',
    createdAt: '2026-05-05T08:00:00.000Z',
    ...overrides,
});

// versionA (v8) vs versionB (v12): description changed, and one ingredient added + one modified —
// deliberately produces changedFields: ['description', 'ingredients'], summary: {added:1, removed:0,
// modified:2} (1 ingredient added + 1 ingredient modified + 1 changed scalar), matching the brief's example.
const versionA = makeVersion();
const versionB = makeVersion({
    id: 'ver_12',
    versionNumber: 12,
    createdAt: '2026-05-09T14:32:00.000Z',
    snapshot: makeSnapshot({
        version: 12,
        description: 'Updated description.',
        ingredients: [
            makeIngredient({ id: 'ri_a', ingredientId: 'ing_a', quantity: 200, unit: 'g', ingredientName: 'Pasta' }),
            makeIngredient({
                id: 'ri_b',
                ingredientId: 'ing_b',
                quantity: 75,
                unit: 'g',
                sortOrder: 2,
                ingredientName: 'Parmesan',
            }),
            makeIngredient({
                id: 'ri_c',
                ingredientId: 'ing_c',
                quantity: 10,
                unit: 'g',
                sortOrder: 3,
                ingredientName: 'Basil',
            }),
        ],
    }),
});
const populatedDiff = diffSnapshots(versionA.snapshot, versionB.snapshot);

function baseProps(overrides: Partial<VersionCompareViewProps> = {}): VersionCompareViewProps {
    return {
        open: true,
        locale: 'en-US',
        onClose: noop,
        ...overrides,
    };
}

describe('VersionCompareView (web) — closed', () => {
    it('renders no dialog while closed', () => {
        render(<VersionCompareView {...baseProps({ open: false, versionA, versionB, diff: populatedDiff })} />);

        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('VersionCompareView (web) — incomplete selection', () => {
    it('shows a "select two versions" message when versionA/versionB/diff are not all supplied', () => {
        render(<VersionCompareView {...baseProps()} />);

        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(screen.getByText('Select two versions to compare.')).toBeTruthy();
        expect(screen.queryByText(/^Compare v/)).toBeNull();
    });
});

describe('VersionCompareView (web) — populated diff', () => {
    it('renders the "Compare v{B} vs v{A}" heading and the Diff Summary counts', () => {
        render(<VersionCompareView {...baseProps({ versionA, versionB, diff: populatedDiff })} />);

        expect(screen.getByText('Compare v12 vs v8')).toBeTruthy();
        expect(screen.getByText('Added: 1')).toBeTruthy();
        expect(screen.getByText('Removed: 0')).toBeTruthy();
        expect(screen.getByText('Modified: 2')).toBeTruthy();
    });

    it('renders ONLY the changed fields (description, ingredients), each with both sides’ values', () => {
        render(<VersionCompareView {...baseProps({ versionA, versionB, diff: populatedDiff })} />);

        expect(screen.getByText('Description')).toBeTruthy();
        expect(screen.getByText('Original description.')).toBeTruthy();
        expect(screen.getByText('Updated description.')).toBeTruthy();

        expect(screen.getByText('Ingredients')).toBeTruthy();
        expect(screen.getByText('2 ingredients')).toBeTruthy();
        expect(screen.getByText('3 ingredients')).toBeTruthy();

        // Changed-only: unchanged fields (title, servings, prep/cook time, steps) are NOT rendered.
        expect(screen.queryByText('Title')).toBeNull();
        expect(screen.queryByText('Servings')).toBeNull();
        expect(screen.queryByText('Prep time')).toBeNull();
        expect(screen.queryByText('Cook time')).toBeNull();
        expect(screen.queryByText('Steps')).toBeNull();
    });
});

describe('VersionCompareView (web) — no-change diff', () => {
    it('shows the no-changes message and no field rows when the two snapshots are identical', () => {
        const sameVersionB = makeVersion({ id: 'ver_8b', versionNumber: 9 });
        const noChangeDiff = diffSnapshots(versionA.snapshot, sameVersionB.snapshot);

        render(<VersionCompareView {...baseProps({ versionA, versionB: sameVersionB, diff: noChangeDiff })} />);

        expect(screen.getByText('No changes between these versions.')).toBeTruthy();
        expect(screen.getByText('Added: 0')).toBeTruthy();
        expect(screen.getByText('Removed: 0')).toBeTruthy();
        expect(screen.getByText('Modified: 0')).toBeTruthy();
        expect(screen.queryByText('Description')).toBeNull();
        expect(screen.queryByText('Ingredients')).toBeNull();
    });
});

describe('VersionCompareView (web) — reorder-only ingredient diff', () => {
    const reorderedB = makeVersion({
        id: 'ver_8c',
        versionNumber: 9,
        snapshot: makeSnapshot({
            version: 9,
            ingredients: [
                makeIngredient({ id: 'ri_a', ingredientId: 'ing_a', quantity: 200, unit: 'g', sortOrder: 2 }),
                makeIngredient({
                    id: 'ri_b',
                    ingredientId: 'ing_b',
                    quantity: 50,
                    unit: 'g',
                    sortOrder: 1,
                    ingredientName: 'Parmesan',
                }),
            ],
        }),
    });
    const reorderDiff = diffSnapshots(versionA.snapshot, reorderedB.snapshot);

    it('renders the same ingredient count on both sides, without a default per-line/"modified" explosion', () => {
        render(<VersionCompareView {...baseProps({ versionA, versionB: reorderedB, diff: reorderDiff })} />);

        // Sanity: this genuinely is a reorder-only diff (no adds/removes, both sides still 2 ingredients).
        expect(reorderDiff.ingredients).toEqual({ added: 0, removed: 0, modified: 2 });

        expect(screen.getAllByText('2 ingredients')).toHaveLength(2);
        // No default per-collection tally line, and no fabricated per-ingredient line text.
        expect(screen.queryByText('Added: 0 · Removed: 0 · Modified: 2')).toBeNull();
        expect(screen.queryByText('Pasta')).toBeNull();
        expect(screen.queryByText('Parmesan')).toBeNull();
    });

    it('reveals the collection’s own tally as opt-in detail via "Show full diff"', async () => {
        const user = userEvent.setup();
        render(<VersionCompareView {...baseProps({ versionA, versionB: reorderedB, diff: reorderDiff })} />);

        await user.click(screen.getByRole('button', { name: 'Show full diff' }));

        expect(screen.getByText('Added: 0 · Removed: 0 · Modified: 2')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Hide full diff' }));

        expect(screen.queryByText('Added: 0 · Removed: 0 · Modified: 2')).toBeNull();
    });
});

describe('VersionCompareView (web) — dismissal', () => {
    it('the close control fires onClose', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<VersionCompareView {...baseProps({ versionA, versionB, diff: populatedDiff, onClose })} />);

        await user.click(screen.getByRole('button', { name: 'Close compare' }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('is an accessible role="dialog"; Escape fires onClose and returns focus to the opener', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();

        function Harness() {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>
                        Open compare
                    </button>
                    <VersionCompareView
                        {...baseProps({
                            versionA,
                            versionB,
                            diff: populatedDiff,
                            open,
                            onClose: () => {
                                onClose();
                                setOpen(false);
                            },
                        })}
                    />
                </>
            );
        }

        render(<Harness />);
        await user.click(screen.getByRole('button', { name: 'Open compare' }));

        expect(screen.getByRole('dialog')).toBeTruthy();

        await user.keyboard('{Escape}');

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).toBeNull();

        // Radix's FocusScope restores focus from an unmount-cleanup `setTimeout(0)` — a real macrotask, not
        // a React state update — so this needs one real tick (mirrors VersionPreviewModal's identical test).
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open compare' }));
    });
});
