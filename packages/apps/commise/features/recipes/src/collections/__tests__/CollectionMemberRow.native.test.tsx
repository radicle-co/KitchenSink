/**
 * The native collection member (`docs/design/uiOverhaul/buildSpec.md` §5.2): the shared `RecipeCard`, as a list row or a grid
 * card, with its source label ("Added by you" or "From the original collection") on the row's last line and a trailing ⋯
 * menu — Open recipe, Remove from collection. The card is one link; the menu sits beside it, never inside, so one press
 * cannot do both. Removing here only ASKS: the screen hides the row and offers Undo (`useMemberRemoval`).
 *
 * ⚠️ REWRITTEN for slice 5. The row used to be a bespoke arrangement with a text "Remove" button beside the title; the
 * remove control is now a menu item, the card is the shared one, and the source label moved to the last line.
 */
import { RecipeCollectionAddedVia } from '@kitchensink/recipe-core';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { makeCollectionMemberRecipe } from '../../__fixtures__/index.js';
import { CollectionMemberRow } from '../CollectionMemberRow.native.js';
import type { CollectionMemberRowProps } from '../detailModel.js';

afterEach(cleanup);

function renderRow(over: Partial<CollectionMemberRowProps> = {}) {
    const props: CollectionMemberRowProps = {
        member: makeCollectionMemberRecipe({ id: 'rec_1', title: 'Pasta' }),
        variant: 'row',
        onSelect: vi.fn(),
        onRemove: vi.fn(),
        ...over,
    };

    render(
        <LocaleProvider locale="en">
            <CollectionMemberRow {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe.each(['row', 'grid', 'compact'] as const)('CollectionMemberRow (native, %s)', (variant) => {
    it('draws the shared card in that variant, one link named by the title', () => {
        renderRow({ variant });

        expect(screen.getByRole('link', { name: 'Pasta' })).toBeTruthy();
    });

    it('says where the recipe came from: added by the cook, or from the original collection', () => {
        const { unmount } = render(
            <LocaleProvider locale="en">
                <CollectionMemberRow
                    member={makeCollectionMemberRecipe({ addedVia: RecipeCollectionAddedVia.MANUAL })}
                    variant={variant}
                    onSelect={vi.fn()}
                    onRemove={vi.fn()}
                />
            </LocaleProvider>,
        );

        expect(screen.getByText('Added by you')).toBeTruthy();
        unmount();

        for (const addedVia of [RecipeCollectionAddedVia.CLONE_SEED, RecipeCollectionAddedVia.PULL]) {
            const view = render(
                <LocaleProvider locale="en">
                    <CollectionMemberRow
                        member={makeCollectionMemberRecipe({ addedVia })}
                        variant={variant}
                        onSelect={vi.fn()}
                        onRemove={vi.fn()}
                    />
                </LocaleProvider>,
            );

            expect(screen.getByText('From the original collection')).toBeTruthy();
            view.unmount();
        }
    });

    it('offers a ⋯ menu named for the recipe, beside the link and not inside it', () => {
        renderRow({ variant });
        const menu = screen.getByRole('button', { name: 'More actions for Pasta' });

        expect(screen.getByRole('link', { name: 'Pasta' }).contains(menu)).toBe(false);
    });

    it('opens the menu with Open recipe and Remove from collection, and each reports what it asks for', () => {
        const props = renderRow({ variant });

        fireEvent.click(screen.getByRole('button', { name: 'More actions for Pasta' }));
        const items = screen.getAllByRole('menuitem');

        expect(items.map((item) => item.textContent)).toEqual(['Open recipe', 'Remove from collection']);

        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from collection' }));

        expect(props.onRemove).toHaveBeenCalledExactlyOnceWith({ id: 'rec_1', title: 'Pasta' });
        expect(props.onSelect).not.toHaveBeenCalled();
    });

    it('Open recipe selects it', () => {
        const props = renderRow({ variant });

        fireEvent.click(screen.getByRole('button', { name: 'More actions for Pasta' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Open recipe' }));

        expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('rec_1');
        expect(props.onRemove).not.toHaveBeenCalled();
    });

    it('opening the card from its title reports the selection and not a removal', () => {
        const props = renderRow({ variant });

        fireEvent.click(screen.getByRole('link', { name: 'Pasta' }));

        expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('rec_1');
        expect(props.onRemove).not.toHaveBeenCalled();
    });

    it('renders the host’s nutrition figure in the card’s meta', () => {
        renderRow({ variant, nutrition: <span>612 cal</span> });

        if (variant !== 'compact') {
            expect(screen.getByText('612 cal')).toBeTruthy();
        }
    });
});
