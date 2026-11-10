'use client';

/**
 * @module @commise/features-recipes/foodPage — `YourFoodsList` (web): the cook's own foods, each row a name with its status
 * badges (the ones the food page shows, from `badgesOf`) and a link to the food page. A plain list in the Collections
 * list's rows style. Loading, empty and failed are states of it, not other screens.
 *
 * Presentational: `props → JSX`.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { LoadingNotice } from '@commise/ui/loading-notice';
import { StateNotice } from '@commise/ui/state-notice';
import { StatusBadge } from '@commise/ui/status-badge';
import { surfaceToneClass } from '@commise/ui/surface-tone';
import type { FC } from 'react';

import { badgesOf } from './foodPageCopy.js';
import { foodPageMessages } from './messages.js';
import type { YourFoodsListProps } from './yourFoodsViewProps.js';

/** The list. */
export const YourFoodsList: FC<YourFoodsListProps> = ({
    phase,
    items,
    hasMore,
    loadingMore,
    onOpen,
    hrefOf,
    onRetry,
    onLoadMore,
}) => {
    const m = useMessages(foodPageMessages);

    if (phase === 'loading') {
        return <LoadingNotice label={m.loading} />;
    }

    if (phase === 'error') {
        return (
            <StateNotice
                title={m.yourFoods.error}
                primary={{ label: m.error.retry, icon: 'rotateCcw', onPress: onRetry }}
            />
        );
    }

    if (items.length === 0) {
        return <p className="text-body text-ink-muted">{m.yourFoods.empty}</p>;
    }

    return (
        <div className="flex flex-col gap-4">
            <ul
                className={`flex flex-col divide-y divide-line-divider overflow-hidden rounded-xl ${surfaceToneClass('paper')}`}
                role="list"
            >
                {items.map((item) => (
                    <li key={item.id}>
                        <a
                            href={hrefOf?.(item.id)}
                            className="flex min-h-14 flex-col gap-1 px-4 py-3 text-ink"
                            onClick={(event) => {
                                event.preventDefault();
                                onOpen(item.id);
                            }}
                        >
                            <span className="text-body">{item.name}</span>
                            <span className="flex flex-wrap gap-2">
                                {badgesOf(item.publicationState, m).map((badge) => (
                                    <StatusBadge key={badge.text} status={badge.status}>
                                        {badge.text}
                                    </StatusBadge>
                                ))}
                            </span>
                        </a>
                    </li>
                ))}
            </ul>
            {hasMore ? (
                <Button variant="secondary" busy={loadingMore} onPress={onLoadMore}>
                    {m.yourFoods.loadMore}
                </Button>
            ) : null}
        </div>
    );
};
