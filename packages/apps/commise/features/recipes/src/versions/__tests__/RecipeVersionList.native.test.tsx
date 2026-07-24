/**
 * Native component tests for the recipe version-history view (T069), rendered via react-native-web under
 * jsdom. Mirrors the web leaf across EVERY branch — empty, populated (newest-first, number + timestamp),
 * current marked and not restorable, restore interaction, and the busy/restoring state — so the two
 * platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

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
});

describe('RecipeVersionList (native) — editor/device attribution', () => {
    it('shows "by @handle (from device)" when both are present', () => {
        const versions = [makeRecipeVersion({ versionNumber: 1, editorHandle: 'clara', deviceLabel: 'iPhone' })];
        renderList({ versions, currentVersion: 1 });

        expect(screen.getByText('by @clara (from iPhone)')).toBeTruthy();
    });

    it('shows "by @handle" with no device suffix when only the handle is present', () => {
        const versions = [makeRecipeVersion({ versionNumber: 1, editorHandle: 'clara', deviceLabel: undefined })];
        renderList({ versions, currentVersion: 1 });

        expect(screen.getByText('by @clara')).toBeTruthy();
    });

    it('renders no attribution line when neither the handle nor the device is present', () => {
        const versions = [makeRecipeVersion({ versionNumber: 1, editorHandle: undefined, deviceLabel: undefined })];
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

        // react-native-web renders role="checkbox" but not `aria-checked` — assert the checked glyph
        // (mirrors `RecipeDetailView.native.test.tsx`'s ingredient-checkbox convention).
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
