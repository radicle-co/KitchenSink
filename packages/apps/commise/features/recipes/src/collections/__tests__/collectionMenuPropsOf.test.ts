/**
 * `collectionMenuPropsOf`: the one place a settled collection detail's view-model becomes the ⋯ menu's props, so the
 * native screen can put the menu in the pinned bar while `CollectionDetailBody` keeps the rest. Pure.
 *
 * Mutation lens: read `isCopy` from the wrong field, drop the toggle's absence, or wire a menu entry to another action and
 * a case below fails.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it, vi } from 'vitest';

import { collectionMenuPropsOf, isCollectionCopy } from '../detailModel.js';

function source(over: { readonly collection?: object; readonly onToggleVisibility?: (() => void) | undefined } = {}) {
    const actions = {
        onStart: vi.fn(),
        onSave: vi.fn(),
        start: vi.fn(),
        onDelete: vi.fn(),
        onToggle: vi.fn(),
    };

    return {
        actions,
        detail: {
            collection: { name: 'Weeknight Dinners', visibility: RecipeVisibility.PRIVATE, ...over.collection },
            onToggleVisibility: 'onToggleVisibility' in over ? over.onToggleVisibility : actions.onToggle,
            rename: { onStart: actions.onStart },
            saveCopy: { onSave: actions.onSave },
            pull: { start: actions.start },
            deletion: { onStart: actions.onDelete },
        },
    };
}

describe('isCollectionCopy', () => {
    it('is a copy when it states its source by name or by id, and not otherwise', () => {
        expect(isCollectionCopy({ sourceCollectionName: 'Dinners' })).toBe(true);
        expect(isCollectionCopy({ sourceCollectionId: 'col_src' })).toBe(true);
        expect(isCollectionCopy({})).toBe(false);
    });
});

describe('collectionMenuPropsOf', () => {
    it('names the collection and carries its visibility', () => {
        const { detail } = source({ collection: { visibility: RecipeVisibility.PUBLIC } });

        expect(collectionMenuPropsOf(detail)).toMatchObject({
            name: 'Weeknight Dinners',
            visibility: RecipeVisibility.PUBLIC,
        });
    });

    it('is a copy when the collection states a source, so the menu offers Pull updates', () => {
        expect(collectionMenuPropsOf(source({ collection: { sourceCollectionId: 'col_src' } }).detail).isCopy).toBe(
            true,
        );
        expect(collectionMenuPropsOf(source().detail).isCopy).toBe(false);
    });

    it('wires each entry to its own action', () => {
        const { detail, actions } = source();
        const props = collectionMenuPropsOf(detail);

        props.onRename();
        props.onSaveCopy();
        props.onPullUpdates();
        props.onDelete();
        props.onToggleVisibility?.();

        expect(actions.onStart).toHaveBeenCalledOnce();
        expect(actions.onSave).toHaveBeenCalledOnce();
        expect(actions.start).toHaveBeenCalledOnce();
        expect(actions.onDelete).toHaveBeenCalledOnce();
        expect(actions.onToggle).toHaveBeenCalledOnce();
    });

    it('⛔ leaves the toggle out, not undefined, when the host offers no visibility item (D14)', () => {
        const props = collectionMenuPropsOf(source({ onToggleVisibility: undefined }).detail);

        expect('onToggleVisibility' in props).toBe(false);
    });
});
