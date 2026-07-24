/**
 * @module @commise/features-recipes — web collection-detail view (T072 building block).
 *
 * Presentational render of a loaded {@link CollectionWithRecipes}: the header (name, description, rename +
 * delete actions) and the member recipe rows — each a {@link CollectionMemberRow} (W5 Task 9, C3), which
 * composes the shared `RecipeCard` with its source-indicator and remove control — with an empty state when
 * the collection has no members. Fetch states belong to the composing app, not here.
 *
 * Member-list windowing (W5/C7): the detail embed returns EVERY member in one round trip (no
 * member-pagination endpoint — out of scope), so this view reveals them client-side in
 * {@link MEMBER_WINDOW_SIZE}-row windows behind a `[Load more (K more)]` control, tracked as local
 * `useState` reveal-count VIEW state (not server data) — the reveal count is otherwise a pure function of
 * `collection.recipes.length`. If a caller reuses this component across DIFFERENT collections without
 * remounting it, key it by `collection.id` so the reveal count resets for the new collection's member list.
 */
import { useMessages } from '@commise/i18n/react';
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
    onRename,
    onDelete,
    error,
}) => {
    const { detail } = useMessages(collectionMessages);
    const [revealCount, setRevealCount] = useState(MEMBER_WINDOW_SIZE);
    const recipes = collection.recipes ?? [];
    const visibleRecipes = recipes.slice(0, revealCount);
    const remainingCount = recipes.length - visibleRecipes.length;
    // B17 — a failed delete/remove is a mandated UI state, never a frozen no-op. Resolve the container's error
    // code to localized copy here so the block stays self-contained on its own copy.
    const errorMessage = error === undefined ? undefined : error === 'delete' ? detail.deleteError : detail.removeError;

    return (
        <section aria-label={collection.name} className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
            <header className="flex flex-col gap-3">
                <h1 className="font-display text-display-md font-bold text-charcoal">{collection.name}</h1>
                {collection.description !== undefined && collection.description.length > 0 && (
                    <p className="text-body-lg text-slate">{collection.description}</p>
                )}
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={onRename}
                        className="rounded-full px-4 py-2 text-body-sm font-medium text-seafoam transition hover:bg-seafoam/10"
                    >
                        {detail.renameCta}
                    </button>
                    <button
                        type="button"
                        onClick={onDelete}
                        className="rounded-full px-4 py-2 text-body-sm font-medium text-error transition hover:bg-coral/10"
                    >
                        {detail.deleteCta}
                    </button>
                </div>
                {errorMessage !== undefined && (
                    <p role="alert" className="rounded-2xl bg-error/10 px-4 py-3 text-body-sm text-error">
                        {errorMessage}
                    </p>
                )}
            </header>

            <section aria-label={detail.membersHeading} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                    <h2 className="font-display text-heading-lg font-semibold text-charcoal">
                        {detail.membersHeading}
                    </h2>
                    <button
                        type="button"
                        onClick={onAddRecipe}
                        className="rounded-full bg-seafoam px-5 py-2.5 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark"
                    >
                        {detail.addRecipeCta}
                    </button>
                </div>
                {recipes.length === 0 ? (
                    <div className="rounded-2xl bg-card p-6 text-body-md text-slate shadow-sm">
                        <p className="font-medium text-charcoal">{detail.emptyTitle}</p>
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
                                    />
                                </li>
                            ))}
                        </ul>
                        {remainingCount > 0 && (
                            // W5/C7 — client-side member-list windowing (no member-pagination endpoint).
                            <button
                                type="button"
                                onClick={() =>
                                    setRevealCount((count) => Math.min(recipes.length, count + MEMBER_WINDOW_SIZE))
                                }
                                className="self-center rounded-full bg-pearl px-6 py-2.5 text-body-sm font-semibold text-charcoal transition hover:bg-mist/40"
                            >
                                {fillTemplate(detail.loadMore, { count: remainingCount })}
                            </button>
                        )}
                    </>
                )}
            </section>
        </section>
    );
};
