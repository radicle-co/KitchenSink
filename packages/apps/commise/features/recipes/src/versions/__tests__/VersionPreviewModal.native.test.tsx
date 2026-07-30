/**
 * Native component tests for the version preview modal (W6 Task 3 / FR-007b), rendered via react-native-web
 * under jsdom. Mirrors the web leaf across every branch — closed, loading, populated version (snapshot
 * fields, ingredient lines with/without a calorie chip, the "changed from current" summary), error (not a
 * dead end), Restore, and dismissal (Cancel) — so the two platform renders can't drift on behaviour.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { RecipeIngredient, RecipeSnapshot, RecipeStep, RecipeVersion } from '@kitchensink/recipe-core';

import { diffSnapshots, type SnapshotDiff } from '../diff.js';
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

    it('renders the "changed from current" summary from diffFromCurrent, pluralized per count', () => {
        render(<VersionPreviewModal {...baseProps({ version: populatedVersion, diffFromCurrent: populatedDiff })} />);

        // populatedDiff: 3 changed ingredients (plural); 1 changed step (singular — "1 step", never "1 steps").
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

describe('VersionPreviewModal (native) — restoring (W6 Task 5)', () => {
    it('shows the busy Restore label while a restore is in flight', () => {
        render(
            <VersionPreviewModal
                {...baseProps({ version: populatedVersion, diffFromCurrent: populatedDiff, isRestoring: true })}
            />,
        );

        expect(screen.getByRole('button', { name: 'Restoring…' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Restore this version' })).toBeNull();
    });

    it('does not fire onRestore when the busy Restore action is activated', () => {
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

        fireEvent.click(screen.getByRole('button', { name: 'Restoring…' }));

        expect(onRestore).not.toHaveBeenCalled();
    });

    it('shows the idle Restore label (not busy) when isRestoring is omitted', () => {
        render(<VersionPreviewModal {...baseProps({ version: populatedVersion, diffFromCurrent: populatedDiff })} />);

        expect(screen.getByRole('button', { name: 'Restore this version' })).toBeTruthy();
    });

    /**
     * The in-flight Restore control's BUSY state has to reach the DOM, not only the device (#123).
     *
     * Verified against the installed react-native-web (0.20.0): its `forwardedProps` allowlist carries every
     * literal `aria-*` attribute but has NO entry that projects `accessibilityState` — the only consumer
     * anywhere in the package is `AccessibilityUtil/isDisabled`, and even that reads the LEGACY
     * `accessibilityStates` array. The control's `disabled` half already reached the DOM (RNW derives
     * `aria-disabled` from the `disabled` PROP), but `busy` went nowhere, so a screen reader on the mobile-web
     * build heard "unavailable" where the truth was "working". The label swap to "Restoring…" is the only other
     * signal, and this sheet has no live region carrying it.
     *
     * `aria-busy` is RN's own first-class ALIAS for `accessibilityState.busy` (`ViewAccessibility.d.ts`), so it
     * is device-correct too, and `accessibilityState` stays alongside it (RN reverse-maps `aria-busy` into
     * `accessibilityState.busy`). The `|| undefined` shape omits it when idle, matching this package's other
     * busy controls, since ARIA already defaults `aria-busy` to false.
     */
    it('marks the in-flight Restore control busy in the DOM', () => {
        render(
            <VersionPreviewModal
                {...baseProps({ version: populatedVersion, diffFromCurrent: populatedDiff, isRestoring: true })}
            />,
        );

        expect(screen.getByRole('button', { name: 'Restoring…' }).getAttribute('aria-busy')).toBe('true');
    });

    it('leaves the idle Restore control unmarked, and distinguishable from disabled', () => {
        render(<VersionPreviewModal {...baseProps({ version: populatedVersion, diffFromCurrent: populatedDiff })} />);

        const restore = screen.getByRole('button', { name: 'Restore this version' });
        expect(restore.getAttribute('aria-busy')).toBeNull();
        expect(restore.hasAttribute('disabled')).toBe(false);
    });

    it('never busies the Keep-current escape hatch, even mid-restore', () => {
        // Mutation guard: an unconditional `aria-busy` on every action in the row would pass the case above.
        render(
            <VersionPreviewModal
                {...baseProps({ version: populatedVersion, diffFromCurrent: populatedDiff, isRestoring: true })}
            />,
        );

        expect(screen.getByRole('button', { name: 'Keep current version' }).getAttribute('aria-busy')).toBeNull();
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

    it('reports a failure — not a spinner — when there is no version AND no fetch in flight (B21)', async () => {
        // The dead end this closes: `showLoading` used to swallow "no version" whatever `isLoading` said, so
        // a caller that finished (or never started) a lookup and had nothing to show produced a permanent
        // progress affordance. Nothing pending + nothing to render IS a failure, `error` flag or not.
        const user = userEvent.setup();
        const onCancel = vi.fn();
        render(<VersionPreviewModal {...baseProps({ isLoading: false, onCancel })} />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t load that version. Please try again.');
        expect(screen.queryByRole('progressbar')).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Keep current version' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('still shows progress — not a failure — while a fetch IS in flight with no version yet', () => {
        // The complement: loading must keep beating the absent version, or every first paint reads as broken.
        render(<VersionPreviewModal {...baseProps({ isLoading: true })} />);

        expect(screen.getByRole('progressbar')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

/**
 * Resolve the value react-native-web actually APPLIED for a CSS property, by walking the element's atomic
 * `r-*` classes back to their compiled rules and falling back to the inline `style` attribute. Same helper as
 * `CollectionHeader.native.test.tsx` / `RecipeFilterBar.native.test.tsx`, which established the idiom.
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
 * Regression sweep (the `CollectionHeader.native.tsx` family): an ingredient line row is
 * `[composed line text][calorie chip]` at `justifyContent: 'space-between'`, and React Native defaults
 * `flexShrink` to 0 — so a long line (quantity + unit + a user-supplied ingredient name) claimed its full
 * intrinsic width and pushed the calorie chip past the sheet edge. This file's sibling `field` row already
 * carries the fix (`fieldValue: { flexShrink: 1 }`), so the two rows now agree.
 */
describe('VersionPreviewModal (native) — a long ingredient line cannot push its calorie chip off the sheet', () => {
    const longLineVersion = makeVersion({
        snapshot: makeSnapshot({
            ingredients: [
                makeIngredient({
                    ingredientName: 'Slow-roasted San Marzano tomatoes from the co-op down the road',
                    userCalories: 420,
                }),
            ],
        }),
    });

    it('lets the line text shrink instead of claiming its intrinsic width', () => {
        render(<VersionPreviewModal {...baseProps({ version: longLineVersion })} />);

        const line = screen.getByText('200 g Slow-roasted San Marzano tomatoes from the co-op down the road');

        expect(appliedStyle(line, 'flex-shrink')).toBe('1');
    });

    it('never shrinks the calorie chip, so it cannot be clipped away', () => {
        render(<VersionPreviewModal {...baseProps({ version: longLineVersion })} />);

        expect(appliedStyle(screen.getByText('420 cal'), 'flex-shrink')).toBe('0');
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
