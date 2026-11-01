/**
 * @module @commise/features-recipes — an empty section of the native recipe page (build spec §6.7): the mirror of
 * `DetailEmptySection.tsx`. Its line, and for the owner the ghost action that opens the editor at that section.
 * Presentational; colours are theme keys, so the section follows the scheme with no hook.
 */
import { Button } from '@commise/ui/button';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { YStack } from 'tamagui';

/** Props for {@link DetailEmptySection}. */
export interface DetailEmptySectionProps {
    /** The section's empty line ("No steps yet."). */
    readonly text: string;
    /** The owner's action ("Add steps"). */
    readonly actionLabel: string;
    /** Opens the editor at this section, for the owner; absent for another cook. */
    readonly onAction: (() => void) | undefined;
}

/** The native empty section. */
export const DetailEmptySection: FC<DetailEmptySectionProps> = ({ text, actionLabel, onAction }) => (
    <YStack alignItems="flex-start" gap="$2" paddingVertical="$2">
        <Text typeRole="body" color="$inkMuted">
            {text}
        </Text>
        {onAction !== undefined && (
            <Button variant="ghost" size="sm" icon="plus" onPress={onAction}>
                {actionLabel}
            </Button>
        )}
    </YStack>
);
