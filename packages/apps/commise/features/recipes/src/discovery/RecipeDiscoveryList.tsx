/**
 * @module @commise/features-recipes — web public-discovery view (T076 building block, US2).
 *
 * Controlled, presentational discovery list: persistent chrome (heading + search) over a body that renders
 * one of four states — loading, error, empty, populated — derived from `status` + `results`. Every recipe
 * shown is public; each row offers a Clone action that copies it into the viewer's collection. It fetches
 * nothing; the composing app wires the search query + clone mutation to these props.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { formatRecipeCount } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.js';
import { toRecipeDiscoveryItem, type RecipeDiscoveryListProps } from './model.js';

/** The loading placeholder — a busy status region with inert skeleton rows (hidden from assistive tech). */
const LoadingBody: FC<{ label: string }> = ({ label }) => (
    <div role="status" aria-label={label}>
        {[0, 1, 2].map((row) => (
            <span key={row} aria-hidden="true" />
        ))}
    </div>
);

export const RecipeDiscoveryList: FC<RecipeDiscoveryListProps> = ({
    status,
    results,
    searchValue,
    onSearchChange,
    onSelectRecipe,
    onClone,
    onRetry,
    cloningId,
}) => {
    const discovery = useMessages(discoveryMessages);
    const locale = useLocale();

    let body: ReactElement;

    if (status === 'loading') {
        body = <LoadingBody label={discovery.loadingLabel} />;
    } else if (status === 'error') {
        body = (
            <div role="alert">
                <p>{discovery.errorTitle}</p>
                <button type="button" onClick={onRetry}>
                    {discovery.retry}
                </button>
            </div>
        );
    } else if (results.length === 0) {
        body = (
            <div>
                <p>{discovery.emptyTitle}</p>
                <p>{discovery.emptyBody}</p>
            </div>
        );
    } else {
        const count = formatRecipeCount(
            results.length,
            { one: discovery.countOne, other: discovery.countOther },
            locale,
        );
        body = (
            <div className="flex flex-col gap-4">
                <p className="text-body-sm font-medium text-slate">{count}</p>
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {results.map((result) => {
                        const item = toRecipeDiscoveryItem(result);

                        return (
                            <li key={item.id}>
                                <RecipeDiscoveryCard
                                    recipe={item}
                                    isCloning={cloningId === item.id}
                                    onSelect={onSelectRecipe}
                                    onClone={onClone}
                                />
                            </li>
                        );
                    })}
                </ul>
            </div>
        );
    }

    return (
        <section aria-label={discovery.heading} className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
            <header>
                <h1 className="font-display text-display-md font-bold text-charcoal">{discovery.heading}</h1>
            </header>
            <input
                type="search"
                aria-label={discovery.searchLabel}
                placeholder={discovery.searchPlaceholder}
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                className="w-full rounded-full border border-border bg-card px-5 py-3 text-body-md text-charcoal shadow-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-seafoam-light"
            />
            {body}
        </section>
    );
};
