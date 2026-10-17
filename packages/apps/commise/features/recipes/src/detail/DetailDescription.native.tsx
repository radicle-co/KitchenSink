'use client';

/**
 * @module @commise/features-recipes — the native recipe page's description: the whole text from the two-column layout,
 * and four lines with a More / Less toggle below it when the text is long. Draws nothing for an empty description.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { isLongDescription } from './detailFacts.js';
import { detailStyles as styles } from './detailStyles.native.js';

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
    const { colors } = useTheme();

    if (description === '') {
        return null;
    }

    return (
        <View style={styles.description}>
            <Text
                numberOfLines={expanded || twoColumns ? undefined : 4}
                style={[styles.readingBody, { color: colors.ink }]}
            >
                {description}
            </Text>
            {!twoColumns && isLongDescription(description) && (
                <Button variant="ghost" size="sm" onPress={onToggle}>
                    {expanded ? detail.descriptionLess : detail.descriptionMore}
                </Button>
            )}
        </View>
    );
};
