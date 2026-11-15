/**
 * @module CookingLoading — the cooking loading body on native: nothing for the
 * first 300 ms, so a quick read never flashes a skeleton; then three line-shaped blocks in `surfaceMuted` (28 tall, then
 * two at 24) that hold the step's space so nothing shifts when the recipe arrives, hidden from assistive tech; then, after
 * 1 s, the design system's LoadingNotice as well, which announces it politely. No shimmer, so reduced motion needs nothing
 * more.
 *
 * Presentational: props → JSX. The timing lives in the screen (`loadingPhase`).
 */
import { LoadingNotice } from '@commise/ui/loading-notice';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import type { CookingLoadingProps } from './cookingViewProps.js';

const BLOCK_HEIGHTS = [28, 24, 24] as const;

/** The native cooking loading body. */
export const CookingLoading: FC<CookingLoadingProps> = ({ phase, label }) =>
    phase === 'blank' ? null : (
        <YStack gap="$4" paddingHorizontal="$4" paddingVertical="$3">
            <YStack testID="cooking-loading-skeleton" aria-hidden gap="$3">
                {BLOCK_HEIGHTS.map((height, index) => (
                    <YStack key={index} height={height} borderRadius="$sm" backgroundColor="$surfaceMuted" />
                ))}
            </YStack>
            {phase === 'label' ? <LoadingNotice label={label} /> : null}
        </YStack>
    );
