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
