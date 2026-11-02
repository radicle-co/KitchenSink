/**
 * The native member list of a collection (`docs/design/uiOverhaul/buildSpec.md` §5.2): "6 recipes" and the list/grid switch it
 * shares with My recipes, the members as cards in the variant the host decided, "Load more ({n} more)" past the reveal
 * window, the empty state "No recipes here yet" with Add recipes, and an alert when a removal that had been committed
 * failed. Removing a row moves focus to the next row's link, or to the page's H1 after the last.
 *
 * ⚠️ REWRITTEN for slice 5, replacing `CollectionDetail.test.tsx`. The list used to carry its own "Add a recipe" button
 * and a delete/remove error banner (the page's header and the removal hook own those now); it had no view switch, no count,
 * and focus fell to the page when a row was removed. The windowing and the empty copy are kept.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { makeCollectionMemberRecipe } from '../../__fixtures__/index.js';
import { CollectionMembers } from '../CollectionMembers.native.js';
import type { CollectionMembersProps } from '../detailModel.js';
import { render } from '@commise/ui/testing/tamagui';

/** The window's width and text scale, when a test sets them: jsdom has a 1024 px window and a scale of 1. */
const dims = vi.hoisted(() => ({ width: undefined as number | undefined, fontScale: undefined as number | undefined }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => {
            const real = actual.useWindowDimensions();

            return { ...real, width: dims.width ?? real.width, fontScale: dims.fontScale ?? real.fontScale };
        },
    };
});

afterEach(() => {
    cleanup();
    dims.width = undefined;
    dims.fontScale = undefined;
});

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
        ...over,
    };

    render(
        <LocaleProvider locale="en">
            <CollectionMembers {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('CollectionMembers (native) — the list', () => {
    it('says how many recipes there are, and draws each as a card link', () => {
        renderMembers({ members: members(2) });

        expect(screen.getByText('2 recipes')).toBeTruthy();
        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByRole('link', { name: 'Recipe 1' })).toBeTruthy();
    });

    it('says “1 recipe” for one', () => {
        renderMembers({ members: members(1) });

        expect(screen.getByText('1 recipe')).toBeTruthy();
    });

    it('offers the same list/grid switch as My recipes, and reports a choice', () => {
        const props = renderMembers();
        const group = screen.getByRole('radiogroup', { name: 'View' });

        expect(within(group).getByRole('radio', { name: 'List view' }).getAttribute('aria-checked')).toBe('true');

        fireEvent.click(within(group).getByRole('radio', { name: 'Grid view' }));

        expect(props.onViewModeChange).toHaveBeenCalledWith('grid');
    });

    it('draws the variant the host decided, in a grid that fits it', () => {
        renderMembers({ variant: 'grid', viewMode: 'grid' });

        expect(screen.getAllByRole('link')).toHaveLength(2);
    });

    it('opens a recipe from its card', () => {
        const props = renderMembers();

        fireEvent.click(screen.getByRole('link', { name: 'Recipe 1' }));

        expect(props.onSelectRecipe).toHaveBeenCalledWith('rec_1');
    });

    it('renders each card’s nutrition from the host’s renderer', () => {
        renderMembers({ variant: 'grid', renderNutrition: (id) => <span>{`kcal for ${id}`}</span> });

        expect(screen.getByText('kcal for rec_0')).toBeTruthy();
    });
});

describe('CollectionMembers (native) — Load more (W5/C7)', () => {
    it('shows four members, then reveals the rest behind “Load more (n more)”', () => {
        renderMembers({ members: members(6) });

        expect(screen.getAllByRole('link')).toHaveLength(4);

        fireEvent.click(screen.getByRole('button', { name: 'Load more (2 more)' }));

        expect(screen.getAllByRole('link')).toHaveLength(6);
        expect(screen.queryByRole('button', { name: /Load more/u })).toBeNull();
    });

    it('offers no Load more for a collection within the window', () => {
        renderMembers({ members: members(4) });

        expect(screen.queryByRole('button', { name: /Load more/u })).toBeNull();
    });
});

describe('CollectionMembers (native) — no members', () => {
    it('says so, with Add recipes as its one primary, and no count or view switch', () => {
        const props = renderMembers({ members: [] });

        expect(screen.getByRole('heading', { level: 2, name: 'No recipes here yet' })).toBeTruthy();
        expect(screen.getByText('Add a few recipes to this collection.')).toBeTruthy();
        expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull();
        expect(screen.queryByText(/^\d+ recipes?$/u)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Add recipes' }));

        expect(props.onAddRecipes).toHaveBeenCalledOnce();
    });
});

describe('CollectionMembers (native) — a removal that failed', () => {
    it('says so in an alert naming the recipe, over the rows that are back', () => {
        renderMembers({ removeFailedTitle: 'Recipe 1' });

        expect(screen.getByRole('alert').textContent).toBe('Couldn’t remove Recipe 1. Try again.');
        expect(screen.getAllByRole('link')).toHaveLength(2);
    });

    it('draws no alert otherwise', () => {
        renderMembers();

        expect(screen.queryByRole('alert')).toBeNull();
    });
});

// Designer ruling (2026-11-02): below 600 the collection detail grid is the compact tile, two to a row (CollectionDetailIphone390),
// but a collection tile DROPS the "Edited" line: only Recipes tiles keep it, because only a Recipes sort may not be by recency.
describe('CollectionMembers (native) — a narrow collection tile carries no Edited line', () => {
    it('draws compact tiles with their title and no Edited or Created footer', () => {
        renderMembers({
            variant: 'compact',
            viewMode: 'grid',
            members: [
                makeCollectionMemberRecipe({
                    id: 'rec_e',
                    title: 'Herb Risotto',
                    createdAt: '2020-01-01T00:00:00.000Z',
                    updatedAt: '2020-01-02T00:00:00.000Z',
                }),
            ],
        });

        expect(screen.getByRole('link', { name: 'Herb Risotto' })).toBeTruthy();
        expect(screen.queryByText(/Edited |Created /u)).toBeNull();
    });
});

// Designer rule (2026-11-02): the compact tile is two columns while the container width over the CAPPED text scale is at least
// 320 pt, and one below. A collection's detail grid picks its columns by the same function as the Recipes list.
describe('CollectionMembers (native) — the compact grid’s columns follow the capped text scale', () => {
    const cellWidth = (): string => {
        const link = screen.getByRole('link', { name: 'Recipe 0' });
        let width = '';

        for (let node = link.parentElement; node !== null && width === ''; node = node.parentElement) {
            if (node.style.width.endsWith('%')) {
                width = node.style.width;
            }
        }

        return width;
    };

    it('is two columns at 1x on a phone', () => {
        dims.width = 390;
        dims.fontScale = 1;
        renderMembers({ variant: 'compact', viewMode: 'grid' });

        expect(cellWidth()).toBe('50%');
    });

    it('is one column at 2x on the same phone', () => {
        dims.width = 390;
        dims.fontScale = 2;
        renderMembers({ variant: 'compact', viewMode: 'grid' });

        expect(cellWidth()).toBe('100%');
    });
});
