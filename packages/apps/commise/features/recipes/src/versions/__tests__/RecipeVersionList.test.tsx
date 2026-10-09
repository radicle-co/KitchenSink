/**
 * The web version history (build spec §6.6), REWRITTEN for slice 6. Rows newest first, each "Version 12 · Edited 2 days
 * ago", "Changed: …" and a ⋯ menu — Preview · Restore this version · Compare with current. Compare is per row against
 * the current version, so the two-version checkbox selection is gone (its coverage moved to `compare.test.ts`, which
 * pins the per-row diff). The current version is marked and offers neither restore nor compare. Empty: the clock
 * glyph, "No earlier versions yet", the explanation and Back to recipe.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { makeRecipeVersion, makeSnapshot } from '../__fixtures__/index.js';
import { RecipeVersionList } from '../RecipeVersionList.js';
import type { RecipeVersionListProps } from '../history.js';
import { recipeVersionMessages } from '../messages.js';

const { versionList } = recipeVersionMessages.en;

afterEach(cleanup);

const NOW = '2026-04-12T09:00:00.000Z';

function renderList(overrides: Partial<RecipeVersionListProps> = {}) {
    const props: RecipeVersionListProps = {
        versions: [],
        currentVersion: 1,
        restoringVersion: null,
        onRestore: vi.fn(),
        now: NOW,
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

describe('RecipeVersionList (web) — chrome', () => {
    it('titles the page "Version history" with the recipe as its subtitle, in every state', () => {
        renderList();

        expect(screen.getByRole('heading', { level: 1, name: versionList.heading })).toBeTruthy();
        expect(screen.getByText('Slow-roasted lamb')).toBeTruthy();
    });

    it('offers Back to recipe when the caller wires it', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        renderList({ versions: threeVersions, currentVersion: 3, onBack, backHref: '/en/recipes/rec_1' });

        await user.click(screen.getAllByRole('link', { name: 'Back to recipe' })[0] as HTMLElement);

        expect(onBack).toHaveBeenCalledTimes(1);
    });
});

describe('RecipeVersionList (web) — empty state', () => {
    it('says there are no earlier versions yet, why, and offers the way back', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        renderList({ onBack });

        expect(screen.getByRole('heading', { name: 'No earlier versions yet' })).toBeTruthy();
        expect(screen.getByText('Each time you save changes, the version before is kept here.')).toBeTruthy();
        expect(screen.queryByRole('listitem')).toBeNull();

        // The empty state's own action, after the header's back link: the last of the two.
        await user.click(screen.getAllByRole('button', { name: 'Back to recipe' }).at(-1) as HTMLElement);
        expect(onBack).toHaveBeenCalled();
    });
});

describe('RecipeVersionList (web) — rows', () => {
    it('lists the versions newest first, each with its number and how long ago it was edited', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        const titles = screen
            .getAllByRole('listitem')
            .map((item) => item.querySelector('[data-row-title]')?.textContent);

        expect(titles).toEqual([
            'Version 3 · Edited 2 days ago',
            'Version 2 · Edited 7 days ago',
            'Version 1 · Edited 11 days ago',
        ]);
    });

    it('says what each version changed against the one before, and marks the first', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        const [newest, , oldest] = screen.getAllByRole('listitem');

        expect(within(newest as HTMLElement).getByText('Changed: Title')).toBeTruthy();
        expect(within(oldest as HTMLElement).getByText(versionList.initialVersion)).toBeTruthy();
    });

    it('renders the editor handle as plain text, never as markup', () => {
        renderList({
            versions: [makeRecipeVersion({ versionNumber: 1, editorHandle: '<b>chef</b>' })],
            currentVersion: 1,
        });

        expect(screen.getByText('by @<b>chef</b>')).toBeTruthy();
    });

    it('marks the current version and offers it no ⋯ menu — nothing to restore or compare', () => {
        renderList({ versions: threeVersions, currentVersion: 3 });

        const [current] = screen.getAllByRole('listitem');

        expect(within(current as HTMLElement).getByText(versionList.currentBadge)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'More actions for version 3' })).toBeNull();
        expect(screen.getByRole('button', { name: 'More actions for version 2' })).toBeTruthy();
    });
});

describe('RecipeVersionList (web) — the row menu', () => {
    it('offers Preview, Restore this version and Compare with current, each reporting the version', async () => {
        const user = userEvent.setup();
        const onPreview = vi.fn();
        const onCompare = vi.fn();
        const props = renderList({ versions: threeVersions, currentVersion: 3, onPreview, onCompare });

        await user.click(screen.getByRole('button', { name: 'More actions for version 2' }));
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'Preview',
            'Restore this version',
            'Compare with current',
        ]);
        await user.click(screen.getByRole('menuitem', { name: 'Restore this version' }));
        expect(props.onRestore).toHaveBeenCalledWith(2);

        await user.click(screen.getByRole('button', { name: 'More actions for version 1' }));
        await user.click(screen.getByRole('menuitem', { name: 'Compare with current' }));
        expect(onCompare).toHaveBeenCalledWith(1);

        await user.click(screen.getByRole('button', { name: 'More actions for version 2' }));
        await user.click(screen.getByRole('menuitem', { name: 'Preview' }));
        expect(onPreview).toHaveBeenCalledWith(2);
    });

    it('draws no Preview or Compare entry when the caller wires neither', async () => {
        const user = userEvent.setup();
        renderList({ versions: threeVersions, currentVersion: 3 });

        await user.click(screen.getByRole('button', { name: 'More actions for version 2' }));

        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Restore this version']);
    });
});

describe('RecipeVersionList (web) — restoring and its failure', () => {
    it('says which version is restoring and makes every row menu unavailable', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoringVersion: 2 });

        expect(screen.getByRole('status').textContent).toBe('Restoring version 2…');

        for (const trigger of screen.getAllByRole('button', { name: /^More actions for version/u })) {
            expect(trigger.getAttribute('aria-disabled')).toBe('true');
        }
    });

    it('surfaces a failed restore as an alert, never a silent no-op (B17)', () => {
        renderList({ versions: threeVersions, currentVersion: 3, restoreError: { kind: 'generic', versionNumber: 2 } });

        expect(screen.getByRole('alert').textContent).toBe(versionList.restoreGenericError);
    });
});
