/**
 * @module @commise/features-recipes — native recipe-detail view (T066 building block).
 *
 * The React Native leaf of {@link import('./RecipeDetailView.js').RecipeDetailView} — same read-only
 * contract and content sections, styled to the Commise design language (@commise/ui palette): a display
 * title, seafoam/coral tag pills, a stats strip, checklist ingredients, numbered seafoam step markers, and
 * a nutrition grid. Mirrors the web `RecipeDetailView`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { fillTemplate, formatDurationMinutes } from '../list/model.js';
import { PhotoCarousel } from './PhotoCarousel.native.js';
import { formatQuantity, type RecipeDetailViewProps } from './model.js';

/** One label/value cell in the stats or nutrition strip. */
const Stat: FC<{ label: string; value: ReactNode }> = ({ label, value }) => (
    <View style={styles.statCell}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
);

export const RecipeDetailView: FC<RecipeDetailViewProps> = ({
    recipe,
    checkedIngredients,
    onToggleIngredient,
    checkedSteps,
    onToggleStep,
    onFilterByTag,
}) => {
    const { list, detail } = useMessages(recipeMessages);
    const locale = useLocale();
    // Cuisine + dietary flags are descriptive pills; only `tags` are the search-filter chips (D6).
    const staticBadges = [...(recipe.cuisine ? [recipe.cuisine] : []), ...recipe.dietaryFlags];

    return (
        <View accessibilityLabel={recipe.title} style={styles.container}>
            <Text accessibilityRole="header" style={styles.title}>
                {recipe.title}
            </Text>
            {(staticBadges.length > 0 || recipe.tags.length > 0) && (
                <View style={styles.badgeRow}>
                    {staticBadges.map((badge, index) => (
                        <Text
                            key={badge}
                            style={[styles.badge, index % 2 === 0 ? styles.badgeSeafoam : styles.badgeCoral]}
                        >
                            {badge}
                        </Text>
                    ))}
                    {recipe.tags.map((tag) => (
                        <Pressable
                            key={tag}
                            accessibilityRole="button"
                            accessibilityLabel={fillTemplate(detail.tagFilterLabel, { tag })}
                            onPress={() => onFilterByTag?.(tag)}
                        >
                            <Text style={[styles.badge, styles.badgeCoral]}>{tag}</Text>
                        </Pressable>
                    ))}
                </View>
            )}
            <Text style={styles.description}>{recipe.description}</Text>

            <View style={styles.statStrip}>
                <Stat
                    label={detail.prepLabel}
                    value={formatDurationMinutes(recipe.prepTimeMinutes, list.durationMinutes)}
                />
                <Stat
                    label={detail.cookLabel}
                    value={formatDurationMinutes(recipe.cookTimeMinutes, list.durationMinutes)}
                />
                <Stat
                    label={detail.totalLabel}
                    value={formatDurationMinutes(recipe.totalTimeMinutes, list.durationMinutes)}
                />
                <Stat label={detail.servingsLabel} value={String(recipe.servings)} />
            </View>

            <PhotoCarousel photos={recipe.photos} title={recipe.title} />

            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {detail.ingredientsHeading}
            </Text>
            <View style={styles.card}>
                {recipe.ingredients.map((ingredient) => {
                    const qty = formatQuantity(ingredient.quantity, locale, ingredient.unit);
                    const checked = checkedIngredients?.has(ingredient.ingredientId) ?? false;

                    return (
                        <View key={ingredient.ingredientId} style={styles.ingredientRow}>
                            <Pressable
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked }}
                                accessibilityLabel={`${qty} ${ingredient.name}`.trim()}
                                onPress={() => onToggleIngredient?.(ingredient.ingredientId)}
                                style={[styles.checkbox, checked && styles.checkboxChecked]}
                            >
                                {checked && <Text style={styles.checkMark}>✓</Text>}
                            </Pressable>
                            <Text style={styles.ingredientQty}>{qty}</Text>
                            <Text style={styles.ingredientName}>{ingredient.name}</Text>
                            {ingredient.notes !== undefined && ingredient.notes.length > 0 && (
                                <Text style={styles.ingredientNotes}>{ingredient.notes}</Text>
                            )}
                            {ingredient.isUserEntered && (
                                <Text style={styles.userBadge}>{detail.userEnteredBadge}</Text>
                            )}
                        </View>
                    );
                })}
            </View>

            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {detail.instructionsHeading}
            </Text>
            <View style={styles.stepList}>
                {recipe.steps.map((step) => {
                    const done = checkedSteps?.has(step.stepNumber) ?? false;

                    return (
                        <View key={step.stepNumber} style={styles.stepRow}>
                            <Pressable
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: done }}
                                accessibilityLabel={fillTemplate(detail.stepToggleLabel, { step: step.stepNumber })}
                                onPress={() => onToggleStep?.(step.stepNumber)}
                                style={[styles.stepMarker, done && styles.stepMarkerDone]}
                            >
                                <Text style={styles.stepMarkerLabel}>{done ? '✓' : step.stepNumber}</Text>
                            </Pressable>
                            <View style={styles.stepBody}>
                                <Text style={[styles.stepText, done && styles.stepTextDone]}>{step.instruction}</Text>
                                {step.timerSeconds !== undefined && (
                                    <Text style={styles.stepTimer}>
                                        {fillTemplate(detail.stepTimer, { seconds: step.timerSeconds })}
                                    </Text>
                                )}
                            </View>
                        </View>
                    );
                })}
            </View>

            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {detail.nutritionHeading}
            </Text>
            <View style={styles.statStrip}>
                <Stat label={detail.caloriesLabel} value={String(recipe.nutrition.calories)} />
                <Stat
                    label={detail.proteinLabel}
                    value={fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.proteinG })}
                />
                <Stat
                    label={detail.carbsLabel}
                    value={fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.carbsG })}
                />
                <Stat
                    label={detail.fatLabel}
                    value={fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.fatG })}
                />
            </View>
            {!recipe.nutrition.isComplete && <Text style={styles.description}>{detail.nutritionPartial}</Text>}
            <Text style={styles.sourceNote}>{detail.nutritionSourceNote}</Text>

            <View accessibilityLabel={detail.badgesLabel} style={styles.badgeRow}>
                {recipe.currentVersion > 1 && (
                    <Text
                        accessibilityLabel={fillTemplate(detail.versionLabel, { version: recipe.currentVersion })}
                        style={[styles.badge, styles.badgeNeutral]}
                    >
                        {fillTemplate(detail.versionBadge, { version: recipe.currentVersion })}
                    </Text>
                )}
                <Text style={[styles.badge, styles.badgeSeafoam]}>
                    {recipe.visibility === RecipeVisibility.PUBLIC ? detail.visibilityPublic : detail.visibilityPrivate}
                </Text>
            </View>
        </View>
    );
};

const cardBorder = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    container: { gap: 16, paddingHorizontal: 16, paddingVertical: 16 },
    title: { fontSize: 30, fontWeight: '700', color: palette.charcoal },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    badge: {
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 4,
        fontSize: 13,
        fontWeight: '500',
        overflow: 'hidden',
    },
    badgeSeafoam: { backgroundColor: 'rgba(61, 139, 133, 0.1)', color: palette.seafoam },
    badgeCoral: { backgroundColor: 'rgba(232, 145, 122, 0.15)', color: palette.coral },
    badgeNeutral: { backgroundColor: palette.pearl, color: palette.slate },
    description: { fontSize: 16, lineHeight: 24, color: palette.slate },
    sourceNote: { fontSize: 11, lineHeight: 16, color: palette.slate },
    statStrip: {
        flexDirection: 'row',
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: cardBorder,
        paddingVertical: 16,
    },
    statCell: { flex: 1, alignItems: 'center', gap: 4 },
    statValue: { fontSize: 18, fontWeight: '700', color: palette.charcoal },
    statLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: palette.slate },
    sectionHeading: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    card: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: cardBorder, padding: 8 },
    ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8 },
    checkbox: {
        width: 18,
        height: 18,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: palette.mist,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxChecked: { backgroundColor: palette.seafoam, borderColor: palette.seafoam },
    checkMark: { fontSize: 12, color: palette.white },
    ingredientQty: { fontWeight: '600', color: palette.charcoal },
    ingredientName: { color: palette.charcoal },
    ingredientNotes: { fontSize: 13, color: palette.slate },
    userBadge: { marginLeft: 'auto', fontSize: 11, color: palette.slate },
    stepList: { gap: 14 },
    stepRow: { flexDirection: 'row', gap: 12 },
    stepMarker: {
        width: 32,
        height: 32,
        borderRadius: 999,
        backgroundColor: palette.seafoam,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    stepMarkerDone: { backgroundColor: palette.seafoam },
    stepMarkerLabel: { color: palette.white, fontWeight: '600' },
    stepBody: { flex: 1, gap: 2 },
    stepText: { fontSize: 15, lineHeight: 22, color: palette.charcoal },
    stepTextDone: { textDecorationLine: 'line-through', opacity: 0.6 },
    stepTimer: { fontSize: 13, fontWeight: '500', color: palette.seafoam },
});
