// @vitest-environment jsdom
/**
 * A collection's header (`docs/design/uiOverhaul/buildSpec.md` §5.2): "‹ Collections" back, the name as the page's one H1,
 * the meta line — visibility (icon and word), "6 recipes" and, for a copy, "Copied from @clara" — the description, and ONE
 * primary (Add recipes) with ONE ⋯ menu named for the collection: Rename · Make private / Make public · Save a copy · Pull
 * updates (copies only) · divider · Delete collection. At a 600 container the pair sits at the end of the title row; below
 * it, under the description. Either way it is drawn once.
 *
 * ⚠️ REWRITTEN for slice 5. The header used to carry its own Edit and Delete buttons and a separate actions panel held
 * Add, Pull, Clone and the visibility toggle; one primary and one menu replace them all (the pair
 * `LargeTitleHeader.action` takes).
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { CollectionHeader } from '../CollectionHeader.js';
import type { CollectionHeaderProps } from '../detailModel.js';

afterEach(cleanup);

if (typeof Element !== 'undefined') {
    // jsdom implements neither pointer capture nor scrollIntoView, which Radix's menu calls on open.
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

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

describe('CollectionHeader (web) — what it says', () => {
    it('is the name as the page’s one H1', () => {
        renderHeader();

        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1, name: 'Weeknight Dinners' }).id).toBe('collection-title');
    });

    it('goes back to the collections list from “Back to Collections”', async () => {
        const user = userEvent.setup();
        const props = renderHeader({ backHref: '/en/recipes?segment=collections' });

        await user.click(screen.getByRole('link', { name: 'Back to Collections' }));

        expect(props.onBack).toHaveBeenCalledOnce();
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
        renderHeader({ sourceCollectionName: 'Dinners', sourceOwnerDisplayName: 'clara' });
        expect(screen.getByText('Copied from @clara')).toBeTruthy();
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

    it('opens the original from “Copied from …” when it knows which one that is', async () => {
        const user = userEvent.setup();
        const onViewSource = vi.fn();
        renderHeader({
            sourceCollectionName: 'Dinners',
            sourceOwnerDisplayName: 'clara',
            sourceCollectionId: 'col_9',
            onViewSource,
        });

        await user.click(screen.getByRole('button', { name: 'Copied from @clara' }));

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

describe.each(['title', 'below'] as const)('CollectionHeader (web) — actions placed in the %s', (actionsPlacement) => {
    it('draws one Add recipes and one ⋯ menu named for the collection, whichever placement', async () => {
        const user = userEvent.setup();
        const props = renderHeader({ actionsPlacement });

        expect(screen.getAllByRole('button', { name: 'Add recipes' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'More actions for Weeknight Dinners' })).toHaveLength(1);

        await user.click(screen.getByRole('button', { name: 'Add recipes' }));

        expect(props.onAddRecipes).toHaveBeenCalledOnce();
    });
});

describe('CollectionHeader (web) — placement in the document', () => {
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
        expect(add.className).toContain('w-full');
    });
});

describe('CollectionHeader (web) — W-07: the meta line separates its groups with the locale separator, and never starts a line with it', () => {
    const items = (): readonly HTMLElement[] => {
        const line = screen.getByText('6 recipes').closest('p') as HTMLElement;

        return [...line.querySelectorAll<HTMLElement>('[data-sep]')];
    };

    it('draws the locale’s separator from the item’s data, not a hard-coded dot', () => {
        renderHeader({ sourceCollectionName: 'Dinners' });

        expect(items().map((item) => item.getAttribute('data-sep'))).toEqual(['·', '·', '·']);

        for (const item of items()) {
            expect(item.className.split(/\s+/u)).toContain('before:content-[attr(data-sep)]');
        }
    });

    it('hangs each separator in the item’s own start padding, so the clipped line start hides the one a wrap leaves first', () => {
        renderHeader({ sourceCollectionName: 'Dinners' });
        const line = screen.getByText('6 recipes').closest('p') as HTMLElement;

        // The separator sits BEFORE its item, outside the item's content, at the item's start edge...
        for (const item of items()) {
            expect(item.className.split(/\s+/u)).toEqual(
                expect.arrayContaining(['ps-3', 'before:absolute', 'before:start-0']),
            );
            expect(item.className.split(/\s+/u).filter((token) => token.startsWith('not-first:'))).toEqual([]);
        }

        // ...and the line is pulled one padding to the start inside a clipping box, so the first item of every line
        // (whatever wrapped it there) has its separator outside what shows.
        expect(line.className.split(/\s+/u)).toContain('-ms-3');
        expect(line.parentElement?.className.split(/\s+/u)).toContain('overflow-hidden');
    });
});

describe('CollectionHeader (web) — the ⋯ menu', () => {
    async function open(user: ReturnType<typeof userEvent.setup>) {
        await user.click(screen.getByRole('button', { name: 'More actions for Weeknight Dinners' }));

        return within(await screen.findByRole('menu'));
    }

    it('lists Rename, Make public (for a private collection) and Save a copy for an original, then Delete after a divider', async () => {
        const user = userEvent.setup();
        renderHeader({ visibility: RecipeVisibility.PRIVATE });
        const menu = await open(user);

        expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'Rename',
            'Make public',
            'Save a copy',
            'Delete collection',
        ]);
        expect(screen.getByRole('separator')).toBeTruthy();
    });

    /** The Registry glyph an item drew, by its Lucide class (`lucide-pencil-line`). */
    const glyphOf = (item: HTMLElement): readonly string[] =>
        [...(item.querySelector('svg.lucide')?.classList ?? [])].filter((token) => /^lucide-./u.test(token));

    it('draws a glyph on every item, from the one glyph list (A-020, §1.7)', async () => {
        const user = userEvent.setup();
        renderHeader({ visibility: RecipeVisibility.PRIVATE, sourceCollectionName: 'Dinners' });
        const menu = await open(user);
        const glyph = (name: string): readonly string[] => glyphOf(menu.getByRole('menuitem', { name }));

        expect(glyph('Rename')).toContain('lucide-pencil-line');
        expect(glyph('Make public')).toContain('lucide-globe');
        expect(glyph('Save a copy')).toContain('lucide-copy-plus');
        expect(glyph('Pull updates')).toContain('lucide-refresh-cw');
        expect(glyph('Delete collection')).toContain('lucide-trash-2');
    });

    /** Plan 2026-10-14-009 D14: the host leaves the visibility item out when Private is not offered (hidden, loading). */
    it('offers no visibility item when the host gives no toggle', async () => {
        const user = userEvent.setup();
        renderHeader({ onToggleVisibility: undefined });

        const menu = await open(user);

        expect(menu.queryByRole('menuitem', { name: 'Make private' })).toBeNull();
        expect(menu.queryByRole('menuitem', { name: 'Make public' })).toBeNull();
        expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    });

    it('draws the lock on Make private', async () => {
        const user = userEvent.setup();
        renderHeader({ visibility: RecipeVisibility.PUBLIC });
        const menu = await open(user);

        expect(glyphOf(menu.getByRole('menuitem', { name: 'Make private' }))).toContain('lucide-lock');
    });

    it('offers Make private for a public collection', async () => {
        const user = userEvent.setup();
        renderHeader({ visibility: RecipeVisibility.PUBLIC });
        const menu = await open(user);

        expect(menu.getByRole('menuitem', { name: 'Make private' })).toBeTruthy();
        expect(menu.queryByRole('menuitem', { name: 'Make public' })).toBeNull();
    });

    it('adds Pull updates, after Save a copy, for a copy only', async () => {
        const user = userEvent.setup();
        renderHeader({ sourceCollectionName: 'Dinners' });
        const menu = await open(user);

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
        const user = userEvent.setup();
        const props = renderHeader({ visibility: RecipeVisibility.PRIVATE });
        const menu = await open(user);

        await user.click(menu.getByRole('menuitem', { name: label }));

        await vi.waitFor(() => expect(props[callback]).toHaveBeenCalledOnce());
    });

    it('Pull updates reports it', async () => {
        const user = userEvent.setup();
        const props = renderHeader({ sourceCollectionName: 'Dinners' });
        const menu = await open(user);

        await user.click(menu.getByRole('menuitem', { name: 'Pull updates' }));

        await vi.waitFor(() => expect(props.onPullUpdates).toHaveBeenCalledOnce());
    });
});

describe('CollectionHeader (web) — a failed refresh', () => {
    const notice = (over: Partial<NonNullable<CollectionHeaderProps['refreshNotice']>> = {}) => ({
        failed: false,
        refreshing: false,
        onRetry: vi.fn(),
        recoveries: 0,
        ...over,
    });

    it('says so, with a Try again that retries', async () => {
        const user = userEvent.setup();
        const refreshNotice = notice({ failed: true });
        renderHeader({ refreshNotice });

        expect(screen.getAllByText('We couldn’t refresh this collection.').length).toBeGreaterThan(0);

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(refreshNotice.onRetry).toHaveBeenCalledOnce();
    });

    it('moves focus to the H1 when the heading’s signal advances', () => {
        const props = renderHeader();
        const view = (signal: number) => (
            <LocaleProvider locale="en">
                <CollectionHeader {...props} headingFocusSignal={signal} />
            </LocaleProvider>
        );
        cleanup();
        const { rerender } = render(view(0));

        rerender(view(1));

        expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    });
});
