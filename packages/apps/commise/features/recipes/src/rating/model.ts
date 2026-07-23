/**
 * @module @commise/features-recipes/rating — model layer for the interactive rating control (FR-013).
 *
 * Pure, platform-agnostic prop contract + helpers shared by the web (`*.tsx`) and native (`*.native.tsx`)
 * leaves, so the two renders can never drift on the own-recipe gate, the star-option labels, or the control's
 * state machine. No React, no platform APIs. The star-display helpers (`toStarFills`, `STAR_COUNT`,
 * `formatAverageRating`, `formatRatingCount`) are DELIBERATELY reused from the card model (`../card/model.js`)
 * rather than restated here — the community aggregate the control shows read-only is the SAME rating knowledge
 * the card shows, so it has exactly one representation (§3 DRY).
 */
import type { Locale } from '@commise/i18n';

import { STAR_COUNT } from '../card/model.js';

/**
 * How the control behaves for the current viewer.
 * - `rate` — the viewer may rate this recipe (they can see it and do not own it): the interactive input shows.
 * - `own` — the viewer owns this recipe (Sc8): the input is withheld and a reason is shown; only the
 *   community aggregate renders. The backend guard is the real enforcement — this is the UX half.
 */
export type RecipeRatingMode = 'rate' | 'own';

/** Which honest error the control surfaces (localized copy lives in the control, keyed by this discriminant). */
export type RecipeRatingError =
    /** Sc9 — a not-found response for a recipe the viewer cannot read; surfaced as "not available", never "forbidden". */
    | 'notAvailable'
    /** Any other failed rating write. */
    | 'generic';

/**
 * The read-only COMMUNITY aggregate every viewer sees (FR-013a) — the social-proof score shown in BOTH the
 * read-only ({@link RecipeRatingDisplayProps}) and interactive ({@link RecipeRatingInputProps}) variants.
 */
export interface RecipeRatingAggregate {
    /** Community mean rating, 1–5 (FR-013a). ABSENT exactly when {@link ratingCount} is 0 — never shown as 0. */
    readonly average?: number;
    /** Number of community ratings; 0 when unrated. */
    readonly ratingCount: number;
}

/**
 * Props for `RecipeRatingDisplay` — the READ-ONLY variant the container selects on the viewer's OWN recipe
 * (`mode === 'own'`, Sc8): the community aggregate plus a stated reason the input is withheld. Nothing
 * interactive. The own-vs-rate decision lives in the orchestrating container ({@link ratingModeFor}), not in a
 * behavior-switching prop — so this render component does exactly one thing (B15).
 */
export type RecipeRatingDisplayProps = RecipeRatingAggregate;

/**
 * Props for `RecipeRatingInput` — the INTERACTIVE variant the container selects when the viewer MAY rate
 * (`mode === 'rate'`). A controlled, presentational block: it fetches nothing and owns no remote state — the
 * composing app owns the `useSetRecipeRating` / `useDeleteRecipeRating` mutations, feeds the community aggregate
 * + the in-flight/error flags in, and receives the rate/remove intents out.
 *
 * `selectedStars` is the rate action's CURRENT selection (the radiogroup value), not the displayed social-proof
 * score — the read-only stars the viewer SEES are the community `average`. The composing app derives it from the
 * detail's `viewerRating` (the viewer's own prior rating), so a returning viewer's stars are PRE-SELECTED and the
 * remove affordance is revealed on load; re-rating is still an idempotent upsert that replaces (Sc7). See
 * {@link resolveSelectedStars} for how the app reconciles a just-made selection with the server value.
 */
export interface RecipeRatingInputProps extends RecipeRatingAggregate {
    /** The rate action's current selection (checked radio). ABSENT → no option selected / the viewer has not rated. */
    readonly selectedStars?: number;
    /** Whether a rating write (set or remove) is in flight — disables the inputs and shows a busy status. */
    readonly pending?: boolean;
    /** An honest error to surface, or ABSENT for none (see {@link RecipeRatingError}). */
    readonly error?: RecipeRatingError;
    /** Invoked with the chosen whole-star value (1–{@link STAR_COUNT}) when the viewer rates. */
    readonly onRate: (stars: number) => void;
    /** Invoked when the viewer removes their rating (Sc10). */
    readonly onRemove: () => void;
}

/**
 * The star values a rater may choose, `[1, 2, …, STAR_COUNT]` — the single source for the option list both
 * platform leaves iterate, so neither can offer a different set of stars.
 */
export const STAR_VALUES: readonly number[] = Array.from({ length: STAR_COUNT }, (_value, index) => index + 1);

/**
 * Decide whether the viewer may rate a recipe or owns it (Sc8). A viewer owns the recipe when their id is
 * known AND equals the owner id; every other case — a different id, or an unknown id — falls through to
 * `rate`, so an absent viewer id can never masquerade as the owner and hide the input on every recipe. Pure.
 *
 * This is the security-relevant branch, so it lives here as one testable unit rather than inline in two
 * platform leaves: the own-recipe gate must fail a unit test if inverted, not silently offer self-rating.
 *
 * @param params - The viewer's app-user id (may be absent) and the recipe's owner id.
 * @returns `'own'` when the viewer is the owner, else `'rate'`.
 */
export const ratingModeFor = (params: { viewerId?: string; ownerId: string }): RecipeRatingMode =>
    params.viewerId !== undefined && params.viewerId === params.ownerId ? 'own' : 'rate';

/**
 * The viewer's most recent rating action THIS session, or `undefined` to defer entirely to the server.
 *
 * Three-state on purpose — ABSENT (no action yet, use the server's `viewerRating`), `{ stars: n }` (just rated
 * `n`), or `{ stars: undefined }` (just removed) — because a removal must be distinguishable from "no action":
 * a bare `number | undefined` collapses those two, which would make a just-removed rating flicker back to the
 * pre-removal stars until the refetch lands.
 */
export type RatingSelectionOverride = { readonly stars: number | undefined } | undefined;

/**
 * Reconcile the viewer's optimistic, session-local rating selection with the server's authoritative
 * `RecipeDetail.viewerRating` (FR-013), returning the stars the control should pre-select (or `undefined` for
 * no selection).
 *
 * The SERVER value is the source of truth: the instant it reflects the viewer's action (the rating write
 * invalidates the detail, and the refetch returns the new `viewerRating`), the `override` is ignored — so there
 * is never a lasting double source of truth. Until it catches up, the `override` bridges the write→refetch gap
 * so the stars do not flicker back to the pre-write value. With no override at all, the server value drives
 * directly, which is exactly what pre-selects a returning viewer's saved rating on load.
 *
 * @param override - The viewer's last local action this session (see {@link RatingSelectionOverride}).
 * @param viewerRating - The server's `RecipeDetail.viewerRating`; ABSENT when the viewer has not rated. Pure.
 * @returns The stars to pre-select, or `undefined` for no selection.
 */
export const resolveSelectedStars = (
    override: RatingSelectionOverride,
    viewerRating: number | undefined,
): number | undefined => (override !== undefined && override.stars !== viewerRating ? override.stars : viewerRating);

/** The singular/plural templates for a star-option's accessible name (each may contain `{count}`). */
export interface StarOptionLabels {
    readonly one: string;
    readonly other: string;
}

/**
 * Format a star option's accessible name for the active locale, selecting singular vs plural via
 * {@link Intl.PluralRules} (so "Rate 1 star" vs "Rate 4 stars" stays locale-correct). Pure.
 *
 * NOTE: like the card's rating-count label, this maps every non-`one` category to `other` — enough for
 * English; revisit with a full ICU plural when a locale with `few`/`many` categories ships.
 *
 * @param stars - The option's whole-star value.
 * @param labels - The singular/plural templates.
 * @param locale - The active BCP-47 locale.
 * @returns The formatted, pluralized option label.
 */
export const formatStarOptionLabel = (stars: number, labels: StarOptionLabels, locale: Locale): string => {
    const template = new Intl.PluralRules(locale).select(stars) === 'one' ? labels.one : labels.other;

    return template.replace('{count}', String(stars));
};
