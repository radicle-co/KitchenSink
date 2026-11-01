'use client';

/**
 * @module @commise/features-recipes — the native recipe page's description: the whole text from the two-column layout,
 * and four lines with a More / Less toggle below it when the text is long. Draws nothing for an empty description.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import { recipeMessages } from '../messages.js';
import { isLongDescription } from './detailFacts.js';

/** Props for {@link DetailDescription}. */
export interface DetailDescriptionProps {
    /** The recipe's description. */
    readonly description: string;
    /** Whether the cook expanded it. */
    readonly expanded: boolean;
    /** Whether the page is in its two-column layout, where the text is never clamped. */
    readonly twoColumns: boolean;
    /** Flip the disclosure. */
    readonly onToggle: () => void;
}

/** The native description. */
export const DetailDescription: FC<DetailDescriptionProps> = ({ description, expanded, twoColumns, onToggle }) => {
    const { detail } = useMessages(recipeMessages);

    if (description === '') {
        return null;
    }

    return (
        <YStack alignItems="flex-start" gap="$1">
            <Text typeRole="readingBody" color="$ink" numberOfLines={expanded || twoColumns ? undefined : 4}>
                {description}
            </Text>
            {!twoColumns && isLongDescription(description) && (
                <Button variant="ghost" size="sm" onPress={onToggle}>
                    {expanded ? detail.descriptionLess : detail.descriptionMore}
                </Button>
            )}
        </YStack>
    );
};
