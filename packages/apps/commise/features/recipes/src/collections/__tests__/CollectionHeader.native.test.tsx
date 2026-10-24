/**
 * The native collection header (`docs/design/uiOverhaul/buildSpec.md` §5.2): the name as the page's one H1, the meta line —
 * visibility (icon and word), "6 recipes" and, for a copy, "Copied from @clara" — the description, and ONE primary (Add
 * recipes). At a 600 container it sits at the end of the title row; below it, under the description. Either way it is drawn
 * once.
 *
 * ⚠️ REWRITTEN for the pinned back bar (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §4, §7). The header no longer draws
 * Back (the pinned bar owns it: a second one here was an off-screen duplicate with the same name) and no longer draws the ⋯
 * menu (it moved into the bar, as `CollectionMoreMenu`). The menu's cases moved to `CollectionMoreMenu.native.test.tsx`
 * and the Back case became "draws no Back".
 *
 * ⚠️ REWRITTEN for slice 5. The header used to carry its own Edit and Delete buttons and a separate actions panel held
 * Add, Pull, Clone and the visibility toggle; one primary and one menu replace them all (the pair
 * `LargeTitleHeader.action` takes).
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { CollectionHeader } from '../CollectionHeader.native.js';
import type { CollectionHeaderProps } from '../detailModel.js';

afterEach(cleanup);

function renderHeader(over: Partial<CollectionHeaderProps> = {}) {
    const props: CollectionHeaderProps = {
        name: 'Weeknight Dinners',
        description: 'Quick dinners for school nights.',
        visibility: RecipeVisibility.PRIVATE,
        recipeCount: 6,
        actionsPlacement: 'title',
        headingId: 'collection-title',
        headingFocusSignal: 0,
        onBack: vi.fn(),
        onAddRecipes: vi.fn(),
        onRename: vi.fn(),
        onToggleVisibility: vi.fn(),
        onSaveCopy: vi.fn(),
        onPullUpdates: vi.fn(),
        onDelete: vi.fn(),
        ...over,
    };

    render(
        <LocaleProvider locale="en">
            <CollectionHeader {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('CollectionHeader (native) — what it says', () => {
    it('is the name as the page’s one H1', () => {
        renderHeader();

        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1, name: 'Weeknight Dinners' })).toBeTruthy();
    });

    it('draws no Back, though it is given one: the screen’s pinned bar owns it', () => {
        renderHeader();

        expect(screen.queryAllByRole('button', { name: 'Back to Collections', hidden: true })).toHaveLength(0);
    });

    it('states visibility as a word, the recipe count, and the description', () => {
        renderHeader({ visibility: RecipeVisibility.PUBLIC, recipeCount: 1 });

        expect(screen.getByText('Public')).toBeTruthy();
        expect(screen.getByText('1 recipe')).toBeTruthy();
        expect(screen.getByText('Quick dinners for school nights.')).toBeTruthy();
    });

    it('says Private for a private collection', () => {
        renderHeader({ visibility: RecipeVisibility.PRIVATE });

        expect(screen.getByText('Private')).toBeTruthy();
    });

    it('says a copy’s source: by handle, by name alone, or in general — and nothing for an original', () => {
        renderHeader({
            sourceCollectionName: 'Dinners',
            sourceOwnerUsername: 'clara',
            sourceOwnerDisplayName: 'Clara Oswald',
        });
        expect(screen.getByText('Copied from \u2068@clara\u2069 (\u2068Clara Oswald\u2069)')).toBeTruthy();
    });

    // Plan 2026-10-15-010 D11: the source owner's byline is the same rule every surface renders.
    it('says “Copied from Display Name”, never prefixed “@”, when the source owner has no username', () => {
        renderHeader({ sourceCollectionName: 'Dinners', sourceOwnerDisplayName: 'Clara Oswald' });
        expect(screen.getByText('Copied from \u2068Clara Oswald\u2069')).toBeTruthy();
    });

    it('says “Copied from a former member” when the source owner was erased — never the pseudonym', () => {
        renderHeader({ sourceCollectionName: 'Dinners', sourceOwnerDisplayName: 'user_01J9ZK8N7QF3B2X4M6T0V5C1AB' });
        expect(screen.getByText('Copied from a former member')).toBeTruthy();
        cleanup();

        renderHeader({ sourceCollectionName: 'Dinners' });
        expect(screen.getByText('Copied from “Dinners”')).toBeTruthy();
        cleanup();

        renderHeader({ sourceCollectionId: 'col_9' });
        expect(screen.getByText('Copied from another collection')).toBeTruthy();
        cleanup();

        renderHeader();
        expect(screen.queryByText(/Copied from/u)).toBeNull();
    });

    it('opens the original from “Copied from …” when it knows which one that is', () => {
        const onViewSource = vi.fn();
        renderHeader({
            sourceCollectionName: 'Dinners',
            sourceOwnerUsername: 'clara',
            sourceCollectionId: 'col_9',
            onViewSource,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Copied from \u2068@clara\u2069' }));

        expect(onViewSource).toHaveBeenCalledExactlyOnceWith('col_9');
    });

    it('says when the copy last took updates from the original', () => {
        renderHeader({ sourceCollectionName: 'Dinners', lastPulledAt: '2026-04-19T09:30:00.000Z' });

        expect(screen.getByText(/Last pulled: Apr 19, 2026/u)).toBeTruthy();
    });

    it('draws no description when there is none', () => {
        renderHeader({ description: undefined });

        expect(screen.queryByText('Quick dinners for school nights.')).toBeNull();
    });
});

describe.each(['title', 'below'] as const)(
    'CollectionHeader (native) — actions placed in the %s',
    (actionsPlacement) => {
        it('draws one Add recipes and no ⋯ menu: the menu is in the pinned bar', () => {
            const props = renderHeader({ actionsPlacement });

            expect(screen.getAllByRole('button', { name: 'Add recipes' })).toHaveLength(1);
            expect(
                screen.queryByRole('button', { name: 'More actions for Weeknight Dinners', hidden: true }),
            ).toBeNull();

            fireEvent.click(screen.getByRole('button', { name: 'Add recipes' }));

            expect(props.onAddRecipes).toHaveBeenCalledOnce();
        });
    },
);

describe('CollectionHeader (native) — placement in the document', () => {
    it('puts the pair in the title row from a 600 container, ahead of the description', () => {
        renderHeader({ actionsPlacement: 'title' });
        const add = screen.getByRole('button', { name: 'Add recipes' });
        const description = screen.getByText('Quick dinners for school nights.');

        expect(add.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('puts the pair under the description below it, with Add recipes filling the row', () => {
        renderHeader({ actionsPlacement: 'below' });
        const add = screen.getByRole('button', { name: 'Add recipes' });
        const description = screen.getByText('Quick dinners for school nights.');

        expect(description.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe('CollectionHeader (native) — a failed refresh', () => {
    const notice = (over: Partial<NonNullable<CollectionHeaderProps['refreshNotice']>> = {}) => ({
        failed: false,
        refreshing: false,
        onRetry: vi.fn(),
        recoveries: 0,
        ...over,
    });

    it('says so, with a Try again that retries', () => {
        const refreshNotice = notice({ failed: true });
        renderHeader({ refreshNotice });

        expect(screen.getAllByText('We couldn’t refresh this collection.').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(refreshNotice.onRetry).toHaveBeenCalledOnce();
    });
});
