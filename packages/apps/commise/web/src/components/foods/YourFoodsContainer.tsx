'use client';

/**
 * The "Your foods" list (`/[locale]/foods`; private foods spec F19): the cook's own foods with their status, each opening its
 * page. Reached from Profile. Orchestration only: the list is `YourFoodsList`, the read is `useOwnFoods`.
 *
 * @pattern Facade — one route over the shared list view and the own-foods read
 */
import { profileMessages } from '@commise/features-account/profile';
import { YourFoodsList, foodPageMessages } from '@commise/features-recipes/food-page';
import { useMessages } from '@commise/i18n/react';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { PushedPageFrame } from '@commise/ui/pushed-page';
import { useOwnFoods } from '@kitchensink/food-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useId, type FC } from 'react';

import { withBasePath } from '@/lib/basePath';
import { foodHref } from '@/components/foods/foodHref';

/** The list route’s content. */
export const YourFoodsContainer: FC<{ readonly locale: string }> = ({ locale }) => {
    const m = useMessages(foodPageMessages);
    const profile = useMessages(profileMessages);
    const headingId = useId();
    const profilePath = `/${locale}/profile`;
    const router = useRouter();
    const back = {
        label: profile.backToProfile,
        parent: profile.title,
        href: withBasePath(profilePath),
        onPress: () => router.push(profilePath as Route),
    };
    const foods = useOwnFoods();
    const items = foods.data?.pages.flatMap((page) => page.items) ?? [];

    return (
        <PushedPageFrame back={back} headingId={headingId} title={m.yourFoods.title}>
            {() => (
                <div className="flex w-full max-w-list flex-col gap-4 pb-8">
                    <LargeTitleHeader headingId={headingId} title={m.yourFoods.title} back={back} />
                    <YourFoodsList
                        phase={foods.isError ? 'error' : foods.isPending ? 'loading' : 'ready'}
                        items={items}
                        hasMore={foods.hasNextPage}
                        loadingMore={foods.isFetchingNextPage}
                        hrefOf={(id) => withBasePath(foodHref(locale, id))}
                        onOpen={(id) => {
                            router.push(foodHref(locale, id));
                        }}
                        onRetry={() => void foods.refetch()}
                        onLoadMore={() => void foods.fetchNextPage()}
                    />
                </div>
            )}
        </PushedPageFrame>
    );
};
