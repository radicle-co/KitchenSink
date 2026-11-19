/**
 * @module CookingScaleNote — the native scale note under a step: a muted info glyph and the sentence that says the
 * steps give amounts for another serving count, in the small muted type that marks it as not part of the step. While
 * the screen gives it `onOpen`, one quiet button under it opens the ingredients. It holds no state, and it has no live
 * region because it arrives with the step.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { XStack, YStack } from 'tamagui';

import type { CookingScaleNoteProps } from './cookingScaleNoteProps.js';

/** The native scale note. */
export const CookingScaleNote: FC<CookingScaleNoteProps> = ({ note, openLabel, onOpen }) => (
    <YStack role="note" gap="$2" alignItems="flex-start">
        <XStack gap="$2" alignItems="flex-start">
            <Icon name="info" size={16} tone="inkMuted" />
            <Text typeRole="meta" color="$inkMuted" flexShrink={1}>
                {note}
            </Text>
        </XStack>
        {onOpen === undefined ? null : (
            <Button variant="quiet" size="md" onPress={() => onOpen()}>
                {openLabel}
            </Button>
        )}
    </YStack>
);
