/**
 * @module @commise/features-recipes/foodPage — `YourFoodsRow` (native): the React Native leaf of `./YourFoodsRow.tsx`. The
 * same 56 pt row with an 8 pt steel dot when a staff decision is waiting; the row's accessible name is "Your foods, 1 new
 * decision". Styled with Tamagui only.
 *
 * Presentational: `props → JSX`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { PressScale } from '@commise/ui/press-scale';
import { Text as DesignText } from '@commise/ui/text';
import type { FC } from 'react';
import { XStack, YStack } from 'tamagui';

import { pluralOf } from '../format/plural.js';
import { foodPageMessages } from './messages.js';
import type { YourFoodsRowProps } from './yourFoodsViewProps.js';

/** The Profile row. */
export const YourFoodsRow: FC<YourFoodsRowProps> = ({ unseenDecisions, onPress }) => {
    const { yourFoods: m } = useMessages(foodPageMessages);
    const locale = useLocale();
    const name = unseenDecisions > 0 ? pluralOf(m.profileRowUnseen, unseenDecisions, locale) : m.profileRow;

    return (
        <PressScale accessibilityRole="button" accessibilityLabel={name} width="fill" onPress={onPress}>
            <XStack minHeight={56} alignItems="center" gap="$3" paddingHorizontal="$4" paddingVertical="$2">
                <DesignText aria-hidden typeRole="body" color="$ink" flex={1}>
                    {m.profileRow}
                </DesignText>
                {unseenDecisions > 0 ? (
                    <YStack aria-hidden width={8} height={8} borderRadius="$full" backgroundColor="$action" />
                ) : null}
                <Icon name="chevronRight" size={20} tone="inkMuted" />
            </XStack>
        </PressScale>
    );
};
