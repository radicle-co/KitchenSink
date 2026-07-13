/**
 * @module @commise/features-recipes — native recipe-detail view (T066 building block).
 *
 * The React Native leaf of {@link import('./RecipeDetailView.js').RecipeDetailView} — same read-only
 * contract and the same content sections, rendered with RN primitives.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Image, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { fillTemplate, formatDurationMinutes } from '../list/model.js';
import { formatQuantity, type RecipeDetailViewProps } from './model.js';

export const RecipeDetailView: FC<RecipeDetailViewProps> = ({ recipe }) => {
    const { list, detail } = useMessages(recipeMessages);
    const badges = [...(recipe.cuisine ? [recipe.cuisine] : []), ...recipe.dietaryFlags, ...recipe.tags];

    return (
        <View accessibilityLabel={recipe.title}>
            <Text accessibilityRole="header">{recipe.title}</Text>
            {badges.map((badge) => (
                <Text key={badge}>{badge}</Text>
            ))}
            <Text>{recipe.description}</Text>

            <Text>{detail.prepLabel}</Text>
            <Text>{formatDurationMinutes(recipe.prepTimeMinutes, list.durationMinutes)}</Text>
            <Text>{detail.cookLabel}</Text>
            <Text>{formatDurationMinutes(recipe.cookTimeMinutes, list.durationMinutes)}</Text>
            <Text>{detail.totalLabel}</Text>
            <Text>{formatDurationMinutes(recipe.totalTimeMinutes, list.durationMinutes)}</Text>
            <Text>{detail.servingsLabel}</Text>
            <Text>{String(recipe.servings)}</Text>

            {recipe.photos.length > 0 && (
                <View accessibilityLabel={detail.photosLabel}>
                    {recipe.photos.map((photo, index) => (
                        <Image
                            key={photo.id}
                            source={{ uri: photo.url }}
                            accessibilityLabel={fillTemplate(detail.photoAlt, {
                                title: recipe.title,
                                index: index + 1,
                            })}
                        />
                    ))}
                </View>
            )}

            <Text accessibilityRole="header">{detail.ingredientsHeading}</Text>
            {recipe.ingredients.map((ingredient) => (
                <View key={ingredient.ingredientId}>
                    <Text>{formatQuantity(ingredient.quantity, ingredient.unit)}</Text>
                    <Text>{ingredient.name}</Text>
                    {ingredient.notes !== undefined && ingredient.notes.length > 0 && <Text>{ingredient.notes}</Text>}
                    {ingredient.isUserEntered && <Text>{detail.userEnteredBadge}</Text>}
                </View>
            ))}

            <Text accessibilityRole="header">{detail.instructionsHeading}</Text>
            {recipe.steps.map((step) => (
                <View key={step.stepNumber}>
                    <Text>{step.instruction}</Text>
                    {step.timerSeconds !== undefined && (
                        <Text>{fillTemplate(detail.stepTimer, { seconds: step.timerSeconds })}</Text>
                    )}
                </View>
            ))}

            <Text accessibilityRole="header">{detail.nutritionHeading}</Text>
            <Text>{detail.caloriesLabel}</Text>
            <Text>{String(recipe.nutrition.calories)}</Text>
            <Text>{detail.proteinLabel}</Text>
            <Text>{fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.proteinG })}</Text>
            <Text>{detail.carbsLabel}</Text>
            <Text>{fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.carbsG })}</Text>
            <Text>{detail.fatLabel}</Text>
            <Text>{fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.fatG })}</Text>
            {!recipe.nutrition.isComplete && <Text>{detail.nutritionPartial}</Text>}
        </View>
    );
};
