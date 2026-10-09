'use client';

/**
 * @module @commise/features-recipes — the native recipe page's nutrition section: the four figures, the caveats the
 * stored figure carries (partial, range-derived, stale, needs review) and the notes on where the numbers came from,
 * with the link to the Data sources sheet.
 *
 * Presentational: props → JSX. The one effect it owns is the screen-reader cursor: the Data sources sheet returns it to
 * the link that opened it (§S16).
 */
import { useMessages } from '@commise/i18n/react';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { useTheme } from '@commise/ui/theme';
import { hasCatalogNutrition, hasUserEnteredIngredients } from '@kitchensink/recipe-core';
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import { detailStyles as styles } from './detailStyles.native.js';
import {
    needsReviewNotice,
    rangeDerivedNotice,
    staleNutritionNotice,
    type RecipeDetailBodyNativeProps,
} from './model.js';
import { NutritionFigure } from './NutritionFigure.native.js';

/** Props for {@link DetailNutritionSection}. */
export interface DetailNutritionSectionProps {
    readonly recipe: RecipeDetailBodyNativeProps['recipe'];
    /** Open the Data sources sheet. */
    readonly onOpenDataSources: () => void;
    /** Advances each time the sheet closes. */
    readonly returnFocusSignal: number;
}

/** The native nutrition section. */
export const DetailNutritionSection: FC<DetailNutritionSectionProps> = ({
    recipe,
    onOpenDataSources,
    returnFocusSignal,
}) => {
    const { detail } = useMessages(recipeMessages);
    const { colors } = useTheme();
    const sourcesLinkRef = useScreenReaderFocusOnSignal<View>(returnFocusSignal);
    const muted = { color: colors.inkMuted };
    const { nutrition } = recipe;
    // Facts about the READ, from the stored figure — not the serving count on screen.
    const rangeNotice = rangeDerivedNotice(nutrition, {
        low: detail.nutritionRangeDerivedLow,
        high: detail.nutritionRangeDerivedHigh,
    });
    const staleNotice = staleNutritionNotice(nutrition, detail.nutritionStale);
    const reviewNotice = needsReviewNotice(recipe.ingredients, detail);

    return (
        <View style={styles.section}>
            <Text accessibilityRole="header" style={[styles.sectionHeading, { color: colors.ink }]}>
                {detail.nutritionHeading}
            </Text>
            <View style={styles.figureGrid}>
                <NutritionFigure label={detail.caloriesLabel} value={String(nutrition.calories)} />
                <NutritionFigure
                    label={detail.proteinLabel}
                    value={fillTemplate(detail.gramsUnit, { grams: nutrition.proteinG })}
                />
                <NutritionFigure
                    label={detail.carbsLabel}
                    value={fillTemplate(detail.gramsUnit, { grams: nutrition.carbsG })}
                />
                <NutritionFigure
                    label={detail.fatLabel}
                    value={fillTemplate(detail.gramsUnit, { grams: nutrition.fatG })}
                />
            </View>
            {!nutrition.isComplete && <Text style={[styles.caption, muted]}>{detail.nutritionPartial}</Text>}
            {rangeNotice !== undefined && <Text style={[styles.caption, muted]}>{rangeNotice}</Text>}
            {staleNotice !== undefined && <Text style={[styles.caption, muted]}>{staleNotice}</Text>}
            {reviewNotice !== undefined && (
                <Text role="note" style={[styles.caption, styles.caveat, { color: colors.ink }]}>
                    {reviewNotice}
                </Text>
            )}
            {hasCatalogNutrition(recipe.ingredients) && (
                <View>
                    <Text style={[styles.caption, muted]}>{detail.nutritionSourceNote}</Text>
                    <Pressable
                        ref={sourcesLinkRef}
                        accessibilityRole="link"
                        onPress={onOpenDataSources}
                        style={styles.linkTouch}
                    >
                        <Text style={[styles.caption, styles.link, { color: colors.actionText }]}>
                            {detail.nutritionSourcesLink}
                        </Text>
                    </Pressable>
                </View>
            )}
            {hasUserEnteredIngredients(recipe.ingredients) && (
                <Text style={[styles.caption, muted]}>{detail.nutritionCustomNote}</Text>
            )}
        </View>
    );
};
