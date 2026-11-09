/**
 * @module @commise/features-recipes/foodPage — `YourFoodsScreen` (native): the cook's own foods as a stack pushes it from
 * Profile (private foods spec F19). The orchestration component: the read is `useOwnFoods`, the body is `YourFoodsList`;
 * this adds the pinned Back and the large title. The host owns the route. Styled with Tamagui only.
 *
 * @pattern Facade — one screen over the own-foods read and the shared list view
 */
import { useOwnFoods } from '@kitchensink/food-service-client/hooks';
import { useMessages } from '@commise/i18n/react';
import { LargeTitleHeader, type HeaderBack } from '@commise/ui/large-title-header';
import { PushedPageFrame } from '@commise/ui/pushed-page';
import { useId, type FC } from 'react';
import { ScrollView, YStack } from 'tamagui';

import { foodPageMessages } from './messages.js';
import { YourFoodsList } from './YourFoodsList.native.js';

/** Props for {@link YourFoodsScreen}. */
export interface YourFoodsScreenProps {
    /** The way back, named for where it goes ("Back to Profile"). */
    readonly back: HeaderBack;
    readonly onOpenFood: (foodId: string) => void;
}

/** The Your foods screen. */
export const YourFoodsScreen: FC<YourFoodsScreenProps> = ({ back, onOpenFood }) => {
    const m = useMessages(foodPageMessages);
    const headingId = useId();
    const foods = useOwnFoods();
    const items = foods.data?.pages.flatMap((page) => page.items) ?? [];

    return (
        <PushedPageFrame back={back} headingId={headingId} title={m.yourFoods.title}>
            {(bind, inset) => (
                <ScrollView {...bind} flex={1} keyboardShouldPersistTaps="handled">
                    <YStack paddingTop={inset.paddingTop} paddingBottom="$6" gap="$3">
                        <LargeTitleHeader headingId={headingId} title={m.yourFoods.title} back={back} />
                        <YStack paddingHorizontal="$4">
                            <YourFoodsList
                                phase={foods.isError ? 'error' : foods.isPending ? 'loading' : 'ready'}
                                items={items}
                                hasMore={foods.hasNextPage}
                                loadingMore={foods.isFetchingNextPage}
                                onOpen={onOpenFood}
                                onRetry={() => void foods.refetch()}
                                onLoadMore={() => void foods.fetchNextPage()}
                            />
                        </YStack>
                    </YStack>
                </ScrollView>
            )}
        </PushedPageFrame>
    );
};
