/**
 * @module @commise/features-recipes/card — native mockup-parity recipe card (the RN leaf of RecipeCard).
 *
 * Same contract and design rules as the web card (see RecipeCard.tsx): 4:3 cover + PRO badge, title, time ·
 * servings · difficulty, display-only stars. ABSENT difficulty renders no pill; the PRO badge is the
 * materialized flag; unrated renders an honest "not yet rated"; the cover is the full-size original
 * (FOLLOW-UP-CR-001-A). `onSelect` present → a Pressable button (list); absent → a plain View (widget).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { RecipeDifficulty } from '@kitchensink/recipe-core';

import { recipeMessages, type RecipeCardMessages } from '../messages.js';
import { formatDurationMinutes } from '../list/model.js';
import {
    STAR_COUNT,
    difficultyTone,
    formatAverageRating,
    formatRatingCount,
    toStarFills,
    type DifficultyTone,
    type RecipeCardModel,
} from './model.js';

/** Props for the shared recipe card (native). */
export interface RecipeCardProps {
    readonly recipe: RecipeCardModel;
    /** When provided, the card is a Pressable that reports the recipe id (the list card). */
    readonly onSelect?: (id: string) => void;
}

const TONE_COLOR: Record<DifficultyTone, { readonly bg: string; readonly fg: string }> = {
    success: { bg: palette.success, fg: palette.white },
    warning: { bg: palette.warning, fg: palette.charcoal },
    error: { bg: palette.error, fg: palette.white },
};

/** Display-only star row: rated → a labelled star image; unrated → an honest "not yet rated". */
const RatingRow: FC<{ recipe: RecipeCardModel; card: RecipeCardMessages }> = ({ recipe, card }) => {
    const locale = useLocale();

    if (recipe.averageRating === undefined || recipe.ratingCount === 0) {
        return <Text style={styles.unrated}>{card.unrated}</Text>;
    }

    const ratings = formatRatingCount(
        recipe.ratingCount,
        { one: card.ratingCountOne, other: card.ratingCountOther },
        locale,
    );
    const label = card.ratingSummary
        .replace('{average}', formatAverageRating(recipe.averageRating, locale))
        .replace('{ratings}', ratings);
    const fills = toStarFills(recipe.averageRating);

    return (
        <View accessible accessibilityRole="image" accessibilityLabel={label} style={styles.stars}>
            {Array.from({ length: STAR_COUNT }, (_value, index) => (
                <Text key={index} style={fills[index] ? styles.starFilled : styles.starEmpty}>
                    ★
                </Text>
            ))}
        </View>
    );
};

/** Card content shared between the Pressable (list) and the View (widget). */
const CardBody: FC<{ recipe: RecipeCardModel; card: RecipeCardMessages }> = ({ recipe, card }) => {
    const { list } = useMessages(recipeMessages);
    const duration = formatDurationMinutes(recipe.totalTimeMinutes, list.durationMinutes);
    const difficultyLabel: Record<RecipeDifficulty, string> = {
        [RecipeDifficulty.EASY]: card.difficultyEasy,
        [RecipeDifficulty.MEDIUM]: card.difficultyMedium,
        [RecipeDifficulty.HARD]: card.difficultyHard,
    };
    const tone = recipe.difficulty !== undefined ? TONE_COLOR[difficultyTone(recipe.difficulty)] : undefined;

    return (
        <>
            <View style={styles.cover}>
                {recipe.coverPhotoUrl !== undefined ? (
                    // `accessibilityLabel` only — RNW copies it to the underlying <img alt>, giving ONE named
                    // image node. Adding `accessibilityRole="image"` would ALSO put role=img on the wrapper,
                    // yielding two "img" nodes with the same name.
                    <Image
                        accessibilityLabel={recipe.title}
                        source={{ uri: recipe.coverPhotoUrl }}
                        style={styles.coverImage}
                    />
                ) : (
                    <View
                        accessible
                        accessibilityRole="image"
                        accessibilityLabel={card.noPhotoLabel}
                        style={styles.placeholder}
                    />
                )}
                {recipe.usesPremiumCapability && (
                    <Text accessibilityLabel={card.proBadgeLabel} style={styles.pro}>
                        {card.proBadge}
                    </Text>
                )}
            </View>
            <View style={styles.body}>
                <Text style={styles.title}>{recipe.title}</Text>
                <View style={styles.meta}>
                    <Text style={styles.metaText}>{duration}</Text>
                    <Text
                        accessibilityLabel={card.servingsLabel.replace('{count}', String(recipe.servings))}
                        style={styles.metaText}
                    >
                        {recipe.servings}
                    </Text>
                    {recipe.difficulty !== undefined && tone !== undefined && (
                        <Text style={[styles.difficulty, { backgroundColor: tone.bg, color: tone.fg }]}>
                            {difficultyLabel[recipe.difficulty]}
                        </Text>
                    )}
                </View>
                <RatingRow recipe={recipe} card={card} />
            </View>
        </>
    );
};

/**
 * The shared recipe card (native). `onSelect` present → a Pressable button named by the title (list);
 * absent → a plain View (the Home widget).
 */
export const RecipeCard: FC<RecipeCardProps> = ({ recipe, onSelect }) => {
    const { card } = useMessages(recipeMessages);

    if (onSelect === undefined) {
        return (
            <View style={styles.card}>
                <CardBody recipe={recipe} card={card} />
            </View>
        );
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={recipe.title}
            onPress={() => onSelect(recipe.id)}
            style={styles.card}
        >
            <CardBody recipe={recipe} card={card} />
        </Pressable>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        overflow: 'hidden',
    },
    cover: { position: 'relative', width: '100%', aspectRatio: 4 / 3, backgroundColor: palette.pearl },
    coverImage: { width: '100%', height: '100%' },
    placeholder: { width: '100%', height: '100%', backgroundColor: palette.pearl },
    pro: {
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: palette.premium,
        color: palette.white,
        fontSize: 11,
        fontWeight: '600',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        overflow: 'hidden',
    },
    body: { padding: 16, gap: 8 },
    title: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    metaText: { fontSize: 13, color: palette.slate },
    difficulty: {
        fontSize: 11,
        fontWeight: '600',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        overflow: 'hidden',
    },
    stars: { flexDirection: 'row', gap: 2 },
    starFilled: { color: palette.warning, fontSize: 16 },
    starEmpty: { color: palette.mist, fontSize: 16 },
    unrated: { fontSize: 13, color: palette.slate },
});
