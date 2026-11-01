'use client';

/**
 * @module @commise/features-recipes — the native recipe page's footer facts: where the recipe came from, which version
 * this is, and the way to the version history.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import { recipeMessages } from '../messages.js';
import type { RecipeDetailBodyNativeProps } from './model.js';
import { RecipeSourceLine } from './RecipeSourceLine.native.js';

/** Props for {@link DetailFooter}. */
export interface DetailFooterProps {
    readonly recipe: Pick<RecipeDetailBodyNativeProps['recipe'], 'sourceUrl' | 'sourceAttribution'>;
    /** Open the version history; absent when the page offers none. */
    readonly onViewVersions: (() => void) | undefined;
}

/** The native footer facts. */
export const DetailFooter: FC<DetailFooterProps> = ({ recipe, onViewVersions }) => {
    const { detail } = useMessages(recipeMessages);

    return (
        <YStack alignItems="flex-start" gap="$1">
            <RecipeSourceLine
                {...(recipe.sourceUrl === undefined ? {} : { sourceUrl: recipe.sourceUrl })}
                {...(recipe.sourceAttribution === undefined ? {} : { sourceAttribution: recipe.sourceAttribution })}
            />
            {onViewVersions !== undefined && (
                <Button variant="ghost" size="sm" icon="clock" onPress={onViewVersions}>
                    {detail.versionHistory}
                </Button>
            )}
        </YStack>
    );
};
