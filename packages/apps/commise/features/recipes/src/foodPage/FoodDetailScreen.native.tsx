/**
 * @module @commise/features-recipes/foodPage — `FoodDetailScreen` (native): the author's food page as the root stack pushes
 * it (`FoodDetail`, ADR-0056 item 2; private foods spec section 5.1). Opened from the editor's refusal sheet or a row's ⋯ menu
 * it sits ABOVE the editor, so Back returns to the editor exactly as it was: pushing this screen is not a leave, and the
 * editor's draft, checkpoint and discard guards do not fire.
 *
 * The orchestration component: the page session is `useFoodPage`, the body is `FoodPageView`; this adds the pinned Back and the
 * large title (the food’s name, wrapping between words). The host owns the route and what Back and Edit do. Styled with
 * Tamagui only.
 *
 * @pattern Facade — one screen over the shared food page session and view
 */
import { useMessages } from '@commise/i18n/react';
import { LargeTitleHeader, type HeaderBack } from '@commise/ui/large-title-header';
import { PushedPageFrame } from '@commise/ui/pushed-page';
import { useId, type FC } from 'react';
import { ScrollView, YStack } from 'tamagui';

import { FoodPageView } from './FoodPageView.native.js';
import { foodPageMessages } from './messages.js';
import { FoodEditSheet } from './FoodEditSheet.native.js';
import { useFoodPage } from './useFoodPage.js';

/** Props for {@link FoodDetailScreen}. */
export interface FoodDetailScreenProps {
    readonly foodId: string;
    /** The way back, named for where it goes ("Back to Edit recipe"). */
    readonly back: HeaderBack;
    /** The way out of "Food not found": the same place Back goes. */
    readonly onLeave: () => void;
    /** The label of that way out. */
    readonly leaveLabel: string;
    /** Whether the device is offline: the app's one connectivity reading, which this package may not read itself. */
    readonly offline: boolean;
}

/** The food page screen. */
export const FoodDetailScreen: FC<FoodDetailScreenProps> = ({ foodId, back, onLeave, leaveLabel, offline }) => {
    const m = useMessages(foodPageMessages);
    const headingId = useId();
    const session = useFoodPage(foodId, { offline });
    const title = 'food' in session.state ? (session.state.food.name ?? m.titleFallback) : m.titleFallback;

    return (
        <PushedPageFrame back={back} headingId={headingId} title={title}>
            {(bind, inset) => (
                <ScrollView {...bind} flex={1} keyboardShouldPersistTaps="handled">
                    <YStack paddingTop={inset.paddingTop} paddingBottom="$6" gap="$3">
                        <LargeTitleHeader headingId={headingId} title={title} back={back} />
                        <YStack paddingHorizontal="$4">
                            <FoodPageView {...session} onLeave={onLeave} leaveLabel={leaveLabel} />
                        </YStack>
                    </YStack>
                    <FoodEditSheet session={session.edit} />
                </ScrollView>
            )}
        </PushedPageFrame>
    );
};
