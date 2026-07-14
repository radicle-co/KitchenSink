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
