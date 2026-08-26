/**
 * Native component tests for the recipe version-history view (T069), rendered via react-native-web under
 * jsdom. Mirrors the web leaf across EVERY branch — empty, populated (newest-first, number + timestamp),
 * current marked and not restorable, restore interaction, and the busy/restoring state — so the two
 * platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { computedContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';

import { makeRecipeVersion } from '../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeVersionList } from '../RecipeVersionList.native.js';
import type { RecipeVersionListProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderList(overrides: Partial<RecipeVersionListProps> = {}) {
    const props: RecipeVersionListProps = {
        versions: [],
        currentVersion: 1,
        restoringVersion: null,
        onRestore: noop,
        ...overrides,
    };
    render(<RecipeVersionList {...props} />);

    return props;
}

const threeVersions = [
    makeRecipeVersion({ versionNumber: 1, createdAt: '2026-04-01T09:00:00.000Z' }),
    makeRecipeVersion({ versionNumber: 2, createdAt: '2026-04-05T09:00:00.000Z' }),
    makeRecipeVersion({ versionNumber: 3, createdAt: '2026-04-10T09:00:00.000Z' }),
];

describe('RecipeVersionList (native) — chrome', () => {
    it('always renders the version-history heading', () => {
        renderList();

        expect(screen.getByRole('heading', { name: 'Version history' })).toBeTruthy();
    });
});

describe('RecipeVersionList (native) — empty state', () => {
    it('shows the empty message and no restore actions', () => {
        renderList({ versions: [] });

        expect(screen.getByText('No earlier versions yet.')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });
});

describe('RecipeVersionList (native) — populated state', () => {
    it('lists every version with its number and timestamp', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        expect(screen.getByText('Version 1')).toBeTruthy();
        expect(screen.getByText('Version 2')).toBeTruthy();
        expect(screen.getByText('Version 3')).toBeTruthy();
        expect(screen.getByText(/Apr 1, 2026/)).toBeTruthy();
        expect(screen.getByText(/Apr 5, 2026/)).toBeTruthy();
        expect(screen.getByText(/Apr 10, 2026/)).toBeTruthy();
    });

    it('orders the versions newest-first regardless of input order', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        const labels = screen.getAllByText(/^Version \d+$/).map((node) => node.textContent);
        expect(labels).toEqual(['Version 3', 'Version 2', 'Version 1']);
    });
});

describe('RecipeVersionList (native) — current version', () => {
    it('marks the current version and offers no restore action for it', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        expect(screen.getByText('Current version')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Restore version 3' })).toBeNull();
    });

    it('offers a restore action for every non-current version', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Restore version 2' })).toBeTruthy();
    });
});

describe('RecipeVersionList (native) — restore interaction', () => {
    it('reports the chosen version number upward', () => {
        const onRestore = vi.fn();
        renderList({ versions: threeVersions, currentVersion: 3, onRestore });

        fireEvent.click(screen.getByRole('button', { name: 'Restore version 2' }));

        expect(onRestore).toHaveBeenCalledWith(2);
    });
});

describe('RecipeVersionList (native) — restoring state', () => {
    it('shows a busy status for the version being restored', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoringVersion: 2 });

        expect(screen.getByText(/Restoring version 2/)).toBeTruthy();
    });

    it('does not fire restore when a disabled action is activated', () => {
        const onRestore = vi.fn();
        renderList({ versions: threeVersions, currentVersion: 3, restoringVersion: 2, onRestore });

        fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' }));

        expect(onRestore).not.toHaveBeenCalled();
    });

    /**
     * The SAME react-native-web gap as the compare checkbox below (#123), on this leaf's other
     * `accessibilityState` key: `busy` is projected to no DOM attribute either. The live-region "Restoring
     * version N" text does announce the transition, but the CONTROL itself stayed unmarked, so anything that
     * inspects the button — AT reading it directly, or a test — could not tell it was mid-flight.
     *
     * `aria-busy` is RN's own first-class ALIAS for `accessibilityState.busy` (`ViewAccessibility.d.ts`), so it
     * is device-correct too; the `|| undefined` shape (matching `PressScale.native` and
     * `AccountEraseDialog.native`) omits it when idle, since ARIA already defaults `aria-busy` to false and an
     * always-present `aria-busy="false"` on every row would be noise, not information.
     */
    it('marks the in-flight restore control busy in the DOM, not just in the live region', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoringVersion: 2 });

        expect(screen.getByRole('button', { name: 'Restore version 2' }).getAttribute('aria-busy')).toBe('true');
    });

    it('marks only the restoring row busy — the other rows are disabled, not busy', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoringVersion: 2 });

        const restoreOne = screen.getByRole('button', { name: 'Restore version 1' });
        expect(restoreOne.getAttribute('aria-busy')).toBeNull();
        // They ARE disabled while a restore is in flight, and that state already reaches the DOM (RNW derives
        // `aria-disabled` from the `disabled` prop) — so the two states stay distinguishable.
        expect(restoreOne.getAttribute('aria-disabled')).toBe('true');
    });

    it('leaves every restore control unmarked when nothing is restoring', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoringVersion: null });

        screen.getAllByRole('button', { name: /^Restore version/ }).forEach((button) => {
            expect(button.getAttribute('aria-busy')).toBeNull();
        });
    });
});

/**
 * REWRITTEN for the 2026-08-26 owner ruling that deleted device attribution — the web leaf's sibling, kept
 * in step with it deliberately (a fix to one platform must not miss the other). The two cases that pinned
 * the ` (from {device})` suffix are gone; the escaping guard the web file keeps has no native counterpart
 * here because this file never had one.
 */
describe('RecipeVersionList (native) — editor attribution', () => {
    it('shows "by @handle" when the handle is present', () => {
        const versions = [makeRecipeVersion({ versionNumber: 1, editorHandle: 'clara' })];
        renderList({ versions, currentVersion: 1 });

        expect(screen.getByText('by @clara')).toBeTruthy();
    });

    it('renders no attribution line when the handle is absent', () => {
        const versions = [makeRecipeVersion({ versionNumber: 1, editorHandle: undefined })];
        renderList({ versions, currentVersion: 1 });

        expect(screen.queryByText(/^by @/)).toBeNull();
        expect(screen.queryByText(/undefined/)).toBeNull();
    });
});

describe('RecipeVersionList (native) — changed-fields summary', () => {
    const priorSnapshot = {
        version: 1,
        title: 'Weeknight Pasta',
        description: 'A fast, comforting weeknight dinner.',
        steps: [{ id: 'step_1', recipeId: 'rec_1', stepNumber: 1, instruction: 'Boil water.' }],
        ingredients: [],
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
    };
    const revisedSnapshot = {
        ...priorSnapshot,
        version: 2,
        title: 'Weeknight Pasta, Revised',
        steps: [{ id: 'step_1', recipeId: 'rec_1', stepNumber: 1, instruction: 'Boil salted water.' }],
    };

    it('shows the localized changed-fields summary versus the immediately-prior version', () => {
        const versions = [
            makeRecipeVersion({ versionNumber: 1, snapshot: priorSnapshot }),
            makeRecipeVersion({ versionNumber: 2, snapshot: revisedSnapshot }),
        ];
        renderList({ versions, currentVersion: 2 });

        expect(screen.getByText('Changed: Title, Steps')).toBeTruthy();
    });

    it('shows the initial-version label (and no Changed line) for the earliest version', () => {
        const versions = [makeRecipeVersion({ versionNumber: 1, snapshot: priorSnapshot })];
        renderList({ versions, currentVersion: 1 });

        expect(screen.getByText('Initial version')).toBeTruthy();
        expect(screen.queryByText(/^Changed:/)).toBeNull();
    });

    it('still renders the existing free-text changeSummary line alongside the computed summary', () => {
        const versions = [
            makeRecipeVersion({ versionNumber: 1, snapshot: priorSnapshot }),
            makeRecipeVersion({
                versionNumber: 2,
                snapshot: revisedSnapshot,
                changeSummary: 'Tweaked the boil step.',
            }),
        ];
        renderList({ versions, currentVersion: 2 });

        expect(screen.getByText('Changed: Title, Steps')).toBeTruthy();
        expect(screen.getByText('Tweaked the boil step.')).toBeTruthy();
    });
});

describe('RecipeVersionList (native) — preview control', () => {
    it('fires onPreview with the version number for every non-current row', () => {
        const onPreview = vi.fn();
        renderList({ versions: threeVersions, currentVersion: 3, onPreview });

        fireEvent.click(screen.getByRole('button', { name: 'Preview version 2' }));

        expect(onPreview).toHaveBeenCalledWith(2);
    });

    it('renders no Preview control for the current version', () => {
        renderList({ versions: threeVersions, currentVersion: 3, onPreview: vi.fn() });

        expect(screen.queryByRole('button', { name: 'Preview version 3' })).toBeNull();
    });

    it('renders no Preview controls at all when onPreview is not provided', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        expect(screen.queryByRole('button', { name: /^Preview/ })).toBeNull();
    });
});

describe('RecipeVersionList (native) — compare selection (W6 Task 5)', () => {
    it('renders no Compare controls when onToggleCompare is not provided', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('fires onToggleCompare with the version number when its checkbox is toggled', () => {
        const onToggleCompare = vi.fn();
        renderList({ versions: threeVersions, currentVersion: 3, onToggleCompare, selectedForCompare: [] });

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }));

        expect(onToggleCompare).toHaveBeenCalledWith(2);
    });

    it('shows a selected version as checked', () => {
        renderList({
            versions: threeVersions,
            currentVersion: 3,
            onToggleCompare: vi.fn(),
            selectedForCompare: [2],
        });

        // The ☑/☐ glyph is the SIGHTED signal; `aria-checked` is the assistive-tech one (asserted below).
        expect(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }).textContent).toContain('☑');
    });

    it('renders a Compare checkbox for the current version too (compare is not restore-gated)', () => {
        renderList({ versions: threeVersions, currentVersion: 3, onToggleCompare: vi.fn(), selectedForCompare: [] });

        expect(screen.getByRole('checkbox', { name: 'Select version 3 to compare' })).toBeTruthy();
    });

    it('caps selection at two — a disabled (unselected) checkbox does not fire onToggleCompare', () => {
        const onToggleCompare = vi.fn();
        renderList({
            versions: threeVersions,
            currentVersion: 3,
            onToggleCompare,
            selectedForCompare: [1, 2],
        });

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 3 to compare' }));

        expect(onToggleCompare).not.toHaveBeenCalled();
    });

    it('an already-selected checkbox stays toggleable off even once two are chosen', () => {
        const onToggleCompare = vi.fn();
        renderList({
            versions: threeVersions,
            currentVersion: 3,
            onToggleCompare,
            selectedForCompare: [1, 2],
        });

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }));

        expect(onToggleCompare).toHaveBeenCalledWith(2);
    });
});

/**
 * The compare control's CHECKED state has to reach assistive tech on the mobile-WEB build too, and
 * `accessibilityState={{ checked }}` alone does not get there (#123).
 *
 * Verified against the installed react-native-web (0.20.0): its `forwardedProps` allowlist carries every
 * literal `aria-*` attribute but has NO entry that projects `accessibilityState` — the only consumer anywhere
 * in the package is `AccessibilityUtil/isDisabled`, and even that reads the LEGACY `accessibilityStates` array.
 * A `<Pressable accessibilityRole="checkbox" accessibilityState={{ checked: true }}>` therefore renders
 * `<button role="checkbox">` with NO state attribute at all: correct on device (VoiceOver/TalkBack read the
 * native trait), silent on web. That is worse here than for the `selected` chips fixed in #114, because for a
 * `checkbox` the checked state IS the control's purpose — a `role="checkbox"` with no `aria-checked` is an
 * invalid, meaningless control to a screen reader, and the ☑/☐ glyph is a SIGHTED affordance only.
 *
 * The fix is `aria-checked` — the correct and valid attribute for `checkbox`/`radio`, unlike `aria-selected`
 * (which ARIA supports only on `option`/`tab`/`row`/`gridcell`-family roles) and unlike `aria-pressed` (a
 * toggle-BUTTON attribute). `accessibilityState` stays alongside it: RN reverse-maps `aria-checked` into
 * `accessibilityState.checked` (`Pressable.js`: `checked: ariaChecked ?? accessibilityState?.checked`), so the
 * dual form is correct on both platforms and dropping either one silences one of them.
 *
 * BOTH polarities are asserted: `aria-checked="false"` is meaningfully different from the attribute being
 * absent, which is exactly the defect — an absent attribute leaves the control's state unknowable.
 */
describe('RecipeVersionList (native) — the compare checkbox announces its checked state on web too', () => {
    const withCompare = (selectedForCompare: readonly number[]) =>
        renderList({
            versions: threeVersions,
            currentVersion: 3,
            onToggleCompare: noop,
            selectedForCompare: [...selectedForCompare],
        });

    it('marks a SELECTED version checked', () => {
        withCompare([2]);

        expect(screen.getByRole('checkbox', { name: 'Select version 2 to compare' }).getAttribute('aria-checked')).toBe(
            'true',
        );
    });

    it('marks an UNSELECTED version unchecked (present-and-false, not absent)', () => {
        withCompare([2]);

        expect(screen.getByRole('checkbox', { name: 'Select version 1 to compare' }).getAttribute('aria-checked')).toBe(
            'false',
        );
    });

    it('keeps the ARIA state in lockstep with the ☑/☐ glyph across a re-render', () => {
        // Mutation guard: a hard-coded attribute would pass the two cases above. Exactly the selected versions
        // report `aria-checked="true"`, and the same controls are the ones showing ☑.
        withCompare([1, 3]);

        const checked = screen
            .getAllByRole('checkbox')
            .filter((box) => box.getAttribute('aria-checked') === 'true')
            .map((box) => box.getAttribute('aria-label'));

        expect(checked).toEqual(['Select version 3 to compare', 'Select version 1 to compare']);
        checked.forEach((name) => {
            expect(screen.getByRole('checkbox', { name: name ?? '' }).textContent).toContain('☑');
        });
    });
});

/**
 * Cross-platform parity for the web leaf's contrast fix — the two leaves must not drift on legibility any more
 * than on copy. `computedContrast` reads the leaf's colour off react-native-web's compiled atomic CSS and
 * measures it against the surface stated here, rather than pinning a token SPELLING: an equality check against
 * `palette['ocean-dark']` would keep passing if the palette re-themed that token to near-white.
 *
 * Both controls sit directly on the row's opaque `palette.white` card (this leaf paints no tint behind either,
 * unlike the web badge's `bg-seafoam/10`), so white is the surface a reader actually sees behind them. See the
 * palette JSDoc in `@commise/ui`'s `tokens/colors.ts` for the seafoam-as-text rule.
 */
describe('RecipeVersionList (native) — WCAG AA text contrast (SC 1.4.3)', () => {
    it('the "Current version" badge label is legible on the row card', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        expect(
            computedContrast(screen.getByText('Current version'), { surface: palette.white }),
            '"Current version" badge label on the white row card',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('the Restore control’s label is legible on the row card', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        const restore = screen.getByRole('button', { name: 'Restore version 2' });

        expect(
            computedContrast(within(restore).getByText('Restore'), { surface: palette.white }),
            'Restore label on the white row card',
        ).toBeGreaterThanOrEqual(4.5);
    });
});

describe('RecipeVersionList (native) — restore error (B17: no silent failure)', () => {
    it('surfaces the conflict copy when a restore fails because the recipe changed underneath', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoreError: 'conflict' });

        expect(
            screen.getByText(
                'This recipe changed since you opened its history. Review the refreshed list and try again.',
            ),
        ).toBeTruthy();
    });

    it('surfaces the generic copy for any other failed restore', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoreError: 'generic' });

        expect(screen.getByText('We couldn’t restore that version. Please try again.')).toBeTruthy();
    });

    it('shows no error text when the last restore did not fail', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoreError: undefined });

        expect(screen.queryByText(/couldn’t restore/)).toBeNull();
        expect(screen.queryByText(/changed since you opened/)).toBeNull();
    });
});
