/**
 * @module @commise/features-recipes/foodPage — `YourFoodsList` (native): the React Native leaf of `./YourFoodsList.tsx`,
 * on the same props and words. Each row is a button naming the food and its status; the screen's one scroller is the
 * frame's. Styled with Tamagui only.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { LoadingNotice } from '@commise/ui/loading-notice';
import { PressScale } from '@commise/ui/press-scale';
import { StateNotice } from '@commise/ui/state-notice';
import { StatusBadge } from '@commise/ui/status-badge';
import { Text as DesignText } from '@commise/ui/text';
import type { FC } from 'react';
import { XStack, YStack } from 'tamagui';

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
        return (
            <DesignText typeRole="body" color="$inkMuted">
                {m.yourFoods.empty}
            </DesignText>
        );
    }

    return (
        <YStack gap="$4">
            <YStack borderRadius="$4" backgroundColor="$paper" overflow="hidden">
                {items.map((item) => (
                    <PressScale key={item.id} accessibilityRole="button" width="fill" onPress={() => onOpen(item.id)}>
                        <YStack minHeight={56} gap="$1" paddingHorizontal="$4" paddingVertical="$3">
                            <DesignText typeRole="body" color="$ink">
                                {item.name}
                            </DesignText>
                            <XStack flexWrap="wrap" gap="$2">
                                {badgesOf(item.publicationState, m).map((badge) => (
                                    <StatusBadge key={badge.text} status={badge.status}>
                                        {badge.text}
                                    </StatusBadge>
                                ))}
                            </XStack>
                        </YStack>
                    </PressScale>
                ))}
            </YStack>
            {hasMore ? (
                <Button variant="secondary" busy={loadingMore} onPress={onLoadMore}>
                    {m.yourFoods.loadMore}
                </Button>
            ) : null}
        </YStack>
    );
};
