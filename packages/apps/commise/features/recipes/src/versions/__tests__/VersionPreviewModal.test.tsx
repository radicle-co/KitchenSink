// @vitest-environment jsdom
/**
 * Component tests for the web version preview modal (W6 Task 3 / FR-007b) — the wireframe's "Version
 * Preview Modal": a Radix `Dialog` (focus-trap, Escape-dismiss, focus-return, mirroring `PullUpdatesDialog`,
 * W5 Task 10). Covers every branch the mandate requires: closed (nothing rendered), the loading affordance,
 * a populated version (snapshot fields, ingredient lines with/without a calorie chip, the "changed from
 * current" summary), the error affordance (not a dead end — Keep-current/Cancel still works), Restore, and
 * dismissal (Cancel + Escape/focus-return).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import type { RecipeIngredient, RecipeSnapshot, RecipeStep, RecipeVersion } from '@kitchensink/recipe-core';

import { diffSnapshots, type SnapshotDiff } from '../diff.js';
import type { VersionPreviewModalProps } from '../model.js';
import { VersionPreviewModal } from '../VersionPreviewModal.js';

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

describe('VersionPreviewModal (web) — closed', () => {
    it('renders no dialog while closed', () => {
        render(<VersionPreviewModal {...baseProps({ open: false, version: populatedVersion })} />);

        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('VersionPreviewModal (web) — loading', () => {
    it('shows a progress affordance and no content while loading', () => {
        render(<VersionPreviewModal {...baseProps({ isLoading: true })} />);

        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.queryByText("Grandma's Pasta")).toBeNull();
        expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull();
    });
});

describe('VersionPreviewModal (web) — populated version', () => {
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
        expect(screen.queryByText(/^\s*cal$/)).toBeNull();
    });

    it('renders the "changed from current" summary from diffFromCurrent, pluralized per count', () => {
        render(<VersionPreviewModal {...baseProps({ version: populatedVersion, diffFromCurrent: populatedDiff })} />);

        // populatedDiff: ingredients added(ri_3)+removed(ri_2)+modified(ri_1 quantity/calories) = 3 (plural);
        // steps modified(instruction changed) = 1 (singular — "1 step", never the ungrammatical "1 steps").
        expect(screen.getByText('Changed from current: 3 ingredients, 1 step')).toBeTruthy();
    });

    it('singularizes the "changed from current" summary when a count is exactly 1', () => {
        const singularDiff: SnapshotDiff = {
            changedFields: [],
            steps: { added: 1, removed: 0, modified: 0 },
            ingredients: { added: 1, removed: 0, modified: 0 },
            summary: { added: 2, removed: 0, modified: 0 },
        };
        render(<VersionPreviewModal {...baseProps({ version: populatedVersion, diffFromCurrent: singularDiff })} />);

        expect(screen.getByText('Changed from current: 1 ingredient, 1 step')).toBeTruthy();
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

describe('VersionPreviewModal (web) — restoring (W6 Task 5)', () => {
    it('shows the busy Restore label and disables the action while a restore is in flight', () => {
        render(
            <VersionPreviewModal
                {...baseProps({ version: populatedVersion, diffFromCurrent: populatedDiff, isRestoring: true })}
            />,
        );

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Restoring…' }).disabled).toBe(true);
        expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull();
    });

    it('does not fire onRestore when the busy Restore action is activated', async () => {
        const user = userEvent.setup();
        const onRestore = vi.fn();
        render(
            <VersionPreviewModal
                {...baseProps({
                    version: populatedVersion,
                    diffFromCurrent: populatedDiff,
                    isRestoring: true,
                    onRestore,
                })}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Restoring…' }));

        expect(onRestore).not.toHaveBeenCalled();
    });

    it('shows the idle Restore label (not busy) when isRestoring is omitted', () => {
        render(<VersionPreviewModal {...baseProps({ version: populatedVersion, diffFromCurrent: populatedDiff })} />);

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Restore this version' }).disabled).toBe(false);
    });
});

describe('VersionPreviewModal (web) — error', () => {
    it('shows an error affordance, not a dead end — Keep current version still works', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<VersionPreviewModal {...baseProps({ error: true, onCancel })} />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t load that version. Please try again.');
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Keep current version' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('VersionPreviewModal (web) — dismissal', () => {
    it('Keep current version fires onCancel', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<VersionPreviewModal {...baseProps({ version: populatedVersion, onCancel })} />);

        await user.click(screen.getByRole('button', { name: 'Keep current version' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('is an accessible role="dialog"; Escape fires onCancel and returns focus to the opener', async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();

        function Harness() {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>
                        Open version preview
                    </button>
                    <VersionPreviewModal
                        {...baseProps({
                            version: populatedVersion,
                            open,
                            onCancel: () => {
                                onCancel();
                                setOpen(false);
                            },
                        })}
                    />
                </>
            );
        }

        render(<Harness />);
        await user.click(screen.getByRole('button', { name: 'Open version preview' }));

        expect(screen.getByRole('dialog')).toBeTruthy();

        await user.keyboard('{Escape}');

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).toBeNull();

        // Radix's FocusScope restores focus from an unmount-cleanup `setTimeout(0)` — a real macrotask, not
        // a React state update — so this needs one real tick (mirrors PullUpdatesDialog's identical test).
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open version preview' }));
    });
});
