/**
 * The native version history (build spec §6.6), REWRITTEN for slice 6 — the mirror of `RecipeVersionList.test.tsx`:
 * rows newest first with the relative edit time, what changed, and a ⋯ menu (a bottom sheet) of Preview · Restore
 * this version · Compare with current; the current version marked with no menu; the empty state with its
 * explanation. The two-version checkbox selection is gone; its coverage moved to `compare.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { makeRecipeVersion, makeSnapshot } from '../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeVersionList } from '../RecipeVersionList.native.js';
import type { RecipeVersionListProps } from '../history.js';
import { recipeVersionMessages } from '../messages.js';

const { versionList } = recipeVersionMessages.en;

afterEach(cleanup);

function renderList(overrides: Partial<RecipeVersionListProps> = {}) {
    const props: RecipeVersionListProps = {
        versions: [],
        currentVersion: 1,
        restoringVersion: null,
        onRestore: vi.fn(),
        now: '2026-04-12T09:00:00.000Z',
        recipeTitle: 'Slow-roasted lamb',
        ...overrides,
    };
    render(<RecipeVersionList {...props} />);

    return props;
}

const threeVersions = [
    makeRecipeVersion({
        versionNumber: 1,
        createdAt: '2026-04-01T09:00:00.000Z',
        snapshot: makeSnapshot({ title: 'A' }),
    }),
    makeRecipeVersion({
        versionNumber: 2,
        createdAt: '2026-04-05T09:00:00.000Z',
        snapshot: makeSnapshot({ title: 'B' }),
    }),
    makeRecipeVersion({
        versionNumber: 3,
        createdAt: '2026-04-10T09:00:00.000Z',
        snapshot: makeSnapshot({ title: 'C' }),
    }),
];

describe('RecipeVersionList (native)', () => {
    it('titles the screen with the recipe as its subtitle', () => {
        renderList();

        expect(screen.getByRole('heading', { name: versionList.heading })).toBeTruthy();
        expect(screen.getByText('Slow-roasted lamb')).toBeTruthy();
    });

    it('says there are no earlier versions yet, and why', () => {
        renderList();

        expect(screen.getByText('No earlier versions yet')).toBeTruthy();
        expect(screen.getByText('Each time you save changes, the version before is kept here.')).toBeTruthy();
    });

    it('lists the versions newest first with how long ago each was edited', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        expect(screen.getByText('Version 3 · Edited 2 days ago')).toBeTruthy();
        const titles = screen.getAllByText(/^Version \d · Edited/u).map((node) => node.textContent);
        expect(titles).toEqual([
            'Version 3 · Edited 2 days ago',
            'Version 2 · Edited 7 days ago',
            'Version 1 · Edited 11 days ago',
        ]);
        expect(screen.getAllByText('Changed: Title')).toHaveLength(2);
        expect(screen.getByText(versionList.initialVersion)).toBeTruthy();
    });

    it('marks the current version with no menu, and gives every other row one', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        expect(screen.getByText(versionList.currentBadge)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'More actions for version 3' })).toBeNull();
        expect(screen.getByRole('button', { name: 'More actions for version 1' })).toBeTruthy();
    });

    it('offers Preview, Restore this version and Compare with current, each reporting the version', () => {
        const onPreview = vi.fn();
        const onCompare = vi.fn();
        const props = renderList({ versions: threeVersions, currentVersion: 3, onPreview, onCompare });

        fireEvent.click(screen.getByRole('button', { name: 'More actions for version 2' }));
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'Preview',
            'Restore this version',
            'Compare with current',
        ]);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Compare with current' }));
        expect(onCompare).toHaveBeenCalledWith(2);

        fireEvent.click(screen.getByRole('button', { name: 'More actions for version 1' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Restore this version' }));
        expect(props.onRestore).toHaveBeenCalledWith(1);

        fireEvent.click(screen.getByRole('button', { name: 'More actions for version 1' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Preview' }));
        expect(onPreview).toHaveBeenCalledWith(1);
    });

    it('says which version is restoring, and the row menus are unavailable meanwhile', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoringVersion: 2 });

        expect(screen.getByText('Restoring version 2…')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'More actions for version 1' }));
        expect(screen.queryByRole('menuitem')).toBeNull();
    });

    it('surfaces a failed restore as an alert (B17)', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoreError: { kind: 'generic', versionNumber: 2 } });

        expect(within(screen.getByRole('alert')).getByText(versionList.restoreGenericError)).toBeTruthy();
    });
});
