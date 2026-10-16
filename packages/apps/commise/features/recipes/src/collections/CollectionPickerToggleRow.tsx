'use client';

/**
 * @module @commise/features-recipes/collections — one add-recipes picker row WITH its toggle: the presentational
 * {@link CollectionPickerRow} wired to `useMemberToggle` (a per-row mutation, serialized per collection/recipe pair, that
 * rewrites the cached membership at once and flips back when the server refuses).
 *
 * Plain `.tsx` with no native twin: it renders only the row pair, which resolves per platform.
 *
 * @pattern Container — binds a presentational row to its mutation
 */
import type { Recipe } from '@kitchensink/recipe-core';
import type { FC } from 'react';

import { useMemberToggle } from '../hooks/useMemberToggle.js';
import { CollectionPickerRow } from './CollectionPickerRow.js';

/** Props for {@link CollectionPickerToggleRow}. */
export interface CollectionPickerToggleRowProps {
    readonly collectionId: string;
    readonly recipe: Recipe;
    /** Whether the recipe is a member now, read off the collection (which the toggle rewrites). */
    readonly checked: boolean;
}

export const CollectionPickerToggleRow: FC<CollectionPickerToggleRowProps> = ({ collectionId, recipe, checked }) => {
    const toggle = useMemberToggle(collectionId, recipe);

    return (
        <CollectionPickerRow
            recipe={recipe}
            checked={checked}
            {...(toggle.failed ? { failed: toggle.failedMember ? ('add' as const) : ('remove' as const) } : {})}
            onToggle={toggle.press}
        />
    );
};
