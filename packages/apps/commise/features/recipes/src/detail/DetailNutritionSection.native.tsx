'use client';

/**
 * @module @commise/features-recipes — the native recipe page's nutrition row (`RecipeDetailAndroid384`, build list item
 * 12): a collapsed row reading "Nutrition" and "{n} cal per serving" (or "Not counted yet"), which expands in place to
 * the four figures, the caveats the stored figure carries (partial, range-derived, stale, needs review) and the notes on
 * where the numbers came from, with the link to the Data sources sheet. With nothing counted the figures are left out,
 * not drawn as four dashes: the explanation lines say why.
 *
 * Presentational: props → JSX. The one effect it owns is the screen-reader cursor: the Data sources sheet returns it to
 * the link that opened it (§S16).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { PressScale } from '@commise/ui/press-scale';
import { Text as DesignText } from '@commise/ui/text';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { hasCatalogNutrition, hasUserEnteredIngredients } from '@kitchensink/recipe-core';
import type { FC } from 'react';
import type { View } from 'react-native';
import { styled, XStack, YStack } from 'tamagui';

import { recipeMessages } from '../messages.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { DetailCard } from './detailFrames.native.js';
import type { RecipeDetailBodyNativeProps } from './model.js';
import { nutritionSectionFacts } from './detailFacts.js';
import { NutritionFigure } from './NutritionFigure.native.js';

/** The row's card: the page's card ground, 16 at the sides, and 16 of air under the opened figures. */
const NutritionCard = styled(DetailCard, {
    name: 'NutritionCard',
    paddingHorizontal: '$4',
    gap: '$3',

    variants: {
        expanded: { true: { paddingBottom: '$4' } },
    } as const,
});

/** A caveat or note under the figures: the `caption` role in `inkMuted`. */
const Note = styled(DesignText, { name: 'NutritionNote', typeRole: 'caption', color: '$inkMuted' });

/** Props for {@link DetailNutritionSection}. */
export interface DetailNutritionSectionProps {
    readonly recipe: RecipeDetailBodyNativeProps['recipe'];
    /** Whether the cook expanded the row. */
    readonly expanded: boolean;
    /** Flip the disclosure. */
    readonly onToggle: () => void;
    /** Open the Data sources sheet. */
    readonly onOpenDataSources: () => void;
    /** Advances each time the sheet closes. */
    readonly returnFocusSignal: number;
}

/** The native nutrition section. */
export const DetailNutritionSection: FC<DetailNutritionSectionProps> = ({
    recipe,
    expanded,
    onToggle,
    onOpenDataSources,
    returnFocusSignal,
}) => {
    const { detail } = useMessages(recipeMessages);
    const locale = useLocale();
    const sourcesLinkRef = useScreenReaderFocusOnSignal<View>(returnFocusSignal);
    // "—" in each cell and one line when nothing was counted (§6.7, F17), shared with web.
    const { cells, summary, statusLine, rangeNotice, staleNotice, reviewNotice } = nutritionSectionFacts(
        recipe,
        detail,
        locale,
    );

    return (
        <NutritionCard expanded={expanded}>
            <PressScale
                onPress={onToggle}
                accessibilityRole="button"
                accessibilityLabel={fillTemplate(detail.nutritionFigureLabel, {
                    label: detail.nutritionTitle,
                    value: summary,
                })}
                expanded={expanded}
                width="fill"
            >
                <XStack alignItems="center" justifyContent="space-between" minHeight={56} gap="$3">
                    <YStack flexShrink={1} aria-hidden>
                        <DesignText typeRole="sectionTitle" color="$ink">
                            {detail.nutritionTitle}
                        </DesignText>
                        <DesignText typeRole="meta" color="$inkMuted">
                            {summary}
                        </DesignText>
                    </YStack>
                    <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={20} tone="inkMuted" />
                </XStack>
            </PressScale>
            {expanded && !cells.noneCounted && (
                <XStack flexWrap="wrap" rowGap="$4">
                    {cells.cells.map((cell) => (
                        <NutritionFigure key={cell.label} label={cell.label} value={cell.value} />
                    ))}
                </XStack>
            )}
            {expanded && statusLine !== undefined && <Note>{statusLine}</Note>}
            {expanded && rangeNotice !== undefined && <Note>{rangeNotice}</Note>}
            {expanded && staleNotice !== undefined && <Note>{staleNotice}</Note>}
            {expanded && reviewNotice !== undefined && (
                <DesignText role="note" typeRole="label" color="$ink">
                    {reviewNotice}
                </DesignText>
            )}
            {expanded && hasCatalogNutrition(recipe.ingredients) && (
                <YStack>
                    <Note>{detail.nutritionSourceNote}</Note>
                    <PressScale ref={sourcesLinkRef} accessibilityRole="link" onPress={onOpenDataSources}>
                        <YStack minHeight={48} justifyContent="center" alignSelf="flex-start">
                            <DesignText typeRole="caption" color="$actionText" textDecorationLine="underline">
                                {detail.nutritionSourcesLink}
                            </DesignText>
                        </YStack>
                    </PressScale>
                </YStack>
            )}
            {expanded && hasUserEnteredIngredients(recipe.ingredients) && <Note>{detail.nutritionCustomNote}</Note>}
        </NutritionCard>
    );
};
