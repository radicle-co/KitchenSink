/**
 * @module @commise/features-recipes — web collection-detail view (T072 building block).
 *
 * Presentational render of a loaded {@link CollectionWithRecipes}: the header (name, description, rename +
 * delete actions) and the member recipe rows (each selectable, each with a per-row remove control), with an
 * empty state when the collection has no members. Fetch states belong to the composing app, not here.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { collectionMessages } from './messages.js';
import type { CollectionDetailViewProps } from './model.js';

export const CollectionDetail: FC<CollectionDetailViewProps> = ({
    collection,
    onSelectRecipe,
    onRemoveRecipe,
    onRename,
    onDelete,
}) => {
    const { detail } = useMessages(collectionMessages);
    const recipes = collection.recipes ?? [];

    return (
        <section aria-label={collection.name}>
            <header>
                <h1>{collection.name}</h1>
                {collection.description !== undefined && collection.description.length > 0 && (
                    <p>{collection.description}</p>
                )}
                <button type="button" onClick={onRename}>
                    {detail.renameCta}
                </button>
                <button type="button" onClick={onDelete}>
                    {detail.deleteCta}
                </button>
            </header>

            <section aria-label={detail.membersHeading}>
                <h2>{detail.membersHeading}</h2>
                {recipes.length === 0 ? (
                    <div>
                        <p>{detail.emptyTitle}</p>
                        <p>{detail.emptyBody}</p>
                    </div>
                ) : (
                    <ul>
                        {recipes.map((recipe) => (
                            <li key={recipe.id}>
                                <button type="button" onClick={() => onSelectRecipe(recipe.id)}>
                                    {recipe.title}
                                </button>
                                <button type="button" onClick={() => onRemoveRecipe(recipe.id)}>
                                    {fillTemplate(detail.removeRecipe, { title: recipe.title })}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </section>
    );
};
