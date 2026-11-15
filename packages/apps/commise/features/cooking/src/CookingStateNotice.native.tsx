/**
 * @module CookingStateNotice — the native cooking notices: the load error, no steps and recipe gone. The house `StateNotice`, centred in a column at most 480 wide in every band.
 *
 * Presentational: props → JSX.
 */
import { StateNotice, type StateNoticeProps } from '@commise/ui/state-notice';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import { NOTICE_COLUMN } from './cookingLayout.js';

/** The native cooking notice. */
export const CookingStateNotice: FC<StateNoticeProps> = (props) => (
    <YStack testID="cooking-notice-column" flex={1} width="100%" maxWidth={NOTICE_COLUMN.maxPx} alignSelf="center">
        <StateNotice {...props} />
    </YStack>
);
