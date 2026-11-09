/**
 * @module @commise/features-recipes/form — `PrivateFoodNote` (native): the React Native leaf of `./PrivateFoodNote.tsx`. An
 * attention line with the lock glyph in a PUBLIC recipe, the quiet "Private food" badge in a private one; neither opens
 * anything. Styled with Tamagui only.
 *
 * Presentational: `props → JSX`.
 */
import { Icon } from '@commise/ui/icon';
import { StatusBadge } from '@commise/ui/status-badge';
import { Text as DesignText } from '@commise/ui/text';
import type { FC } from 'react';
import { XStack, YStack } from 'tamagui';

import type { RowPrivateFoodView } from './ingredientRowView.js';

/** The note. */
export const PrivateFoodNote: FC<{ readonly view: RowPrivateFoodView }> = ({ view }) =>
    view.kind === 'badge' ? (
        <YStack alignItems="flex-start">
            <StatusBadge status="private">{view.text}</StatusBadge>
        </YStack>
    ) : (
        <XStack alignItems="flex-start" gap="$1">
            <Icon name="lock" size={16} tone="attention" />
            <DesignText typeRole="caption" color="$attention" flexShrink={1}>
                {view.text}
            </DesignText>
        </XStack>
    );
