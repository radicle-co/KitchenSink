/**
 * @module @commise/features-recipes/card — native mockup-parity recipe card (the RN leaf of RecipeCard).
 *
 * Same compound-component contract and design rules as the web card (see RecipeCard.tsx): `RecipeCard` (Root)
 * carries the view-model in context and renders the shell (a Pressable button when `onSelect` is given, else
 * a plain View); the parts — `RecipeCard.Cover / .Title / .Meta / .Badges / .Rating / .Tags` — read that
 * context so each surface composes its own arrangement. Passing no children renders the default merged card.
 * ABSENT difficulty/cuisine/calories/tags render nothing; PRO is the materialized flag; a draft shows a
 * "Draft" badge that REPLACES visibility; the version badge shows only past v1; unrated shows an honest
 * "not yet rated"; the cover is the full-size original (FOLLOW-UP-CR-001-A).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { RecipeDifficulty, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { createContext, useContext, type FC, type ReactNode } from 'react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { formatDurationMinutes } from '../list/model.js';
import {
    STAR_COUNT,
    difficultyTone,
    formatAverageRating,
    formatCalories,
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
    /** Custom arrangement of `RecipeCard.*` parts. Omit for the default merged card (list/widget). */
    readonly children?: ReactNode;
}

const RecipeCardContext = createContext<RecipeCardModel | null>(null);

/** Read the card view-model from the nearest {@link RecipeCard}. Throws if a part is rendered outside one. */
function useCardModel(): RecipeCardModel {
    const model = useContext(RecipeCardContext);

    if (model === null) {
        throw new Error('RecipeCard.* parts must be rendered inside a <RecipeCard>.');
    }

    return model;
}

const TONE_COLOR: Record<DifficultyTone, { readonly bg: string; readonly fg: string }> = {
    success: { bg: palette.success, fg: palette.white },
    warning: { bg: palette.warning, fg: palette.charcoal },
    error: { bg: palette.error, fg: palette.white },
};

/** The cover tile: the 4:3 cover photo (or a labelled placeholder) with the corner PRO badge. */
const CardCover: FC = () => {
    const { card } = useMessages(recipeMessages);
    const recipe = useCardModel();

    return (
        <View style={styles.cover}>
            {recipe.coverPhotoUrl !== undefined ? (
                // `accessibilityLabel` only — RNW copies it to the underlying <img alt>, giving ONE named node.
                <Image
                    accessibilityLabel={recipe.title}
                    source={{ uri: recipe.coverPhotoUrl }}
                    cachePolicy="memory-disk"
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
    );
};

/** The recipe title. */
const CardTitle: FC = () => {
    const recipe = useCardModel();

    return <Text style={styles.title}>{recipe.title}</Text>;
};

/** The meta row: total time · servings · calories · difficulty · cuisine (each rendered only when present). */
const CardMeta: FC = () => {
    const { list, card } = useMessages(recipeMessages);
    const locale = useLocale();
    const recipe = useCardModel();
    const duration = formatDurationMinutes(recipe.totalTimeMinutes, list.durationMinutes);
    const difficultyLabel: Record<RecipeDifficulty, string> = {
        [RecipeDifficulty.EASY]: card.difficultyEasy,
        [RecipeDifficulty.MEDIUM]: card.difficultyMedium,
        [RecipeDifficulty.HARD]: card.difficultyHard,
    };
    const tone = recipe.difficulty !== undefined ? TONE_COLOR[difficultyTone(recipe.difficulty)] : undefined;

    return (
        <View style={styles.meta}>
            <Text style={styles.metaText}>{duration}</Text>
            <Text
                accessibilityLabel={card.servingsLabel.replace('{count}', String(recipe.servings))}
                style={styles.metaText}
            >
                {recipe.servings}
            </Text>
            {recipe.leadCaloriesPerServing !== undefined && (
                <Text style={styles.metaText}>
                    {card.caloriesLabel.replace('{calories}', formatCalories(recipe.leadCaloriesPerServing, locale))}
                </Text>
            )}
            {recipe.difficulty !== undefined && tone !== undefined && (
                <Text style={[styles.difficulty, { backgroundColor: tone.bg, color: tone.fg }]}>
                    {difficultyLabel[recipe.difficulty]}
                </Text>
            )}
            {recipe.cuisine !== undefined && <Text style={styles.chip}>{recipe.cuisine}</Text>}
        </View>
    );
};

/** The status badges: version (past v1) + a Draft badge OR the visibility badge (never both). */
const CardBadges: FC = () => {
    const { card } = useMessages(recipeMessages);
    const recipe = useCardModel();
    const isDraft = recipe.status === RecipeStatus.DRAFT;

    return (
        <View style={styles.badges}>
            {recipe.currentVersion > 1 && (
                <Text
                    accessibilityLabel={card.versionLabel.replace('{version}', String(recipe.currentVersion))}
                    style={styles.versionBadge}
                >
                    {card.versionBadge.replace('{version}', String(recipe.currentVersion))}
                </Text>
            )}
            {isDraft ? (
                <Text style={styles.draftBadge}>{card.draftBadge}</Text>
            ) : (
                <Text style={styles.chip}>
                    {recipe.visibility === RecipeVisibility.PUBLIC ? card.visibilityPublic : card.visibilityPrivate}
                </Text>
            )}
        </View>
    );
};

/** Display-only star row: rated → a labelled star image; unrated → an honest "not yet rated". */
const CardRating: FC = () => {
    const { card } = useMessages(recipeMessages);
    const locale = useLocale();
    const recipe = useCardModel();

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

/** The tag chips (rendered only when the recipe has tags). */
const CardTags: FC = () => {
    const recipe = useCardModel();

    if (recipe.tags.length === 0) {
        return null;
    }

    return (
        <View style={styles.tags}>
            {recipe.tags.map((tag) => (
                <Text key={tag} style={styles.tagChip}>
                    {tag}
                </Text>
            ))}
        </View>
    );
};

/** The default merged arrangement rendered when a consumer passes no custom children (list + widget card). */
const DefaultCardContent: FC = () => (
    <>
        <CardCover />
        <View style={styles.body}>
            <CardTitle />
            <CardMeta />
            <CardBadges />
            <CardRating />
            <CardTags />
        </View>
    </>
);

/**
 * The shared recipe card (native, compound-component Root). `onSelect` present → a Pressable button named by
 * the title (list); absent → a plain View (the Home widget). The view-model reaches the parts via context.
 */
const RecipeCardRoot: FC<RecipeCardProps> = ({ recipe, onSelect, children }) => {
    const content = children ?? <DefaultCardContent />;

    return (
        <RecipeCardContext.Provider value={recipe}>
            {onSelect === undefined ? (
                <View style={styles.card}>{content}</View>
            ) : (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={recipe.title}
                    onPress={() => onSelect(recipe.id)}
                    style={styles.card}
                >
                    {content}
                </Pressable>
            )}
        </RecipeCardContext.Provider>
    );
};

/** The compound card: `<RecipeCard>` plus its `.Cover/.Title/.Meta/.Badges/.Rating/.Tags` parts. */
export const RecipeCard = Object.assign(RecipeCardRoot, {
    Cover: CardCover,
    Title: CardTitle,
    Meta: CardMeta,
    Badges: CardBadges,
    Rating: CardRating,
    Tags: CardTags,
});

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
    meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
    metaText: { fontSize: 13, color: palette.slate },
    difficulty: {
        fontSize: 11,
        fontWeight: '600',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        overflow: 'hidden',
    },
    chip: {
        fontSize: 11,
        fontWeight: '500',
        color: palette.seafoam,
        backgroundColor: 'rgba(61, 139, 133, 0.1)',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        overflow: 'hidden',
    },
    badges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    versionBadge: {
        fontSize: 11,
        fontWeight: '500',
        color: palette.slate,
        backgroundColor: palette.pearl,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        overflow: 'hidden',
    },
    draftBadge: {
        fontSize: 11,
        fontWeight: '600',
        color: palette.charcoal,
        backgroundColor: palette.warning,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        overflow: 'hidden',
    },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tagChip: {
        fontSize: 11,
        fontWeight: '500',
        color: palette.coral,
        backgroundColor: 'rgba(232, 145, 122, 0.1)',
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
