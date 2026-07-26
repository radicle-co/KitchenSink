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
import { nativeTokens } from '@commise/ui/native';
import { PressScale } from '@commise/ui/press-scale';
import { RecipeDifficulty, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { createContext, useContext, type FC, type ReactNode } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { formatDurationMinutes } from '../list/model.js';
import {
    STAR_COUNT,
    difficultyTone,
    formatAverageRating,
    formatCalories,
    formatRatingCount,
    formatRelativeTime,
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

/**
 * The status badges: version (past v1) + a Draft badge OR the visibility badge (never both) + the relative
 * timestamp (CR-002 / recipe-list wireframe: "v12 · Public · Edited 2d ago"). "Edited" reads `updatedAt`
 * when the recipe has been revised since it was created; a never-revised recipe (`updatedAt === createdAt`)
 * reads "Created {relative(createdAt)}" instead, so a fresh, never-edited recipe never claims an edit that
 * never happened.
 */
const CardBadges: FC = () => {
    const { card } = useMessages(recipeMessages);
    const locale = useLocale();
    const recipe = useCardModel();
    const isDraft = recipe.status === RecipeStatus.DRAFT;
    // Reading the clock is THIS component's own side effect (mirrors `RecipeConflictView`'s split of "the
    // caller reads `new Date()`, the pure formatter only maps an instant to a string") — `formatRelativeTime`
    // stays pure and testable without freezing time.
    const now = new Date().toISOString();
    const wasEdited = recipe.updatedAt !== recipe.createdAt;
    const relativeTime = formatRelativeTime(wasEdited ? recipe.updatedAt : recipe.createdAt, now, locale, card.justNow);
    const timestampLabel = (wasEdited ? card.editedRelative : card.createdRelative).replace('{time}', relativeTime);

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
            <Text style={styles.timestamp}>{timestampLabel}</Text>
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
 *
 * U8: the actionable form delegates its press to {@link PressScale} (which OWNS the `Pressable`, its button
 * role/label, and the reduce-motion-safe scale), keeping the visual card style on the inner View.
 */
const RecipeCardRoot: FC<RecipeCardProps> = ({ recipe, onSelect, children }) => {
    const content = children ?? <DefaultCardContent />;

    return (
        <RecipeCardContext.Provider value={recipe}>
            {onSelect === undefined ? (
                <View style={styles.card}>{content}</View>
            ) : (
                <PressScale
                    accessibilityRole="button"
                    accessibilityLabel={recipe.title}
                    onPress={() => onSelect(recipe.id)}
                >
                    <View style={styles.card}>{content}</View>
                </PressScale>
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
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        overflow: 'hidden',
        // U8 brand elevation: the tokenized `md` shadow (Android elevation renders unconditionally; on iOS
        // the co-located `overflow: 'hidden'` masks the layer, so the drop shadow is a Maestro/device check).
        ...nativeTokens.elevation.md,
    },
    cover: { position: 'relative', width: '100%', aspectRatio: 4 / 3, backgroundColor: palette.pearl },
    coverImage: { width: '100%', height: '100%' },
    placeholder: { width: '100%', height: '100%', backgroundColor: palette.pearl },
    pro: {
        position: 'absolute',
        top: nativeTokens.spacing[2],
        right: nativeTokens.spacing[2],
        backgroundColor: palette.premium,
        color: palette.white,
        fontSize: nativeTokens.fontSize.overline,
        fontWeight: '600',
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 3,
        borderRadius: nativeTokens.radius.full,
        overflow: 'hidden',
    },
    body: { padding: nativeTokens.spacing[4], gap: nativeTokens.spacing[2] },
    title: { fontSize: nativeTokens.fontSize.bodyLg, fontWeight: '600', color: palette.charcoal },
    meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: nativeTokens.spacing[3] },
    metaText: { fontSize: 13, color: palette.slate },
    difficulty: {
        fontSize: nativeTokens.fontSize.overline,
        fontWeight: '600',
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 2,
        borderRadius: nativeTokens.radius.full,
        overflow: 'hidden',
    },
    chip: {
        fontSize: nativeTokens.fontSize.overline,
        fontWeight: '500',
        color: palette.seafoam,
        backgroundColor: 'rgba(61, 139, 133, 0.1)',
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 2,
        borderRadius: nativeTokens.radius.full,
        overflow: 'hidden',
    },
    badges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: nativeTokens.spacing[2] },
    versionBadge: {
        fontSize: nativeTokens.fontSize.overline,
        fontWeight: '500',
        color: palette.slate,
        backgroundColor: palette.pearl,
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 2,
        borderRadius: nativeTokens.radius.full,
        overflow: 'hidden',
    },
    draftBadge: {
        fontSize: nativeTokens.fontSize.overline,
        fontWeight: '600',
        color: palette.charcoal,
        backgroundColor: palette.warning,
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 2,
        borderRadius: nativeTokens.radius.full,
        overflow: 'hidden',
    },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tagChip: {
        fontSize: nativeTokens.fontSize.overline,
        fontWeight: '500',
        // Contrast (U4 / WCAG AA): coral-as-text is 2.2:1 — demote to slate (5:1); the coral tint bg stays.
        color: palette.slate,
        backgroundColor: 'rgba(232, 145, 122, 0.1)',
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 2,
        borderRadius: nativeTokens.radius.full,
        overflow: 'hidden',
    },
    stars: { flexDirection: 'row', gap: 2 },
    starFilled: { color: palette.warning, fontSize: nativeTokens.fontSize.bodyMd },
    // Contrast (U4): a mist empty star is 1.9:1 — slate (5:1) makes the empty pips legible for low vision.
    starEmpty: { color: palette.slate, fontSize: nativeTokens.fontSize.bodyMd },
    unrated: { fontSize: 13, color: palette.slate },
    timestamp: { fontSize: nativeTokens.fontSize.overline, color: palette.slate },
});
