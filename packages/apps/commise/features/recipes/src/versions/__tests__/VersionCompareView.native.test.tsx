/**
 * Native component tests for the two-version compare panel (W6 Task 4 / FR-007b, FR-007c), rendered via
 * react-native-web under jsdom. Mirrors the web leaf across every branch — closed, an incomplete selection,
 * a populated diff (Diff Summary counts + ONLY the changed fields, unchanged fields absent), a no-change
 * diff, dismissal, and a reorder-only ingredient diff (same-count A/B, no default per-line/"modified"
 * explosion) — so the two platform renders can't drift on behaviour.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { computedContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';
import type { RecipeIngredient, RecipeSnapshot, RecipeStep, RecipeVersion } from '@kitchensink/recipe-core';

import { diffSnapshots } from '../diff.js';
import type { VersionCompareViewProps } from '../model.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { VersionCompareView } from '../VersionCompareView.native.js';

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
    quantity: { kind: 'exact', value: 200 },
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
        makeIngredient({
            id: 'ri_a',
            ingredientId: 'ing_a',
            quantity: { kind: 'exact', value: 200 },
            unit: 'g',
            ingredientName: 'Pasta',
        }),
        makeIngredient({
            id: 'ri_b',
            ingredientId: 'ing_b',
            quantity: { kind: 'exact', value: 50 },
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

const versionA = makeVersion();
const versionB = makeVersion({
    id: 'ver_12',
    versionNumber: 12,
    createdAt: '2026-05-09T14:32:00.000Z',
    snapshot: makeSnapshot({
        version: 12,
        description: 'Updated description.',
        ingredients: [
            makeIngredient({
                id: 'ri_a',
                ingredientId: 'ing_a',
                quantity: { kind: 'exact', value: 200 },
                unit: 'g',
                ingredientName: 'Pasta',
            }),
            makeIngredient({
                id: 'ri_b',
                ingredientId: 'ing_b',
                quantity: { kind: 'exact', value: 75 },
                unit: 'g',
                sortOrder: 2,
                ingredientName: 'Parmesan',
            }),
            makeIngredient({
                id: 'ri_c',
                ingredientId: 'ing_c',
                quantity: { kind: 'exact', value: 10 },
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

describe('VersionCompareView (native) — closed', () => {
    it('renders nothing while closed', () => {
        render(<VersionCompareView {...baseProps({ open: false, versionA, versionB, diff: populatedDiff })} />);

        expect(screen.queryByText(/^Compare v/)).toBeNull();
    });
});

describe('VersionCompareView (native) — incomplete selection', () => {
    it('shows a "select two versions" message when versionA/versionB/diff are not all supplied', () => {
        render(<VersionCompareView {...baseProps()} />);

        expect(screen.getByText('Select two versions to compare.')).toBeTruthy();
        expect(screen.queryByText(/^Compare v/)).toBeNull();
    });
});

describe('VersionCompareView (native) — populated diff', () => {
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

        expect(screen.queryByText('Title')).toBeNull();
        expect(screen.queryByText('Servings')).toBeNull();
        expect(screen.queryByText('Prep time')).toBeNull();
        expect(screen.queryByText('Cook time')).toBeNull();
        expect(screen.queryByText('Steps')).toBeNull();
    });

    it('renders version B’s side before version A’s side in every row, matching the header order', () => {
        render(<VersionCompareView {...baseProps({ versionA, versionB, diff: populatedDiff })} />);

        // Row values: B's "Updated description." precedes A's "Original description." — would fail if the
        // native stack order were flipped back to A-over-B.
        const updatedValue = screen.getByText('Updated description.');
        const originalValue = screen.getByText('Original description.');
        expect(updatedValue.compareDocumentPosition(originalValue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        // Every row's side label follows the same B-then-A order (description + ingredients rows), and each
        // label still corresponds to its own version after the reorder.
        const versionBLabels = screen.getAllByText('Version 12');
        const versionALabels = screen.getAllByText('Version 8');
        expect(versionBLabels).toHaveLength(2);
        expect(versionALabels).toHaveLength(2);
        versionBLabels.forEach((label, index) => {
            expect(
                label.compareDocumentPosition(versionALabels[index]) & Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();
        });
    });
});

describe('VersionCompareView (native) — no-change diff', () => {
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

describe('VersionCompareView (native) — reorder-only ingredient diff', () => {
    const reorderedB = makeVersion({
        id: 'ver_8c',
        versionNumber: 9,
        snapshot: makeSnapshot({
            version: 9,
            ingredients: [
                makeIngredient({
                    id: 'ri_a',
                    ingredientId: 'ing_a',
                    quantity: { kind: 'exact', value: 200 },
                    unit: 'g',
                    sortOrder: 2,
                }),
                makeIngredient({
                    id: 'ri_b',
                    ingredientId: 'ing_b',
                    quantity: { kind: 'exact', value: 50 },
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

        expect(reorderDiff.ingredients).toEqual({ added: 0, removed: 0, modified: 2 });

        expect(screen.getAllByText('2 ingredients')).toHaveLength(2);
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

/**
 * Cross-platform parity for the web leaf's contrast fix. `computedContrast` measures the leaf's ACTUAL compiled
 * colour rather than pinning a token spelling (see `RecipeVersionList.native.test.tsx`'s contrast block).
 * `FullScreenSheet`'s surface is the opaque `palette.white` this sheet is painted on, and the toggle paints no
 * tint of its own, so white is the backdrop a reader sees behind the label.
 */
describe('VersionCompareView (native) — WCAG AA text contrast (SC 1.4.3)', () => {
    const reorderedB = makeVersion({
        id: 'ver_8d',
        versionNumber: 10,
        snapshot: makeSnapshot({
            version: 10,
            ingredients: [
                makeIngredient({
                    id: 'ri_a',
                    ingredientId: 'ing_a',
                    quantity: { kind: 'exact', value: 200 },
                    unit: 'g',
                    sortOrder: 2,
                }),
                makeIngredient({
                    id: 'ri_b',
                    ingredientId: 'ing_b',
                    quantity: { kind: 'exact', value: 50 },
                    unit: 'g',
                    sortOrder: 1,
                    ingredientName: 'Parmesan',
                }),
            ],
        }),
    });

    it('the "Show full diff" toggle’s label is legible on the sheet surface', () => {
        render(
            <VersionCompareView
                {...baseProps({
                    versionA,
                    versionB: reorderedB,
                    diff: diffSnapshots(versionA.snapshot, reorderedB.snapshot),
                })}
            />,
        );

        const toggle = screen.getByRole('button', { name: 'Show full diff' });

        expect(
            computedContrast(within(toggle).getByText('Show full diff'), { surface: palette.white }),
            '"Show full diff" label on the white sheet surface',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

describe('VersionCompareView (native) — dismissal', () => {
    it('the close control fires onClose', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<VersionCompareView {...baseProps({ versionA, versionB, diff: populatedDiff, onClose })} />);

        await user.click(screen.getByRole('button', { name: 'Close compare' }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
