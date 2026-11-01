/**
 * @module @commise/features-recipes — one per-serving nutrition figure on the native recipe page (build spec §6.1):
 * the value in `figureStat` over its `caption` label, half a row wide so four make a 2 × 2. Presentational; colours
 * are theme keys, so the figure follows the scheme with no hook.
 */
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { YStack } from 'tamagui';

/** Props for {@link NutritionFigure}. */
export interface NutritionFigureProps {
    /** The figure's name ("Protein"). */
    readonly label: string;
    /** The figure, per serving ("32 g"). */
    readonly value: string;
}

/** The native nutrition figure. */
export const NutritionFigure: FC<NutritionFigureProps> = ({ label, value }) => (
    <YStack flexBasis="50%" gap="$1">
        <Text typeRole="figureStat" color="$ink">
            {value}
        </Text>
        <Text typeRole="caption" color="$inkMuted">
            {label}
        </Text>
    </YStack>
);
