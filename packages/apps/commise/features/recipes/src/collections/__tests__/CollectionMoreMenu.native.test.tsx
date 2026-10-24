/**
 * The collection ⋯ menu (native), drawn in the pinned bar (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §7): one ⋯
 * named for the collection — Rename · Make private / Make public · Save a copy · Pull updates (copies only) · divider ·
 * Delete collection.
 *
 * Coverage MOVED here from `CollectionHeader.native.test.tsx`, which no longer draws the menu: it left the header for the
 * bar, as its own component, so the same cases now run against it. `collectionMenuItems` (the entries) has its own suite.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { CollectionMoreMenu } from '../CollectionMoreMenu.js';
import type { CollectionMoreMenuProps } from '../detailModel.js';

afterEach(cleanup);

function renderMenu(over: Partial<CollectionMoreMenuProps> = {}) {
    const props: CollectionMoreMenuProps = {
        name: 'Weeknight Dinners',
        visibility: RecipeVisibility.PRIVATE,
        isCopy: false,
        onRename: vi.fn(),
        onToggleVisibility: vi.fn(),
        onSaveCopy: vi.fn(),
        onPullUpdates: vi.fn(),
        onDelete: vi.fn(),
        ...over,
    };

    render(
        <LocaleProvider locale="en">
            <CollectionMoreMenu {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('CollectionMoreMenu (native)', () => {
    function open() {
        fireEvent.click(screen.getByRole('button', { name: 'More actions for Weeknight Dinners' }));

        return screen;
    }

    it('lists Rename, Make public (for a private collection) and Save a copy for an original, then Delete after a divider', () => {
        renderMenu({ visibility: RecipeVisibility.PRIVATE });
        const menu = open();

        expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'Rename',
            'Make public',
            'Save a copy',
            'Delete collection',
        ]);
    });

    /** The glyph an item drew: the stand-in publishes the Lucide name it was drawn with. */
    const glyphOf = (item: HTMLElement): string | undefined =>
        item.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName'];

    it('draws a glyph on every item, from the one glyph list (A-020, §1.7)', () => {
        renderMenu({ visibility: RecipeVisibility.PRIVATE, isCopy: true });
        const menu = open();
        const glyph = (name: string): string | undefined => glyphOf(menu.getByRole('menuitem', { name }));

        expect(glyph('Rename')).toBe('pencil-line');
        expect(glyph('Make public')).toBe('globe');
        expect(glyph('Save a copy')).toBe('copy-plus');
        expect(glyph('Pull updates')).toBe('refresh-cw');
        expect(glyph('Delete collection')).toBe('trash');
    });

    /** Plan 2026-10-14-009 D14: the host leaves the visibility item out when Private is not offered (hidden, loading). */
    it('offers no visibility item when the host gives no toggle', () => {
        renderMenu({ onToggleVisibility: undefined });
        const menu = open();

        expect(menu.queryByRole('menuitem', { name: 'Make private' })).toBeNull();
        expect(menu.queryByRole('menuitem', { name: 'Make public' })).toBeNull();
        expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    });

    it('draws the lock on Make private', () => {
        renderMenu({ visibility: RecipeVisibility.PUBLIC });
        const menu = open();

        expect(glyphOf(menu.getByRole('menuitem', { name: 'Make private' }))).toBe('lock');
    });

    it('offers Make private for a public collection', () => {
        renderMenu({ visibility: RecipeVisibility.PUBLIC });
        const menu = open();

        expect(menu.getByRole('menuitem', { name: 'Make private' })).toBeTruthy();
        expect(menu.queryByRole('menuitem', { name: 'Make public' })).toBeNull();
    });

    it('adds Pull updates, after Save a copy, for a copy only', () => {
        renderMenu({ isCopy: true });
        const menu = open();

        expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'Rename',
            'Make public',
            'Save a copy',
            'Pull updates',
            'Delete collection',
        ]);
    });

    it.each([
        ['Rename', 'onRename'],
        ['Make public', 'onToggleVisibility'],
        ['Save a copy', 'onSaveCopy'],
        ['Delete collection', 'onDelete'],
    ] as const)('%s reports what it asks for', async (label, callback) => {
        const props = renderMenu({ visibility: RecipeVisibility.PRIVATE });
        const menu = open();

        fireEvent.click(menu.getByRole('menuitem', { name: label }));

        expect(props[callback]).toHaveBeenCalledOnce();
    });

    it('Pull updates reports it', () => {
        const props = renderMenu({ isCopy: true });
        const menu = open();

        fireEvent.click(menu.getByRole('menuitem', { name: 'Pull updates' }));

        expect(props.onPullUpdates).toHaveBeenCalledOnce();
    });
});
