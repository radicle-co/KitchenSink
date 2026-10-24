/**
 * The collection ⋯ menu (web): the same component the native pinned bar draws (`CollectionMoreMenu` is one `.tsx` over the
 * platform-split `ActionMenu`), and the one the web header draws, so the entries are built once. The native cases are in
 * `CollectionMoreMenu.native.test.tsx`; this proves the web leaf names the trigger for the collection and lists the entries.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { CollectionMoreMenu } from '../CollectionMoreMenu.js';

afterEach(cleanup);

describe('CollectionMoreMenu (web)', () => {
    it('is one ⋯ named for the collection, listing Rename, Make public and Save a copy, then Delete', async () => {
        const user = userEvent.setup();
        const onDelete = vi.fn();
        render(
            <LocaleProvider locale="en">
                <CollectionMoreMenu
                    name="Weeknight Dinners"
                    visibility={RecipeVisibility.PRIVATE}
                    isCopy={false}
                    onRename={vi.fn()}
                    onToggleVisibility={vi.fn()}
                    onSaveCopy={vi.fn()}
                    onPullUpdates={vi.fn()}
                    onDelete={onDelete}
                />
            </LocaleProvider>,
        );

        expect(screen.getAllByRole('button', { name: 'More actions for Weeknight Dinners' })).toHaveLength(1);
        await user.click(screen.getByRole('button', { name: 'More actions for Weeknight Dinners' }));

        expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
            'Rename',
            'Make public',
            'Save a copy',
            'Delete collection',
        ]);

        await user.click(screen.getByRole('menuitem', { name: 'Delete collection' }));

        expect(onDelete).toHaveBeenCalledOnce();
    });
});
