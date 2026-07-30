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
import { glass, palette, tint, toNativeGlass } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { PressScale } from '@commise/ui/press-scale';
import { GlassCard, isBlurSupported } from '@commise/ui/surface';
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

/**
 * The card tier's native glass projection — computed once at module scope (it is a constant, not per-render
 * work). Sourced from the SAME `glass.card` token + `toNativeGlass` projection the `GlassCard` primitive uses,
 * so the card's hairline can never drift from the surface the primitive paints beneath it.
 */
const cardGlass = toNativeGlass(glass.card);

/** Read the card view-model from the nearest {@link RecipeCard}. Throws if a part is rendered outside one. */
function useCardModel(): RecipeCardModel {
    const model = useContext(RecipeCardContext);

    if (model === null) {
        throw new Error('RecipeCard.* parts must be rendered inside a <RecipeCard>.');
    }

    return model;
}

/**
 * Difficulty pill tone → fill + label. The native mirror of the web leaf's `TONE_CLASS`: the LIGHT tones
 * (`success` 4.67:1, `warning` 6.74:1) take `charcoal`, the dark `error` fill (5.00:1) takes `white`. `success`
 * used to pair a pastel fill with a white label at 2.72:1 on both platforms.
 */
const TONE_COLOR: Record<DifficultyTone, { readonly bg: string; readonly fg: string }> = {
    success: { bg: palette.success, fg: palette.charcoal },
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
 * The card's two-layer surface: the elevated, NON-clipping frosted `shell` wrapping the clipping `card`
 * content.
 *
 * **Why two layers.** iOS renders a layer's drop shadow OUTSIDE its bounds but masks it the moment that same
 * layer sets `overflow: 'hidden'` — so the single-node card (shadow + clip together, needed to round the cover
 * photo) rendered completely flat on iOS while Android's `elevation` (drawn independent of child clipping)
 * looked correct, which is why it went unnoticed. Keeping the shadow on an outer view that clips nothing, and
 * the clip on the inner content view, gives both platforms the elevation AND the rounded cover. The shell also
 * stays PAINTED — iOS derives the shadow from the layer's painted content, so a fully transparent shell would
 * cast no shadow at all.
 *
 * **U8 glass.** The shell IS the {@link GlassCard} design-system primitive, so the card cannot drift from the
 * frosted treatment: the tier's translucent tint over a real `expo-blur` pass, or the tier's more-opaque solid
 * `fallback` where blur is unavailable. Note the web leaf deliberately does NOT use the `GlassCard` COMPONENT
 * (its shell must remain the `<article>`/`<button>` carrying the card's semantics, so it projects the same
 * token through `toWebGlass` instead). That constraint does not exist here: on native the shell is a plain view
 * either way, and `PressScale` owns the `Pressable` and the button role separately — so the native leaf can
 * and should compose the primitive itself.
 *
 * **Honest degradation.** `blurSupported` comes from the platform probe, NOT a hardcoded `true`. `expo-blur`
 * blurs for real on iOS/web; on Android its `blurMethod` defaults to `'none'` and it renders a plain
 * translucent view. Passing `true` there would ship a washed-out, unblurred panel — a surface designed to sit
 * over a blur, sitting over nothing — so Android takes the solid fallback instead. The probe is a static
 * `Platform.OS` read, so this is not per-render work.
 *
 * The inner layer carries the tier's TRANSLUCENT hairline (the mockup's `border-white/30`): an opaque border
 * would read as a frame drawn around the glass rather than the lit edge of it.
 */
const CardSurface: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <GlassCard tier="card" blurSupported={isBlurSupported()} style={styles.shell}>
        <View style={styles.card}>{children}</View>
    </GlassCard>
);

/**
 * The shared recipe card (native, compound-component Root). `onSelect` present → a Pressable button named by
 * the title (list); absent → a plain View (the Home widget). The view-model reaches the parts via context.
 *
 * U8: the actionable form delegates its press to {@link PressScale} (which OWNS the `Pressable`, its button
 * role/label, and the reduce-motion-safe scale), keeping the visual card style on the inner {@link CardSurface}.
 */
const RecipeCardRoot: FC<RecipeCardProps> = ({ recipe, onSelect, children }) => {
    const content = children ?? <DefaultCardContent />;

    return (
        <RecipeCardContext.Provider value={recipe}>
            {onSelect === undefined ? (
                <CardSurface>{content}</CardSurface>
            ) : (
                <PressScale
                    accessibilityRole="button"
                    accessibilityLabel={recipe.title}
                    onPress={() => onSelect(recipe.id)}
                >
                    <CardSurface>{content}</CardSurface>
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
    // The elevated OUTER layer: the tokenized `md` shadow over the rounded frosted surface — and deliberately
    // NO `overflow`, so neither platform masks the drop shadow (see {@link CardSurface}). The FILL is not here:
    // `GlassCard` paints it from the tier token (translucent over blur, or the solid fallback), and an opaque
    // colour at this level would paint over the translucency and cancel the treatment.
    shell: {
        borderRadius: nativeTokens.radius.lg,
        ...nativeTokens.elevation.md,
    },
    // The clipping INNER layer: the translucent glass hairline + the `overflow: 'hidden'` that rounds the cover
    // photo's corners. No background — the frosted shell below must show through.
    card: {
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: cardGlass.border,
        overflow: 'hidden',
    },
    cover: { position: 'relative', width: '100%', aspectRatio: 4 / 3, backgroundColor: palette.pearl },
    coverImage: { width: '100%', height: '100%' },
    placeholder: { width: '100%', height: '100%', backgroundColor: palette.pearl },
    pro: {
        position: 'absolute',
        top: nativeTokens.spacing[2],
        right: nativeTokens.spacing[2],
        backgroundColor: palette.premium,
        // The brand GOLD keeps a dark label (5.70:1): white on it is 2.23:1, and a gold dark enough to carry
        // white is a bronze. Mirrors the web leaf's `text-charcoal` on the same badge.
        color: palette.charcoal,
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
    // The cuisine AND visibility badges share this one style. Contrast (WCAG 2.1 AA): the seafoam tint stays;
    // the label a reader READS takes `ocean-dark` (5.51:1 on that tint) rather than seafoam (3.57:1). Mirrors
    // the web leaf's `text-ocean-dark`; see `@commise/ui`'s palette JSDoc for the accent-vs-text split.
    chip: {
        fontSize: nativeTokens.fontSize.overline,
        fontWeight: '500',
        color: palette['ocean-dark'],
        backgroundColor: tint(palette.seafoam, 0.1),
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
        backgroundColor: tint(palette.coral, 0.1),
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
