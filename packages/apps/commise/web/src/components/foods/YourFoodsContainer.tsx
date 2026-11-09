'use client';

/**
 * The "Your foods" list (`/[locale]/foods`; private foods spec F19): the cook's own foods with their status, each opening its
 * page. Reached from Profile. Orchestration only: the list is `YourFoodsList`, the read is `useOwnFoods`.
 *
 * @pattern Facade — one route over the shared list view and the own-foods read
 */
import { YourFoodsList, foodPageMessages } from '@commise/features-recipes/food-page';
import { useMessages } from '@commise/i18n/react';
import { useOwnFoods } from '@kitchensink/food-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { FC } from 'react';

import { withBasePath } from '@/lib/basePath';

/** The list route’s content. */
export const YourFoodsContainer: FC<{ readonly locale: string }> = ({ locale }) => {
    const m = useMessages(foodPageMessages);
    const router = useRouter();
    const foods = useOwnFoods();
    const items = foods.data?.pages.flatMap((page) => page.items) ?? [];

    return (
        <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-4 px-4 pb-8">
            <h1 className="text-large-title text-ink">{m.yourFoods.title}</h1>
            <YourFoodsList
                phase={foods.isError ? 'error' : foods.isPending ? 'loading' : 'ready'}
                items={items}
                hasMore={foods.hasNextPage}
                loadingMore={foods.isFetchingNextPage}
                hrefOf={(id) => withBasePath(`/${locale}/foods/${encodeURIComponent(id)}`)}
                onOpen={(id) => router.push(`/${locale}/foods/${encodeURIComponent(id)}` as Route)}
                onRetry={() => void foods.refetch()}
                onLoadMore={() => void foods.fetchNextPage()}
            />
        </div>
    );
};
