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
import { RecipeDifficulty, RecipeStatus, RecipeVisibility, type Recipe } from '@kitchensink/recipe-core';

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
    /**
     * ISO 8601 timestamp of the recipe's creation — carried alongside {@link updatedAt} SOLELY so the card's
     * relative-timestamp footer (CR-002 / recipe-list wireframe) can tell "Created" from "Edited": when the
     * two are equal the recipe has never been revised since it was authored, so the card reads "Created
     * {relative}"; otherwise it reads "Edited {relative(updatedAt)}". Never rendered on its own.
     */
    readonly createdAt: string;
    /** Author-stated cuisine (CR-002). ABSENT → the card renders no cuisine chip. */
    readonly cuisine?: string;
    /*
     * ⛔ THERE IS DELIBERATELY NO CALORIE FIELD HERE (deferred calorie lookup).
     *
     * A per-serving figure is no longer part of the recipe payload at all — the wire `Recipe` carries none
     * (ADR-0021's "Follow-up owed" removed the last `leadCaloriesPerServing`); it is looked up separately
     * and lands AFTER the card renders. Carrying it as an optional card field made the three real
     * conditions —
     * pending, known, unaccounted — collapse into two (`number | undefined`), so a lookup still in flight was
     * indistinguishable from a recipe that genuinely has no figure, and a card had no way to choose between a
     * skeleton, a number, and nothing.
     *
     * The states live in `../nutrition/model.ts`; the card takes whatever the nutrition layer decided as an
     * opaque `nutrition` SLOT (see `RecipeCard`), which keeps the card pure and ignorant of loading.
     */
    /** Free-text tags (CR-002). Empty → the card renders no tag row. */
    readonly tags: readonly string[];
    /** Current version number (CR-002). The version badge renders only past v1. */
    readonly currentVersion: number;
    /** Visibility (CR-002) — drives the Public/Private badge (unless the recipe is a draft). */
    readonly visibility: RecipeVisibility;
    /**
     * Publication status. A `draft` renders a "Draft" badge that REPLACES the visibility badge (a free-tier
     * draft carries `visibility='public'` while being community-invisible — showing "Public" would mislead).
     * Required for the draft-presentation spec that Task 1.2's tests pin, though the plan's Step-1 field list
     * omitted it — carried here so the badge layer never has to re-derive draftness.
     */
    readonly status: RecipeStatus;
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
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
    ...(recipe.cuisine !== undefined ? { cuisine: recipe.cuisine } : {}),
    tags: recipe.tags,
    currentVersion: recipe.currentVersion,
    visibility: recipe.visibility,
    status: recipe.status,
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
 * How many card placeholders a loading recipe GRID paints — enough to fill the first rows across every
 * breakpoint. Platform-neutral by necessity: the web and native grid skeletons must reserve the same number
 * of rows, and this used to be a web-only constant while native hand-rolled its own count per surface.
 */
export const RECIPE_CARD_SKELETON_COUNT = 6;

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

/**
 * Format calories per serving to a whole-number, locale-grouped string (e.g. `"1,020"`) via
 * {@link Intl.NumberFormat} — never string concatenation. The caller wraps it in the localized
 * `{calories} cal` template.
 *
 * Only ever called for a reading that HAS a figure — `../nutrition/model.ts`'s `toCalorieChipModel` calls it
 * for the `known` member only, and every failure path lands in `unaccounted`, which carries no number. A
 * figure of `0` is therefore a MEASURED zero and formats like any other value; it is the STATE, never the
 * value, that says "we have no figure". Pure.
 *
 * @param calories - The lead calories per serving.
 * @param locale - The active BCP-47 locale.
 * @returns The formatted integer calorie count.
 */
export const formatCalories = (calories: number, locale: Locale): string =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(calories);

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

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;

/**
 * Format an ISO 8601 instant as the card footer's compact, localized "N ago" relative timestamp (CR-002 /
 * recipe-list wireframe: "Edited 2d ago", "Created 1w ago") via {@link Intl.RelativeTimeFormat}'s `narrow`
 * style — library-first, never hand-rolled pluralization — which is what renders the wireframe's abbreviated
 * `"2d ago"` / `"1w ago"` copy (the `long` style would read "2 days ago"). Distinct from
 * `versions/model.ts`'s `formatRelativeTimeAgo`: that helper renders a verbose day-capped sentence for the
 * version-conflict banner ("2 days ago"), a different UI surface with different presentation needs, so this
 * is its own compact, week-capable bucketing rather than a forced shared abstraction.
 *
 * Buckets to the largest whole unit that has elapsed at least once — minutes, then hours, then days, then
 * weeks — each floored so a partial unit never rounds up. An instant less than a minute old (including a
 * "future" instant, e.g. clock skew between the client and server) renders the localized `justNowLabel`
 * rather than a misleading "0m ago" or a negative duration. Pure — the caller supplies `now`.
 *
 * @param isoDateTime - The past instant to render, in ISO 8601.
 * @param now - The current instant, in ISO 8601 (the caller's own clock read is the side effect).
 * @param locale - The active BCP-47 locale.
 * @param justNowLabel - The localized term for a sub-minute-old (or future) instant.
 * @returns The compact localized relative-time string, e.g. `"2d ago"` / `"1w ago"`, or `justNowLabel`.
 */
export const formatRelativeTime = (isoDateTime: string, now: string, locale: Locale, justNowLabel: string): string => {
    const elapsedSeconds = Math.floor((new Date(now).getTime() - new Date(isoDateTime).getTime()) / 1000);

    if (elapsedSeconds < SECONDS_PER_MINUTE) {
        return justNowLabel;
    }

    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'narrow' });

    const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] =
        elapsedSeconds < SECONDS_PER_HOUR
            ? [Math.floor(elapsedSeconds / SECONDS_PER_MINUTE), 'minute']
            : elapsedSeconds < SECONDS_PER_DAY
              ? [Math.floor(elapsedSeconds / SECONDS_PER_HOUR), 'hour']
              : elapsedSeconds < SECONDS_PER_WEEK
                ? [Math.floor(elapsedSeconds / SECONDS_PER_DAY), 'day']
                : [Math.floor(elapsedSeconds / SECONDS_PER_WEEK), 'week'];

    return rtf.format(-amount, unit);
};
