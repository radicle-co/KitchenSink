'use client';

/**
 * @module @commise/features-recipes — the native recipe page's footer facts: where the recipe came from, which version
 * this is, and the way to the version history.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Text, View } from 'react-native';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';
import { detailStyles as styles } from './detailStyles.native.js';
import type { RecipeDetailBodyNativeProps } from './model.js';
import { RecipeSourceLine } from './RecipeSourceLine.native.js';

/** Props for {@link DetailFooter}. */
export interface DetailFooterProps {
    readonly recipe: Pick<RecipeDetailBodyNativeProps['recipe'], 'sourceUrl' | 'sourceAttribution' | 'currentVersion'>;
    /** Open the version history; absent when the page offers none. */
    readonly onViewVersions: (() => void) | undefined;
}

/** The native footer facts. */
export const DetailFooter: FC<DetailFooterProps> = ({ recipe, onViewVersions }) => {
    const { detail } = useMessages(recipeMessages);
    const { colors } = useTheme();

    return (
        <View style={styles.footer}>
            <RecipeSourceLine
                {...(recipe.sourceUrl === undefined ? {} : { sourceUrl: recipe.sourceUrl })}
                {...(recipe.sourceAttribution === undefined ? {} : { sourceAttribution: recipe.sourceAttribution })}
            />
            <Text style={[styles.meta, { color: colors.inkMuted }]}>
                {fillTemplate(detail.versionLabel, { version: recipe.currentVersion })}
            </Text>
            {onViewVersions !== undefined && (
                <Button variant="ghost" size="sm" icon="clock" onPress={onViewVersions}>
                    {detail.versionHistory}
                </Button>
            )}
        </View>
    );
};
