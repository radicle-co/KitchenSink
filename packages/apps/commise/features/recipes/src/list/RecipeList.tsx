/**
 * @module @commise/features-recipes — web recipe-list view (T065 building block).
 *
 * Controlled, presentational recipe list: persistent chrome (heading + search + create) over a body that
 * renders one of four states — loading, error, empty, populated — derived from `status` + `recipes`. It
 * fetches nothing; the composing app wires `useRecipes` (and search) to these props.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { recipeMessages } from '../messages.js';
import { RecipeListCard } from './RecipeListCard.js';
import { formatRecipeCount, type RecipeListViewProps } from './model.js';

/** The loading placeholder — a busy status region with inert skeleton rows (hidden from assistive tech). */
const LoadingBody: FC<{ label: string }> = ({ label }) => (
    <div role="status" aria-label={label}>
        {[0, 1, 2].map((row) => (
            <span key={row} aria-hidden="true" />
        ))}
    </div>
);

export const RecipeList: FC<RecipeListViewProps> = ({
    status,
    recipes,
    searchValue,
    onSearchChange,
    onSelectRecipe,
    onCreateRecipe,
    onRetry,
}) => {
    const { list } = useMessages(recipeMessages);
    const locale = useLocale();

    let body: ReactElement;

    if (status === 'loading') {
        body = <LoadingBody label={list.loadingLabel} />;
    } else if (status === 'error') {
        body = (
            <div role="alert">
                <p>{list.errorTitle}</p>
                <button type="button" onClick={onRetry}>
                    {list.retry}
                </button>
            </div>
        );
    } else if (recipes.length === 0) {
        body = (
            <div>
                <p>{list.emptyTitle}</p>
                <p>{list.emptyBody}</p>
            </div>
        );
    } else {
        const count = formatRecipeCount(recipes.length, { one: list.countOne, other: list.countOther }, locale);
        body = (
            <div>
                <p>{count}</p>
                <ul>
                    {recipes.map((recipe) => (
                        <li key={recipe.id}>
                            <RecipeListCard recipe={recipe} onSelect={onSelectRecipe} />
                        </li>
                    ))}
                </ul>
            </div>
        );
    }

    return (
        <section aria-label={list.heading}>
            <header>
                <h1>{list.heading}</h1>
                <button type="button" onClick={onCreateRecipe}>
                    {list.createCta}
                </button>
            </header>
            <input
                type="search"
                aria-label={list.searchLabel}
                placeholder={list.searchPlaceholder}
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
            />
            {body}
        </section>
    );
};
