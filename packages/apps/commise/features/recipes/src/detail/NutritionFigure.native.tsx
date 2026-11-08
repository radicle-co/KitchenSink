/**
 * @module @commise/features-recipes — one per-serving nutrition figure on the native recipe page (build spec §6.1):
 * the value in `figureStat` over its `caption` label, half a row wide so four make a 2 × 2. Presentational; colours
 * are theme keys, so the figure follows the scheme with no hook.
 *
 * A screen reader hears it as ONE stop, label first ("Calories, 320"), as the web's `dt`/`dd` pair reads: the stack is
 * one accessible element named by `nutritionFigureLabel`, and its two lines are hidden from assistive technology.
 */
import { useMessages } from '@commise/i18n/react';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';

/** Props for {@link NutritionFigure}. */
export interface NutritionFigureProps {
    /** The figure's name ("Protein"). */
    readonly label: string;
    /** The figure, per serving ("32 g"). */
    readonly value: string;
}

/** The native nutrition figure. */
export const NutritionFigure: FC<NutritionFigureProps> = ({ label, value }) => {
    const { detail } = useMessages(recipeMessages);

    return (
        <YStack
            accessible
            aria-label={fillTemplate(detail.nutritionFigureLabel, { label, value })}
            flexBasis="50%"
            gap="$1"
        >
            <Text aria-hidden typeRole="figureStat" color="$ink">
                {value}
            </Text>
            <Text aria-hidden typeRole="caption" color="$inkMuted">
                {label}
            </Text>
        </YStack>
    );
};
