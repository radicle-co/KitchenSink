/**
 * @module @commise/features-recipes — web curated browse-rails block (U7, net-new).
 *
 * The default discovery surface when no query/filter is active: three fixed-sort rails
 * (Trending/New/Quick) each rendered as a horizontal-scroll strip of {@link RecipeDiscoveryCard}s with a
 * "see all", plus a row of cuisine shortcuts. Controlled + presentational — it fetches nothing; the
 * composing container runs one search per rail and projects them (and the facet-derived cuisines) onto
 * these props. Same contract as the native leaf so the two cannot drift.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { toRecipeCardModel } from '../card/model.js';
import { fillTemplate } from '../list/model.js';
import { discoveryMessages, type DiscoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.js';
import type { RecipeBrowseRailId, RecipeBrowseRailsProps, RecipeBrowseRailView } from './model.js';

/** Visible title for each rail (S). */
const railTitle = (id: RecipeBrowseRailId, m: DiscoveryMessages): string => {
    switch (id) {
        case 'trending':
            return m.railTrending;
        case 'new':
            return m.railNew;
        case 'quick':
            return m.railQuick;
    }
};

/** One curated rail: header (title + see-all) over its own loading/error/empty/populated body. */
const Rail: FC<{
    readonly rail: RecipeBrowseRailView;
    readonly cloningId?: string | null;
    readonly onSelectRecipe: (id: string) => void;
    readonly onClone: (id: string) => void;
}> = ({ rail, cloningId, onSelectRecipe, onClone }) => {
    const discovery = useMessages(discoveryMessages);
    const title = railTitle(rail.id, discovery);

    let body: ReactElement;

    if (rail.status === 'loading') {
        body = (
            <div role="status" aria-label={discovery.loadingLabel} className="flex gap-4">
                {[0, 1, 2].map((card) => (
                    <span
                        key={card}
                        aria-hidden="true"
                        className="h-56 w-64 shrink-0 animate-pulse rounded-xl bg-mist/20 motion-reduce:animate-none"
                    />
                ))}
            </div>
        );
    } else if (rail.status === 'error') {
        body = <p className="text-body-sm text-slate">{discovery.railError}</p>;
    } else if (rail.results.length === 0) {
        body = <p className="text-body-sm text-slate">{discovery.railEmpty}</p>;
    } else {
        body = (
            <ul className="flex snap-x gap-4 overflow-x-auto pb-2" role="list">
                {rail.results.map((entry) => (
                    <li key={entry.recipe.id} className="w-64 shrink-0 snap-start">
                        <RecipeDiscoveryCard
                            recipe={toRecipeCardModel(entry.recipe)}
                            authorHandle={entry.recipe.authorHandle}
                            sourceAttribution={entry.recipe.sourceAttribution}
                            isCloning={cloningId === entry.recipe.id}
                            onSelect={onSelectRecipe}
                            onClone={onClone}
                        />
                    </li>
                ))}
            </ul>
        );
    }

    return (
        <section className="flex flex-col gap-3">
            <header className="flex items-center justify-between">
                <h2 className="font-display text-heading-md font-semibold text-charcoal">{title}</h2>
                <button
                    type="button"
                    aria-label={fillTemplate(discovery.seeAllLabel, { rail: title })}
                    onClick={rail.onSeeAll}
                    className="rounded-full px-3 py-1 text-body-sm font-semibold text-seafoam transition hover:bg-mist/20"
                >
                    {discovery.seeAll}
                </button>
            </header>
            {body}
        </section>
    );
};

/**
 * The curated browse rails + cuisine shortcuts (web).
 *
 * @param props - The projected rails, the cuisine shortcuts, and the selection/clone callbacks.
 */
export const RecipeBrowseRails: FC<RecipeBrowseRailsProps> = ({
    rails,
    cuisines,
    cloningId,
    onSelectRecipe,
    onClone,
}) => {
    const discovery = useMessages(discoveryMessages);

    return (
        <div aria-label={discovery.browseLabel} className="flex flex-col gap-8">
            {rails.map((rail) => (
                <Rail
                    key={rail.id}
                    rail={rail}
                    cloningId={cloningId}
                    onSelectRecipe={onSelectRecipe}
                    onClone={onClone}
                />
            ))}
            {cuisines.length > 0 && (
                <section className="flex flex-col gap-3">
                    <h2 className="font-display text-heading-md font-semibold text-charcoal">
                        {discovery.cuisinesTitle}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {cuisines.map((cuisine) => (
                            <button
                                key={cuisine.value}
                                type="button"
                                aria-label={fillTemplate(discovery.cuisineShortcutLabel, { cuisine: cuisine.value })}
                                onClick={cuisine.onSelect}
                                className="rounded-full bg-pearl px-4 py-2 text-body-sm font-medium text-charcoal transition hover:bg-mist/40"
                            >
                                {cuisine.value}
                            </button>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
};
