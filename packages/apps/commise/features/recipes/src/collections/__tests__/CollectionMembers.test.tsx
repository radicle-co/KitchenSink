// @vitest-environment jsdom
/**
 * A collection's member list (`docs/design/uiOverhaul/buildSpec.md` §5.2): "6 recipes" and the list/grid switch it
 * shares with My recipes, the members as cards in the variant the host decided, "Load more ({n} more)" past the reveal
 * window, the empty state "No recipes here yet" with Add recipes, and an alert when a removal that had been committed
 * failed. Removing a row moves focus to the next row's link, or to the page's H1 after the last.
 *
 * ⚠️ REWRITTEN for slice 5, replacing `CollectionDetail.test.tsx`. The list used to carry its own "Add a recipe" button
 * and a delete/remove error banner (the page's header and the removal hook own those now); it had no view switch, no count,
 * and focus fell to the page when a row was removed. The windowing and the empty copy are kept.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { makeCollectionMemberRecipe } from '../../__fixtures__/index.js';
import { CollectionMembers } from '../CollectionMembers.js';
import type { CollectionMembersProps } from '../detailModel.js';

afterEach(cleanup);

if (typeof Element !== 'undefined') {
    // jsdom implements neither pointer capture nor scrollIntoView, which Radix's menu calls on open.
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

const members = (count: number) =>
    Array.from({ length: count }, (_, index) =>
        makeCollectionMemberRecipe({ id: `rec_${String(index)}`, title: `Recipe ${String(index)}` }),
    );

function renderMembers(over: Partial<CollectionMembersProps> = {}) {
    const props: CollectionMembersProps = {
        members: members(2),
        viewMode: 'list',
        onViewModeChange: vi.fn(),
        variant: 'row',
        hrefOf: (id) => `/en/recipes/${id}`,
        onSelectRecipe: vi.fn(),
        onRemoveRecipe: vi.fn(),
        onAddRecipes: vi.fn(),
        headingId: 'collection-title',
        ...over,
    };

    render(
        <LocaleProvider locale="en">
            <h1 id="collection-title" tabIndex={-1}>
                Dinners
            </h1>
            <CollectionMembers {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('CollectionMembers (web) — the list', () => {
    it('says how many recipes there are, and draws each as a card link', () => {
        renderMembers({ members: members(2) });

        expect(screen.getByText('2 recipes')).toBeTruthy();
        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByRole('link', { name: 'Recipe 1' }).getAttribute('href')).toBe('/en/recipes/rec_1');
    });

    it('says “1 recipe” for one', () => {
        renderMembers({ members: members(1) });

        expect(screen.getByText('1 recipe')).toBeTruthy();
    });

    it('offers the same list/grid switch as My recipes, and reports a choice', async () => {
        const user = userEvent.setup();
        const props = renderMembers();
        const group = screen.getByRole('radiogroup', { name: 'View' });

        expect(within(group).getByRole('radio', { name: 'List view' }).getAttribute('aria-checked')).toBe('true');

        await user.click(within(group).getByRole('radio', { name: 'Grid view' }));

        expect(props.onViewModeChange).toHaveBeenCalledWith('grid');
    });

    it('draws the variant the host decided, in a grid that fits it', () => {
        const { unmount } = render(<></>);
        unmount();
        renderMembers({ variant: 'grid', viewMode: 'grid' });

        expect(screen.getAllByRole('article').map((card) => card.getAttribute('data-card-variant'))).toEqual([
            'grid',
            'grid',
        ]);
        expect(screen.getByRole('list').className).toContain('auto-fill');
    });

    it('opens a recipe from its card', async () => {
        const user = userEvent.setup();
        const props = renderMembers({ hrefOf: undefined });

        await user.click(screen.getByRole('button', { name: 'Recipe 1' }));

        expect(props.onSelectRecipe).toHaveBeenCalledWith('rec_1');
    });

    it('renders each card’s nutrition from the host’s renderer', () => {
        renderMembers({ renderNutrition: (id) => <span>{`kcal for ${id}`}</span> });

        expect(screen.getByText('kcal for rec_0')).toBeTruthy();
    });
});

describe('CollectionMembers (web) — Load more (W5/C7)', () => {
    it('shows four members, then reveals the rest behind “Load more (n more)”', async () => {
        const user = userEvent.setup();
        renderMembers({ members: members(6) });

        expect(screen.getAllByRole('article')).toHaveLength(4);

        await user.click(screen.getByRole('button', { name: 'Load more (2 more)' }));

        expect(screen.getAllByRole('article')).toHaveLength(6);
        expect(screen.queryByRole('button', { name: /Load more/u })).toBeNull();
    });

    it('offers no Load more for a collection within the window', () => {
        renderMembers({ members: members(4) });

        expect(screen.queryByRole('button', { name: /Load more/u })).toBeNull();
    });
});

describe('CollectionMembers (web) — no members', () => {
    it('says so, with Add recipes as its one primary, and no count or view switch', async () => {
        const user = userEvent.setup();
        const props = renderMembers({ members: [] });

        expect(screen.getByRole('heading', { level: 2, name: 'No recipes here yet' })).toBeTruthy();
        expect(screen.getByText('Add a few recipes to this collection.')).toBeTruthy();
        expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull();
        expect(screen.queryByText(/^\d+ recipes?$/u)).toBeNull();

        await user.click(screen.getByRole('button', { name: 'Add recipes' }));

        expect(props.onAddRecipes).toHaveBeenCalledOnce();
    });
});

describe('CollectionMembers (web) — a removal that failed', () => {
    it('says so in an alert naming the recipe, over the rows that are back', () => {
        renderMembers({ removeFailedTitle: 'Recipe 1' });

        expect(screen.getByRole('alert').textContent).toBe('Couldn’t remove Recipe 1. Try again.');
        expect(screen.getAllByRole('article')).toHaveLength(2);
    });

    it('draws no alert otherwise', () => {
        renderMembers();

        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('CollectionMembers (web) — focus after a removal', () => {
    async function removeFrom(user: ReturnType<typeof userEvent.setup>, title: string): Promise<void> {
        await user.click(screen.getByRole('button', { name: `More actions for ${title}` }));
        await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Remove from collection' }));
    }

    it('moves focus to the NEXT row’s link', async () => {
        const user = userEvent.setup();
        const props = renderMembers({ members: members(3) });

        await removeFrom(user, 'Recipe 1');

        await vi.waitFor(() => expect(props.onRemoveRecipe).toHaveBeenCalledOnce());
        expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Recipe 2' }));
    });

    it('after the last row, falls back to the previous row’s link', async () => {
        const user = userEvent.setup();
        const props = renderMembers({ members: members(3) });

        await removeFrom(user, 'Recipe 2');

        await vi.waitFor(() => expect(props.onRemoveRecipe).toHaveBeenCalledOnce());
        expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Recipe 1' }));
    });

    it('moves focus to the page’s H1 when the removed row was the only one', async () => {
        const user = userEvent.setup();
        const props = renderMembers({ members: members(1) });

        await removeFrom(user, 'Recipe 0');

        await vi.waitFor(() => expect(props.onRemoveRecipe).toHaveBeenCalledOnce());
        expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    });
});
