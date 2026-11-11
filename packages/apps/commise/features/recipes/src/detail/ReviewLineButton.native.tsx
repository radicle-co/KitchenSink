'use client';

/**
 * @module @commise/features-recipes — the owner's "Needs review" control on a recipe page's ingredient row (native): the
 * mirror of `ReviewLineLink.tsx`. A press surface with the attention badge and a chevron, at least 44 pt tall, named
 * "Needs review: {food}". It is drawn BESIDE the row's check control (`IngredientCheckRow`'s `reviewAction` slot), so
 * pressing it never ticks the line.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { PressScale } from '@commise/ui/press-scale';
import { StatusBadge } from '@commise/ui/status-badge';
import type { FC } from 'react';
import { XStack } from 'tamagui';

import { fillTemplate } from '../format/fillTemplate.js';
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
            <XStack minHeight={44} alignItems="center" gap="$1">
                <StatusBadge status="attention">{detail.needsReviewBadge}</StatusBadge>
                <Icon name="chevronRight" size={16} tone="inkMuted" />
            </XStack>
        </PressScale>
    );
};
