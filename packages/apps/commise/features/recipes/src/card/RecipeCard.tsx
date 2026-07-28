'use client';

/**
 * @module @commise/features-recipes/card — web mockup-parity recipe card (compound component, W9-f P7).
 *
 * The single card used across the Home "Recent recipes" widget, the recipe list, and — as they land — the
 * search results and collection member rows. It is a COMPOUND COMPONENT: `RecipeCard` (Root) carries the
 * view-model in context and renders the shell (an actionable button when `onSelect` is given, else a
 * non-interactive article); the parts — `RecipeCard.Cover / .Title / .Meta / .Badges / .Rating / .Tags` —
 * each read that context, so every surface composes its OWN arrangement without a widening prop bag. Passing
 * no children renders the default full arrangement (the merged list/widget card), so a plain
 * `<RecipeCard recipe onSelect />` still works.
 *
 * Design rules encoded here (do not "simplify" them away):
 * - ABSENT difficulty / cuisine / calories / tags render NOTHING — never a default (FR-001b, CR-002).
 * - The PRO badge is driven by the materialized `usesPremiumCapability` flag — never re-derived (FR-003a).
 * - A DRAFT renders a "Draft" badge that REPLACES the visibility badge — never "Public" on a draft, which a
 *   free-tier draft (visibility='public', community-invisible) would make a lie.
 * - The version badge renders only past v1.
 * - The stars are DISPLAY-ONLY here (these are recipes the viewer owns / can't rate); an unrated recipe shows
 *   an honest "not yet rated", never a fabricated 0-star score. The interactive control lives on the detail.
 * - The cover is the FULL-SIZE original (up to 5 MB) painted into a small tile (FOLLOW-UP-CR-001-A).
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { glass, toWebGlass } from '@commise/ui';
import { PressScale } from '@commise/ui/press-scale';
import { RecipeDifficulty, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { createContext, useContext, type FC, type ReactNode } from 'react';

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

/** Props for the shared recipe card. */
export interface RecipeCardProps {
    readonly recipe: RecipeCardModel;
    /** When provided, the card is an actionable button that reports the recipe id (the list card). */
    readonly onSelect?: (id: string) => void;
    /** Custom arrangement of `RecipeCard.*` parts. Omit for the default merged card (list/widget). */
    readonly children?: ReactNode;
}

/** The card's view-model, carried to the parts so no surface has to thread props through the arrangement. */
const RecipeCardContext = createContext<RecipeCardModel | null>(null);

/** Read the card view-model from the nearest {@link RecipeCard}. Throws if a part is rendered outside one. */
function useCardModel(): RecipeCardModel {
    const model = useContext(RecipeCardContext);

    if (model === null) {
        throw new Error('RecipeCard.* parts must be rendered inside a <RecipeCard>.');
    }

    return model;
}

/** Difficulty pill tone → Tailwind classes (warning is a light tone, so it needs dark text for contrast). */
const TONE_CLASS: Record<DifficultyTone, string> = {
    success: 'bg-success text-white',
    warning: 'bg-warning text-charcoal',
    error: 'bg-error text-white',
};

const ClockIcon: FC = () => (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
    </svg>
);

const PeopleIcon: FC = () => (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
        />
    </svg>
);

const STAR_PATH =
    'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z';

const Star: FC<{ filled: boolean }> = ({ filled }) => (
    <svg
        aria-hidden="true"
        // An EMPTY pip states the readout's SCALE, so it is `slate`, not `mist` — see the palette JSDoc in
        // `@commise/ui`'s `tokens/colors.ts`. This is the web half of the fix `RecipeCard.native.tsx` already
        // carries; the two halves had drifted.
        className={`h-4 w-4 ${filled ? 'fill-warning text-warning' : 'text-slate'}`}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        viewBox="0 0 20 20"
    >
        <path d={STAR_PATH} />
    </svg>
);

/** The cover tile: the 4:3 cover photo (or a labelled placeholder) with the corner PRO badge. */
const CardCover: FC = () => {
    const { card } = useMessages(recipeMessages);
    const recipe = useCardModel();

    return (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-2xl bg-pearl">
            {recipe.coverPhotoUrl !== undefined ? (
                // FOLLOW-UP-CR-001-A: full-size original into a thumbnail-sized tile (no derived variants).
                <img src={recipe.coverPhotoUrl} alt={recipe.title} className="h-full w-full object-cover" />
            ) : (
                <div
                    role="img"
                    aria-label={card.noPhotoLabel}
                    // A labelled `role="img"` is a MEANINGFUL graphic, so it is `slate`, not the `mist`
                    // hairline tone — see the palette JSDoc in `@commise/ui`'s `tokens/colors.ts`.
                    className="flex h-full w-full items-center justify-center text-slate"
                >
                    <svg aria-hidden="true" className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                    </svg>
                </div>
            )}
            {recipe.usesPremiumCapability && (
                <span
                    aria-label={card.proBadgeLabel}
                    className="absolute right-2 top-2 rounded-full bg-premium px-2 py-1 text-caption font-semibold text-white"
                >
                    {card.proBadge}
                </span>
            )}
        </div>
    );
};

/** The recipe title (clamped to two lines). */
const CardTitle: FC = () => {
    const recipe = useCardModel();

    return <h3 className="line-clamp-2 font-display text-heading-md font-semibold text-charcoal">{recipe.title}</h3>;
};

/** The meta row: total time · servings · difficulty · cuisine · calories (each rendered only when present). */
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

    return (
        <div className="flex flex-wrap items-center gap-3 text-body-sm text-slate">
            <span
                aria-label={card.timeLabel.replace('{minutes}', String(recipe.totalTimeMinutes))}
                className="flex items-center gap-1"
            >
                <ClockIcon />
                {duration}
            </span>
            <span
                aria-label={card.servingsLabel.replace('{count}', String(recipe.servings))}
                className="flex items-center gap-1"
            >
                <PeopleIcon />
                {recipe.servings}
            </span>
            {recipe.leadCaloriesPerServing !== undefined && (
                <span>
                    {card.caloriesLabel.replace('{calories}', formatCalories(recipe.leadCaloriesPerServing, locale))}
                </span>
            )}
            {recipe.difficulty !== undefined && (
                <span
                    className={`rounded-full px-2 py-0.5 text-caption font-semibold ${TONE_CLASS[difficultyTone(recipe.difficulty)]}`}
                >
                    {difficultyLabel[recipe.difficulty]}
                </span>
            )}
            {recipe.cuisine !== undefined && (
                // Contrast (WCAG 2.1 AA): the seafoam tint stays; the label a reader READS takes `ocean-dark`
                // (see `@commise/ui`'s palette JSDoc — seafoam-as-text on its own `/10` is 3.57:1).
                <span className="rounded-full bg-seafoam/10 px-2 py-0.5 text-caption font-medium text-ocean-dark">
                    {recipe.cuisine}
                </span>
            )}
        </div>
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
        <div className="flex flex-wrap items-center gap-2">
            {recipe.currentVersion > 1 && (
                <span
                    aria-label={card.versionLabel.replace('{version}', String(recipe.currentVersion))}
                    className="rounded-full bg-pearl px-2 py-0.5 text-caption font-medium text-slate"
                >
                    {card.versionBadge.replace('{version}', String(recipe.currentVersion))}
                </span>
            )}
            {isDraft ? (
                <span className="rounded-full bg-warning px-2 py-0.5 text-caption font-semibold text-charcoal">
                    {card.draftBadge}
                </span>
            ) : (
                // Same tint-on-tint contrast contract as the cuisine badge above.
                <span className="rounded-full bg-seafoam/10 px-2 py-0.5 text-caption font-medium text-ocean-dark">
                    {recipe.visibility === RecipeVisibility.PUBLIC ? card.visibilityPublic : card.visibilityPrivate}
                </span>
            )}
            <span className="text-caption text-slate">{timestampLabel}</span>
        </div>
    );
};

/** The star rating row: display-only. Rated → a labelled star group; unrated → an honest "not yet rated". */
const CardRating: FC = () => {
    const { card } = useMessages(recipeMessages);
    const locale = useLocale();
    const recipe = useCardModel();

    if (recipe.averageRating === undefined || recipe.ratingCount === 0) {
        return <span className="text-body-sm text-slate">{card.unrated}</span>;
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
        <div role="img" aria-label={label} className="flex items-center gap-1">
            {Array.from({ length: STAR_COUNT }, (_value, index) => (
                <Star key={index} filled={fills[index] ?? false} />
            ))}
        </div>
    );
};

/** The tag chips (rendered only when the recipe has tags). */
const CardTags: FC = () => {
    const recipe = useCardModel();

    if (recipe.tags.length === 0) {
        return null;
    }

    return (
        <ul className="flex flex-wrap gap-1.5">
            {recipe.tags.map((tag) => (
                // Contrast (WCAG AA): coral-as-text over the coral tint is 2.21:1, less than half the 4.5:1
                // floor. The LABEL demotes to slate (4.85:1) and the warm tint stays, which is exactly the
                // fix the native leaf already carries — the two now agree again.
                <li key={tag} className="rounded-full bg-coral/10 px-2 py-0.5 text-caption font-medium text-slate">
                    {tag}
                </li>
            ))}
        </ul>
    );
};

/** The default merged arrangement rendered when a consumer passes no custom children (list + widget card). */
const DefaultCardContent: FC = () => (
    <>
        <CardCover />
        <div className="flex flex-col gap-2 p-4">
            <CardTitle />
            <CardMeta />
            <CardBadges />
            <CardRating />
            <CardTags />
        </div>
    </>
);

// U8 brand elevation: the shell RESTS at the `shadow-md` token (was `shadow-sm`) and lifts to `shadow-lg`
// on hover, giving the card real depth across the list + Home widget.
//
// The FILL is not here — it is the frosted-glass surface below. Both mockups that draw this card (the Home
// "Recent Recipes" grid and the recipe-list grid) paint it as glass over the page's beach-glow background:
// `bg-gradient-to-br from-white/70 to-white/50 backdrop-blur-[16px] saturate-[140%] border border-white/30 …
// hover:border-white/40`. So the opaque `bg-card` fill is gone (it would paint OVER the translucency and
// cancel the treatment) and the `ring-1 ring-border` hairline is now the tier's translucent-white border.
//
// The hairline is `border-glass-card-edge` — the `--color-glass-card-edge` custom property emitted from the
// SAME `glass.card.border` token the native leaf consumes as `cardGlass.border`. It was previously the literal
// `border-white/30`: one value, two spellings, free to drift (and elsewhere it already had, to `/20`). It stays
// in CLASS position rather than joining the inline `CARD_GLASS` declarations precisely so the `hover:` variant
// below still applies — an inline `borderColor` out-specifies every class and would kill it silently.
//
// `hover:border-white/40` is deliberately NOT tokenized. It is a web-only hover EMPHASIS with no native
// counterpart (there is no hover on a touch device), so carrying it in the shared cross-platform `GlassSpec`
// would add a field one platform structurally cannot consume. Its coupling to the resting edge is noted as a
// residual, not papered over with an abstraction that fits only one leg.
const CARD_SHELL =
    'block overflow-hidden rounded-2xl border border-glass-card-edge text-left shadow-md transition ' +
    'hover:-translate-y-0.5 hover:border-white/40 hover:shadow-lg';

/**
 * The card's frosted surface, projected from the shared `glass.card` token by the SAME `toWebGlass` the
 * `GlassCard` primitive uses — so the card and the primitive can never drift on the treatment.
 *
 * The `GlassCard` COMPONENT is deliberately not used here: it renders its own `<div>`, and this shell must
 * remain the `<article>` (widget) or the `<button>` (list) that carries the card's semantics and, in the
 * actionable form, its hover/focus states. Wrapping would either change those semantics or leave the
 * interactive element itself unpainted. Computed once at module scope — it is a constant, not per-render work.
 *
 * `blurSupported` is `true` (the primitive's own default). The app-level no-blur fallback is a deliberate gap,
 * not an oversight: no Commise surface detects blur support today, so threading a detection flag through the
 * card's props would widen the API for a capability nothing supplies. See the report's residual risks.
 */
const CARD_GLASS = toWebGlass(glass.card, true);

/**
 * The shared recipe card (compound-component Root). `onSelect` present → an actionable button (list); absent
 * → a non-interactive article (the Home widget). Either way the outer element is named by the recipe title,
 * and the view-model is provided to the `RecipeCard.*` parts via context.
 *
 * U8: the actionable form wraps its button in {@link PressScale} for a tactile, reduce-motion-safe press
 * shrink. `PressScale` (web) is an `inline-flex` span whose child drives the scale, so the article is a
 * `grid` — blockifying the span into a grid item that stretches to the full cell width, preserving the
 * card's layout while adding only motion.
 */
const RecipeCardRoot: FC<RecipeCardProps> = ({ recipe, onSelect, children }) => {
    const content = children ?? <DefaultCardContent />;

    return (
        <RecipeCardContext.Provider value={recipe}>
            {onSelect === undefined ? (
                <article aria-label={recipe.title} className={CARD_SHELL} style={CARD_GLASS}>
                    {content}
                </article>
            ) : (
                <article aria-label={recipe.title} className="grid">
                    <PressScale>
                        <button
                            type="button"
                            aria-label={recipe.title}
                            onClick={() => onSelect(recipe.id)}
                            className={`${CARD_SHELL} w-full`}
                            // The glass lands on the INTERACTIVE element, not the wrapper, so the surface and
                            // its hover states belong to the same box.
                            style={CARD_GLASS}
                        >
                            {content}
                        </button>
                    </PressScale>
                </article>
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
