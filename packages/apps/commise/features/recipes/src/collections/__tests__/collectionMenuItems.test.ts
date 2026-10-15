/**
 * The collection ⋯ menu's entries, built ONCE for the web and native headers (plan 2026-10-14-009 D14): Rename ·
 * Make private / Make public · Save a copy · Pull updates (a copy only). The visibility entry is left out when the host
 * gives no toggle — Private is not offered — and its glyph names the visibility it MOVES TO.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it, vi } from 'vitest';

import { collectionMenuItems } from '../detailModel.js';
import { collectionMessages } from '../messages.js';

const copy = collectionMessages.en.menu;
const actions = { onRename: vi.fn(), onSaveCopy: vi.fn(), onPullUpdates: vi.fn(), onDelete: vi.fn() };

const ids = (items: readonly { readonly id: string }[]): readonly string[] => items.map((item) => item.id);

describe('collectionMenuItems', () => {
    it('offers Make private, with the lock, for a public collection the host can toggle', () => {
        const items = collectionMenuItems({
            copy,
            visibility: RecipeVisibility.PUBLIC,
            isCopy: false,
            actions: { ...actions, onToggleVisibility: vi.fn() },
        });

        expect(ids(items)).toStrictEqual(['rename', 'visibility', 'saveCopy']);
        expect(items[1]).toMatchObject({ label: copy.makePrivate, icon: 'lock' });
    });

    it('offers Make public, with the globe, for a private one', () => {
        const items = collectionMenuItems({
            copy,
            visibility: RecipeVisibility.PRIVATE,
            isCopy: false,
            actions: { ...actions, onToggleVisibility: vi.fn() },
        });

        expect(items[1]).toMatchObject({ label: copy.makePublic, icon: 'globe' });
    });

    it('⛔ leaves the visibility entry out when the host gives no toggle', () => {
        expect(
            ids(collectionMenuItems({ copy, visibility: RecipeVisibility.PUBLIC, isCopy: false, actions })),
        ).toStrictEqual(['rename', 'saveCopy']);
    });

    it('adds Pull updates last, for a copy only', () => {
        expect(
            ids(collectionMenuItems({ copy, visibility: RecipeVisibility.PUBLIC, isCopy: true, actions })),
        ).toStrictEqual(['rename', 'saveCopy', 'pull']);
    });
});
