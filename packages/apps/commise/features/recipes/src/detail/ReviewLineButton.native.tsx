'use client';

/**
 * @module @commise/features-recipes — the owner's "Needs review" control on a recipe page's ingredient row (native): the
 * mirror of `ReviewLineLink.tsx`. A press surface with the attention badge and a chevron, at least 44 pt tall, named
 * "Needs review: {food}". It is drawn BESIDE the row's check control (`IngredientCheckRow`'s `reviewAction` slot), so
 * pressing it never ticks the line.
 *
 * Presentational: props → JSX.
 */
import { fillTemplate } from '@commise/i18n';
import { useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { touchFloor } from '@commise/ui/layout';
import { PressScale } from '@commise/ui/press-scale';
import { StatusBadge } from '@commise/ui/status-badge';
import type { FC } from 'react';
import { XStack, YStack } from 'tamagui';

import { recipeMessages } from '../messages.js';

/** Props for {@link ReviewLineButton}. */
export interface ReviewLineButtonProps {
    /** The line's food, for the control's name. */
    readonly food: string;
    /** Open the editor on this line. */
    readonly onPress: () => void;
}

/** The owner's way from a line that needs review to that line in the editor. */
export const ReviewLineButton: FC<ReviewLineButtonProps> = ({ food, onPress }) => {
    const { detail } = useMessages(recipeMessages);

    return (
        <PressScale
            accessibilityRole="button"
            accessibilityLabel={fillTemplate(detail.needsReviewLinkLabel, { food })}
            onPress={onPress}
        >
            {/* The floor is read at render: 44 pt on iOS, 48 dp on Android (`touchFloor()`). */}
            {/* One line, never wrapping: the pill may shrink and wrap its label, the chevron keeps its size, and both are
                centred on the row. The badge pins itself to `flex-start`, so it sits in a stack the row can centre;
                that pin is what dropped the chevron below the pill (designer ruling 2026-11-11). */}
            <XStack minHeight={touchFloor()} alignItems="center" flexWrap="nowrap" gap="$1">
                <YStack flexShrink={1} alignSelf="center">
                    <StatusBadge status="attention">{detail.needsReviewBadge}</StatusBadge>
                </YStack>
                <YStack flexShrink={0} alignSelf="center">
                    <Icon name="chevronRight" size={16} tone="inkMuted" />
                </YStack>
            </XStack>
        </PressScale>
    );
};
