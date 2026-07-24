// @vitest-environment jsdom
/**
 * Component tests for the web recipe version-history view (T069). Covers every branch the mandate
 * requires — empty, populated (newest-first, version number + timestamp), the current version marked and
 * NOT restorable, the restore interaction (fires with the right version), and the busy/restoring state
 * (status announced, restore actions disabled) — asserting on role/name/text so a dropped branch fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { makeRecipeVersion } from '../__fixtures__/index.js';
import { RecipeVersionList } from '../RecipeVersionList.js';
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

describe('RecipeVersionList (web) — chrome', () => {
    it('always renders the version-history heading', () => {
        renderList();

        expect(screen.getByRole('heading', { name: 'Version history' })).toBeTruthy();
    });
});

describe('RecipeVersionList (web) — empty state', () => {
    it('shows the empty message and no version rows', () => {
        renderList({ versions: [] });

        expect(screen.getByText('No earlier versions yet.')).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();
    });
});

describe('RecipeVersionList (web) — populated state', () => {
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

    it('renders one list item per version', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);
    });
});

describe('RecipeVersionList (web) — current version', () => {
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

describe('RecipeVersionList (web) — restore interaction', () => {
    it('reports the chosen version number upward', () => {
        const onRestore = vi.fn();
        renderList({ versions: threeVersions, currentVersion: 3, onRestore });

        fireEvent.click(screen.getByRole('button', { name: 'Restore version 2' }));

        expect(onRestore).toHaveBeenCalledWith(2);
    });
});

describe('RecipeVersionList (web) — restoring state', () => {
    it('announces a busy status for the version being restored', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoringVersion: 2 });

        expect(screen.getByRole('status').textContent).toContain('Restoring version 2');
    });

    it('disables all restore actions while a restore is in flight', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoringVersion: 2 });

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Restore version 1' }).disabled).toBe(true);
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Restore version 2' }).disabled).toBe(true);
    });

    it('does not fire restore when a disabled action is activated', () => {
        const onRestore = vi.fn();
        renderList({ versions: threeVersions, currentVersion: 3, restoringVersion: 2, onRestore });

        fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' }));

        expect(onRestore).not.toHaveBeenCalled();
    });
});

describe('RecipeVersionList (web) — editor/device attribution', () => {
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

    it('renders the device label as plain text, never as markup (untrusted free text)', () => {
        const versions = [
            makeRecipeVersion({
                versionNumber: 1,
                editorHandle: 'clara',
                deviceLabel: '<img src=x onerror=alert(1)>',
            }),
        ];
        renderList({ versions, currentVersion: 1 });

        expect(screen.getByText('by @clara (from <img src=x onerror=alert(1)>)')).toBeTruthy();
        expect(document.querySelector('img')).toBeNull();
    });
});

describe('RecipeVersionList (web) — changed-fields summary', () => {
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
        const versions = [
            makeRecipeVersion({ versionNumber: 1, snapshot: priorSnapshot }),
            makeRecipeVersion({ versionNumber: 2, snapshot: revisedSnapshot }),
        ];
        renderList({ versions, currentVersion: 2 });

        const initialRow = screen.getByText('Version 1').closest('li');
        expect(initialRow).not.toBeNull();
        expect(within(initialRow as HTMLElement).getByText('Initial version')).toBeTruthy();
        expect(within(initialRow as HTMLElement).queryByText(/^Changed:/)).toBeNull();
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

describe('RecipeVersionList (web) — preview control', () => {
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

describe('RecipeVersionList (web) — back to recipe (V6)', () => {
    it('renders a back-to-recipe control that activates onBack', () => {
        const onBack = vi.fn();
        renderList({ versions: threeVersions, currentVersion: 3, onBack });

        fireEvent.click(screen.getByRole('button', { name: /back/i }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('renders no back control when onBack is not provided', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
        expect(screen.queryByRole('link', { name: /back/i })).toBeNull();
    });

    it('renders the back control in the empty state too', () => {
        const onBack = vi.fn();
        renderList({ versions: [], onBack });

        expect(screen.getByRole('button', { name: /back/i })).toBeTruthy();
    });
});

describe('RecipeVersionList (web) — restore error (B17: no silent failure)', () => {
    it('surfaces the conflict copy when a restore fails because the recipe changed underneath', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoreError: 'conflict' });

        expect(screen.getByRole('alert').textContent).toBe(
            'This recipe changed since you opened its history. Review the refreshed list and try again.',
        );
    });

    it('surfaces the generic copy for any other failed restore', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoreError: 'generic' });

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t restore that version. Please try again.');
    });

    it('shows no alert when the last restore did not fail', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoreError: undefined });

        expect(screen.queryByRole('alert')).toBeNull();
    });
});
