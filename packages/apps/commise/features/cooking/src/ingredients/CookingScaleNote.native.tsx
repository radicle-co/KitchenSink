/**
 * @module CookingScaleNote — the native scale note under a step: the sentence that says the steps give amounts for
 * another serving count, and, while the screen gives it `onOpen`, one quiet button that opens the ingredients. It holds
 * no state, and it is plain text with no live region because it arrives with the step.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import type { CookingScaleNoteProps } from './cookingScaleNoteProps.js';

/** The native scale note. */
export const CookingScaleNote: FC<CookingScaleNoteProps> = ({ note, openLabel, onOpen }) => (
    <YStack gap="$2" alignItems="flex-start">
        <Text typeRole="body" color="$ink">
            {note}
        </Text>
        {onOpen === undefined ? null : (
            <Button variant="quiet" size="md" onPress={() => onOpen()}>
                {openLabel}
            </Button>
        )}
    </YStack>
);
