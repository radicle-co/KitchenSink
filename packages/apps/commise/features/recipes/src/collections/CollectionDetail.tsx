'use client';

/**
 * @module @commise/features-recipes — web collection-detail view (T072 building block).
 *
 * Presentational render of a loaded `CollectionWithRecipes`'s MEMBER LIST: the "Recipes" section with
 * its add-a-recipe control and the member recipe rows — each a {@link CollectionMemberRow} (W5 Task 9, C3),
 * which composes the shared `RecipeCard` with its source-indicator and remove control — plus an empty state
 * when the collection has no members and the B17 delete/remove error banner. Fetch states belong to the
 * composing app, not here.
 *
 * The collection HEADER (name, description, visibility badge, count, source attribution, last-pulled, and the
 * rename/delete/back affordances) is owned by the sibling `CollectionHeader`
 * (W5 Task 6), composed above this block by the container (W5 Task 12) — this view holds no header of its own,
 * so the surface renders exactly ONE header.
 *
 * Member-list windowing (W5/C7): the detail embed returns EVERY member in one round trip (no
 * member-pagination endpoint — out of scope), so this view reveals them client-side in
 * {@link MEMBER_WINDOW_SIZE}-row windows behind a `[Load more (K more)]` control, tracked as local
 * `useState` reveal-count VIEW state (not server data) — the reveal count is otherwise a pure function of
 * `collection.recipes.length`. If a caller reuses this component across DIFFERENT collections without
 * remounting it, key it by `collection.id` so the reveal count resets for the new collection's member list.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useState, type FC } from 'react';

import { CollectionMemberRow } from './CollectionMemberRow.js';
import { collectionMessages } from './messages.js';
import { MEMBER_WINDOW_SIZE, type CollectionDetailViewProps } from './model.js';
import { fillTemplate } from '../list/model.js';

export const CollectionDetail: FC<CollectionDetailViewProps> = ({
    collection,
    onSelectRecipe,
    onRemoveRecipe,
    onAddRecipe,
    error,
    renderNutrition,
}) => {
    const { detail } = useMessages(collectionMessages);
    const [revealCount, setRevealCount] = useState(MEMBER_WINDOW_SIZE);
    // `recipes` is REQUIRED on the published `CollectionWithRecipesResponse` — `getCollectionById` sets it
    // unconditionally, and the contract notes an absent key "would have meant something the server cannot say".
    // The `?? []` this replaces was the local twin's optionality leaking into a reader.
    const recipes = collection.recipes;
    const visibleRecipes = recipes.slice(0, revealCount);
    const remainingCount = recipes.length - visibleRecipes.length;
    // B17 — a failed delete/remove is a mandated UI state, never a frozen no-op. Resolve the container's error
    // code to localized copy here so the block stays self-contained on its own copy.
    const errorMessage = error === undefined ? undefined : error === 'delete' ? detail.deleteError : detail.removeError;

    return (
        <section aria-label={detail.membersHeading} className="flex flex-col gap-3">
            {errorMessage !== undefined && (
                <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-body-sm text-danger-text">
                    {errorMessage}
                </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <h2 className="font-display text-heading-lg font-semibold text-ink">{detail.membersHeading}</h2>
                <Button icon="plus" onPress={onAddRecipe}>
                    {detail.addRecipeCta}
                </Button>
            </div>
            {recipes.length === 0 ? (
                <div className="rounded-2xl bg-paper p-6 text-body-md text-ink-muted shadow-sm">
                    <p className="font-medium text-ink">{detail.emptyTitle}</p>
                    <p>{detail.emptyBody}</p>
                </div>
            ) : (
                <>
                    <ul className="flex flex-col gap-3">
                        {visibleRecipes.map((recipe) => (
                            <li key={recipe.id}>
                                <CollectionMemberRow
                                    member={recipe}
                                    onSelect={onSelectRecipe}
                                    onRemove={onRemoveRecipe}
                                    nutrition={renderNutrition?.(recipe.id)}
                                />
                            </li>
                        ))}
                    </ul>
                    {remainingCount > 0 && (
                        // W5/C7 — client-side member-list windowing (no member-pagination endpoint).
                        <div className="self-center">
                            <Button
                                variant="secondary"
                                icon="chevronDown"
                                onPress={() =>
                                    setRevealCount((count) => Math.min(recipes.length, count + MEMBER_WINDOW_SIZE))
                                }
                            >
                                {fillTemplate(detail.loadMore, { count: remainingCount })}
                            </Button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
};
