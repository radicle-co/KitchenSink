'use client';

/**
 * @module @commise/features-recipes — the web Collections list RESULTS (`docs/design/uiOverhaul/buildSpec.md` §5.1):
 * what renders inside the list's suspense boundary once the read has settled.
 *
 * The search from six collections and the count, the refresh notice, then the first run — whose action depends on
 * whether the cook has recipes to group yet — a no-match for the search, or the album cards in a two-column grid that
 * becomes `auto-fill` from a 600 container, then the server-paged "Load more". Pure: the container reads and narrows.
 *
 * ⚠️ The card draws no photo mosaic and no recipe count yet: the list read carries neither (`recipeCount` is absent on
 * list reads, and no member photos are embedded), so the card is the collection's tint and monogram with its name,
 * visibility and copy credit. A recipe-service contract change is owed for the rest.
 */
import { LoadMoreControl } from '@commise/ui/load-more';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { RecipeCover } from '@commise/ui/recipe-cover';
import { SearchField } from '@commise/ui/search-field';
import type { CollectionResponse } from '@kitchensink/schema-recipe';
import { useId, type FC, type MouseEvent } from 'react';

import { fillTemplate, formatRecipeCount } from '../list/model.js';
import { collectionMessages } from './messages.js';
import { COLLECTION_SEARCH_FROM, type CollectionListResultsProps } from './model.js';

/** Two columns on a phone, `auto-fill` of at least 15 rem from a 600 container. */
const GRID_CLASS =
    'grid grid-cols-2 gap-4 @regular/main:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] @regular/main:gap-6';

/**
 * Whether a click should be handed to `onSelect`: a plain primary click only, so a modified click opens a new tab.
 *
 * @param event - The click.
 * @returns `true` for a plain primary click.
 */
function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** One album card: the cover, the name (two lines), the visibility as glyph and word, and a copy's credit. */
const CollectionCard: FC<{
    readonly collection: CollectionResponse;
    readonly href: string | undefined;
    readonly onSelect: (id: string) => void;
}> = ({ collection, href, onSelect }) => {
    const { list } = useMessages(collectionMessages);
    const visibility = collection.visibility === 'public' ? list.visibilityPublic : list.visibilityPrivate;
    const stretch = 'after:absolute after:inset-0 after:content-[""] focus-visible:outline-none';

    return (
        <article
            aria-label={fillTemplate(list.cardLabel, { name: collection.name, visibility })}
            className="relative flex h-full flex-col rounded-md border border-line-divider bg-paper shadow-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-canvas pointer-fine:hover:shadow-md active:scale-[0.98] motion-reduce:active:scale-100"
        >
            <div className="overflow-hidden rounded-t-md">
                <RecipeCover recipeId={collection.id} title={collection.name} aspect="1:1" />
            </div>
            <div className="flex flex-col gap-1 p-3">
                <h3 className="line-clamp-2 text-card-title text-ink">
                    {href === undefined ? (
                        <button
                            type="button"
                            className={`text-start ${stretch}`}
                            onClick={() => onSelect(collection.id)}
                        >
                            {collection.name}
                        </button>
                    ) : (
                        <a
                            href={href}
                            className={stretch}
                            onClick={(event) => {
                                if (isPlainClick(event)) {
                                    event.preventDefault();
                                    onSelect(collection.id);
                                }
                            }}
                        >
                            {collection.name}
                        </a>
                    )}
                </h3>
                <p className="inline-flex items-center gap-1 text-meta text-ink-muted">
                    <Icon name={collection.visibility === 'public' ? 'globe' : 'lock'} size={16} />
                    {visibility}
                </p>
                {collection.sourceOwnerHandle === undefined ? null : (
                    <p className="truncate text-caption text-ink-muted">
                        {fillTemplate(list.copiedFrom, { handle: collection.sourceOwnerHandle })}
                    </p>
                )}
            </div>
        </article>
    );
};

export const CollectionListResults: FC<CollectionListResultsProps> = ({
    collections,
    total,
    onSelect,
    hrefOf,
    search,
    firstRun,
    loadMore,
    refreshNotice,
}) => {
    const { list } = useMessages(collectionMessages);
    const locale = useLocale();
    const searchId = useId();
    const countId = useId();

    if (total === 0) {
        return (
            <section className="mx-auto flex w-full max-w-[28rem] flex-col items-center gap-3 py-8 text-center">
                <h2 className="text-section-title text-ink">{list.emptyTitle}</h2>
                <p className="text-body text-ink-muted">{list.emptyBody}</p>
                {firstRun.hasRecipes ? (
                    <Button icon="plus" size="lg" onPress={firstRun.onCreate}>
                        {list.createCta}
                    </Button>
                ) : (
                    <>
                        <p className="text-body text-ink-muted">{list.needRecipes}</p>
                        <Button icon="pencilLine" size="lg" onPress={firstRun.onAddRecipe}>
                            {list.addRecipe}
                        </Button>
                    </>
                )}
            </section>
        );
    }

    return (
        <>
            {total >= COLLECTION_SEARCH_FROM && (
                <SearchField
                    id={searchId}
                    label={list.searchLabel}
                    labelVisibility="hidden"
                    clearLabel={list.clearSearch}
                    placeholder={list.searchLabel}
                    value={search.value}
                    onChangeText={search.onChange}
                />
            )}
            <p id={countId} className="text-meta font-semibold text-ink tabular-nums lining-nums">
                {formatRecipeCount(total, { one: list.countOne, other: list.countOther }, locale)}
            </p>
            {refreshNotice !== undefined && (
                <RefreshNotice
                    failed={refreshNotice.failed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: list.refreshError, retry: list.retry }}
                />
            )}
            {collections.length === 0 ? (
                <p role="status" className="text-body text-ink-muted">
                    {fillTemplate(list.noMatch, { query: search.value.trim() })}
                </p>
            ) : (
                <ul aria-labelledby={countId} className={GRID_CLASS}>
                    {collections.map((collection) => (
                        <li key={collection.id}>
                            <CollectionCard
                                collection={collection}
                                href={hrefOf?.(collection.id)}
                                onSelect={onSelect}
                            />
                        </li>
                    ))}
                </ul>
            )}
            {/* W5/C7 — server-paged "Load more" (no infinite scroll); vanishes once the last page loads. */}
            {loadMore === undefined ? null : (
                <LoadMoreControl
                    {...loadMore}
                    labels={{
                        loadMore: list.loadMore,
                        loadingMore: list.loadingMore,
                        retry: list.retry,
                        failed: list.loadMoreError,
                    }}
                />
            )}
        </>
    );
};
