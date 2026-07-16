/**
 * @module @commise/features-recipes/card — shared model layer for the mockup-parity recipe card.
 *
 * One recipe card renders in TWO places — the Home "Recent recipes" widget and the recipe list — and the
 * mockup draws them identically (4:3 cover + PRO badge, title, time · servings · difficulty, star rating).
 * That shared shape is one piece of knowledge, so it lives here once: the {@link RecipeCardModel} view-model,
 * its projection from a {@link Recipe}, and the pure formatting/derivation helpers the web (`*.tsx`) and
 * native (`*.native.tsx`) card leaves both call. No React, no platform APIs — so the two renders can never
 * drift on projection, difficulty tone, star rounding, or number/plural formatting.
 */
import type { Locale } from '@commise/i18n';
import { RecipeDifficulty, type Recipe } from '@kitchensink/recipe-core';

/**
 * The subset of a {@link Recipe} a card renders. Optional fields carry the domain's ABSENT states straight
 * through — `difficulty` absent = the author stated none (render no pill), `averageRating` absent = unrated
 * (render the unrated state, never a `0` score), `coverPhotoUrl` absent = no photo (render the placeholder).
 * `usesPremiumCapability` is the materialized PRO flag copied verbatim — NEVER re-derived from visibility.
 */
export interface RecipeCardModel {
    readonly id: string;
    readonly title: string;
    /** Total time (prep + cook + any inactive time) in minutes — the single duration the card surfaces. */
    readonly totalTimeMinutes: number;
    readonly servings: number;
    /** Author-stated difficulty (FR-001b). ABSENT → the card renders no difficulty pill. */
    readonly difficulty?: RecipeDifficulty;
    /** Mean rating 1–5 (FR-013a). ABSENT exactly when {@link ratingCount} is 0 — never reported as 0. */
    readonly averageRating?: number;
    /** Number of ratings; 0 when unrated. */
    readonly ratingCount: number;
    /** The materialized "PRO" flag (FR-003a) — copied verbatim, never re-derived. */
    readonly usesPremiumCapability: boolean;
    /**
     * Absolute CDN URL of the cover photo. ABSENT → no photo (render the placeholder).
     *
     * NOTE (FOLLOW-UP-CR-001-A): this is the FULL-SIZE original (up to 5 MB), not a thumbnail — photos are
     * served unprocessed with no derived variants, so a card tile downloads the full image. Tracked, not
     * silently shipped as if it were a thumbnail.
     */
    readonly coverPhotoUrl?: string;
    /** ISO 8601 timestamp of the recipe's last update (drives the widget/list recency sort). */
    readonly updatedAt: string;
}

/**
 * Project a {@link Recipe} down to the {@link RecipeCardModel} the card renders. Absent optional fields are
 * OMITTED (not set to `undefined`) so the model faithfully carries the domain's three-state absences. Pure.
 *
 * @param recipe - The source recipe DTO.
 * @returns The card view-model subset.
 */
export const toRecipeCardModel = (recipe: Recipe): RecipeCardModel => ({
    id: recipe.id,
    title: recipe.title,
    totalTimeMinutes: recipe.totalTimeMinutes,
    servings: recipe.servings,
    ...(recipe.difficulty !== undefined ? { difficulty: recipe.difficulty } : {}),
    ...(recipe.averageRating !== undefined ? { averageRating: recipe.averageRating } : {}),
    ratingCount: recipe.ratingCount,
    usesPremiumCapability: recipe.usesPremiumCapability,
    ...(recipe.coverPhotoUrl !== undefined ? { coverPhotoUrl: recipe.coverPhotoUrl } : {}),
    updatedAt: recipe.updatedAt,
});

/**
 * Semantic color tone for the difficulty pill. Maps to the `success`/`warning`/`error` design tokens; the
 * platform card leaf turns a tone into its Tailwind class (web) or palette color (native).
 */
export type DifficultyTone = 'success' | 'warning' | 'error';

const DIFFICULTY_TONE: Record<RecipeDifficulty, DifficultyTone> = {
    [RecipeDifficulty.EASY]: 'success',
    [RecipeDifficulty.MEDIUM]: 'warning',
    [RecipeDifficulty.HARD]: 'error',
};

/**
 * The pill tone for a stated difficulty (Easy → success, Medium → warning, Hard → error) — the mockup's pill
 * colors. Total over the enum, so there is no "unknown difficulty" fallback: an ABSENT difficulty is handled
 * by the card rendering no pill at all, never by calling this with a substituted value. Pure.
 *
 * @param difficulty - A stated difficulty.
 * @returns Its semantic tone.
 */
export const difficultyTone = (difficulty: RecipeDifficulty): DifficultyTone => DIFFICULTY_TONE[difficulty];

/** The number of stars in the rating display. */
export const STAR_COUNT = 5;

/**
 * Round a 1–5 average to whole filled stars for the card display (the mockup shows whole stars only), as a
 * fixed-length array of `filled` flags. Only ever called for a RATED recipe — an unrated recipe (no average)
 * renders the unrated state instead, so this never has to represent "zero stars". Pure.
 *
 * @param averageRating - The mean rating (1–5).
 * @returns Exactly {@link STAR_COUNT} booleans; the first `round(averageRating)` are filled.
 */
export const toStarFills = (averageRating: number): readonly boolean[] => {
    const filled = Math.round(averageRating);

    return Array.from({ length: STAR_COUNT }, (_value, index) => index < filled);
};

/**
 * Format a 1–5 average to one fractional digit for the active locale via {@link Intl.NumberFormat} (never
 * string concatenation, so decimal separators stay locale-correct). Pure.
 *
 * @param averageRating - The mean rating (1–5).
 * @param locale - The active BCP-47 locale.
 * @returns The formatted average, e.g. `"4.5"`.
 */
export const formatAverageRating = (averageRating: number, locale: Locale): string =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(averageRating);

/** The singular/plural templates for the rating-count label (each may contain `{count}`). */
export interface RatingCountLabels {
    readonly one: string;
    readonly other: string;
}

/**
 * Format the "{n} rating(s)" label for the active locale, selecting singular vs plural via
 * {@link Intl.PluralRules} (locale-correct: English treats `1` as "one", everything else as "other"). Pure.
 *
 * NOTE: like the recipe-count label, this maps every non-`one` category to `other` — enough for English;
 * revisit with a full ICU plural when a locale with `few`/`many` categories ships.
 *
 * @param count - The number of ratings.
 * @param labels - The singular/plural templates.
 * @param locale - The active BCP-47 locale.
 * @returns The formatted rating-count label.
 */
export const formatRatingCount = (count: number, labels: RatingCountLabels, locale: Locale): string => {
    const template = new Intl.PluralRules(locale).select(count) === 'one' ? labels.one : labels.other;

    return template.replace('{count}', String(count));
};
