/**
 * @module @commise/features-recipes — recipe-detail model layer.
 *
 * Pure, platform-agnostic helpers + props shared by the web (`*.tsx`) and native (`*.native.tsx`) detail
 * views. The detail render consumes a {@link RecipeDetail} directly (it is already the read model); the
 * only shaping needed is small formatting the two platforms must not diverge on.
 */
import type { ReactNode } from 'react';

import type { Locale } from '@commise/i18n';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { IngredientQuantity, RecipeDetail, RecipeIngredientView, RecipeNutrition } from '@kitchensink/recipe-core';

import { fillTemplate } from '../list/model.js';

/**
 * Separates the two bounds of a stated range (`2–3 cups`).
 *
 * ⛔ NOT `Intl.NumberFormat.prototype.formatRange`, which is the obvious library-first answer and is wrong
 * HERE: this formatter is shared verbatim by web and by React Native, Hermes delegates `Intl` to the
 * platform's own formatter, and the app polyfills `PluralRules`/`RelativeTimeFormat`/`Locale` but NOT
 * `NumberFormat`. Feature-detecting it would be worse than not using it — the two platforms would then
 * render the same recipe differently, which is exactly what §14's shared-model rule exists to prevent. Each
 * BOUND still goes through `Intl.NumberFormat`, so grouping and decimal separators stay locale-correct;
 * only the glyph between them is fixed.
 *
 * An EN DASH, deliberately: it is the typographic convention for a numeric span in every locale this ships
 * to, and it is punctuation rather than copy, so it does not belong in the message catalogue.
 *
 * U9 reviewed this and KEPT it, on the reasoning above rather than by inheritance: `formatRange` would need
 * a `NumberFormat` polyfill decision before it could be used, and the same glyph is now also what separates
 * the editor's two numeric inputs, so the read and the write surface use one separator on both platforms.
 */
const RANGE_SEPARATOR = '–';

/**
 * Format an ingredient quantity with its optional unit for the active locale via {@link Intl.NumberFormat}
 * (never string concatenation of the NUMBERS, so grouping/decimal separators stay locale-correct). Mirrors
 * `card/model.ts`'s `formatCalories`. Pure.
 *
 * Each of the value object's three members renders differently, and the third is the one to be careful
 * about:
 *
 * | Member   | Example input                 | Renders     |
 * | -------- | ----------------------------- | ----------- |
 * | `exact`  | `{ value: 1.5 }`, `'lbs'`     | `1.5 lbs`   |
 * | `range`  | `{ low: 2, high: 3 }`, `'cups'` | `2–3 cups`  |
 * | `absent` | `—`, `'pinch'`                | `pinch`     |
 *
 * ⛔ An ABSENT quantity renders NO number — not `0`, not `1` (R40). "Butter the size of an egg" states no
 * amount, and printing one would put a figure in front of a cook that their recipe never contained. With no
 * unit either, the result is the empty string; a caller composing `"{quantity} {name}"` must trim.
 *
 * @param quantity - The ingredient quantity value object.
 * @param locale - The active BCP-47 locale.
 * @param unit - The optional unit of measure. An empty string is treated as absent.
 * @returns The formatted "quantity unit" string (either part alone when the other is absent; `''` when both
 *   are).
 */
export const formatQuantity = (quantity: IngredientQuantity, locale: Locale, unit?: string): string => {
    const format = (value: number): string => new Intl.NumberFormat(locale).format(value);
    const formattedQuantity =
        quantity.kind === 'exact'
            ? format(quantity.value)
            : quantity.kind === 'range'
              ? `${format(quantity.low)}${RANGE_SEPARATOR}${format(quantity.high)}`
              : '';
    const hasUnit = unit !== undefined && unit.length > 0;

    if (formattedQuantity.length === 0) {
        return hasUnit ? unit : '';
    }

    return hasUnit ? `${formattedQuantity} ${unit}` : formattedQuantity;
};

/** Which bound a collapsed range contributed from — DERIVED from the model, never re-declared. */
type RangeDerivedBound = NonNullable<RecipeNutrition['rangeDerivedBound']>;

/**
 * The localized sentence for each bound a nutrition figure can have been taken from.
 *
 * A `Record` over the union rather than two loose strings: a third bound added to the model is a COMPILE
 * error at every call site instead of a caveat that silently renders nothing. Each entry is a WHOLE
 * sentence for the same reason `nutrition/messages.ts` gives — a figure with a qualifier concatenated on
 * reads as one sentence in English and as nonsense in a language that inflects or fronts the qualifier.
 */
export type RangeDerivedNotices = Readonly<Record<RangeDerivedBound, string>>;

/**
 * The R38 disclosure for a per-serving figure computed from ONE bound of a stated range. Pure — the single
 * selector both platforms and both surfaces (the detail read view and the editor's running total) use.
 *
 * ⛔ Load-bearing honesty, not decoration. A total computed from `2 cups` when the line reads `2 to 3 cups`
 * is up to a third under and is otherwise indistinguishable from an exact one. The model makes the FIELD's
 * presence the disclosure (there is no "not applicable" value), and this function keeps that property: no
 * collapsed range yields `undefined`, and a caller renders nothing rather than a reassuring sentence.
 *
 * The bound is READ, never assumed. Today's policy only ever collapses to `low`, so hard-coding the copy
 * would pass every test and start lying the day the policy changes server-side.
 *
 * @param nutrition - The per-serving figures, carrying the bound marker when a range was collapsed.
 * @param notices - The localized sentence for each bound.
 * @returns The disclosure to render, or `undefined` when no range was collapsed.
 */
export const rangeDerivedNotice = (nutrition: RecipeNutrition, notices: RangeDerivedNotices): string | undefined =>
    nutrition.rangeDerivedBound === undefined ? undefined : notices[nutrition.rangeDerivedBound];

/**
 * Whether the U11 verification gate CONTRADICTED this line, so its catalog nutrition was withheld from the
 * recipe's figure (plan U14 / R15). Pure.
 *
 * ⛔ ONLY `NEEDS_REVIEW`. Every other status — including the terminal `NOT_FOUND`/`FAILED` — is a fact about
 * the FOOD LINK, not a doubt about our reading of the cook's source, and an ABSENT status means the gate has
 * not judged the line at all. Migration 0023 is explicit that absence means PUBLISH: the gate runs off a
 * queue, so a line publishes between save and verification whatever the verdict table says.
 *
 * @param line - One recipe ingredient line as the detail read returns it.
 * @returns `true` only for a line the gate contradicted.
 */
export const isLineNeedsReview = (line: RecipeIngredientView): boolean =>
    line.resolutionStatus === FoodResolutionStatus.NEEDS_REVIEW;

/**
 * How many of a recipe's lines the gate contradicted. Pure.
 *
 * @param ingredients - The recipe's ingredient lines.
 * @returns The count of doubted lines.
 */
export const needsReviewCount = (ingredients: readonly RecipeIngredientView[]): number =>
    ingredients.filter(isLineNeedsReview).length;

/** The two localized sentences {@link needsReviewNotice} chooses between. */
export interface NeedsReviewNotices {
    /** The sentence for exactly one doubted line. */
    readonly needsReviewNoticeOne: string;
    /** The template for two or more (contains `{count}`). */
    readonly needsReviewNoticeMany: string;
}

/**
 * The recipe-level disclosure for a figure the gate withheld, or `undefined` when nothing was doubted. Pure.
 *
 * ⛔ ITS OWN SENTENCE, not the partial-nutrition caveat. "Some items aren't counted yet" says the catalog had
 * nothing; this says the catalog HAD the figure and we declined to publish it because a check against the
 * cook's own wording disagreed with our match. The two have different fixes — wait, versus correct the
 * match — so collapsing them tells a cook nothing actionable. This is the client half of the wire's
 * `unaccounted{verification_disagreement}`, which exists for the same reason.
 *
 * ⚠️ Singular and plural are two STRINGS rather than one template with a number in it: English
 * pluralization is not a substitution, and a locale that inflects differently changes the catalogue rather
 * than this function.
 *
 * @param ingredients - The recipe's ingredient lines.
 * @param notices - The localized copy for the active locale.
 * @returns The disclosure to render, or `undefined` when no line was doubted.
 */
export const needsReviewNotice = (
    ingredients: readonly RecipeIngredientView[],
    notices: NeedsReviewNotices,
): string | undefined => {
    const count = needsReviewCount(ingredients);

    if (count === 0) {
        return undefined;
    }

    return count === 1 ? notices.needsReviewNoticeOne : fillTemplate(notices.needsReviewNoticeMany, { count });
};

/**
 * Props for the recipe-detail HERO cover, shared by the web (`RecipeHero.tsx`) and native
 * (`RecipeHero.native.tsx`) leaves so the two cannot drift on the contract (§14.4).
 */
export interface RecipeHeroProps {
    /** The recipe title — the cover image's alt text / accessible name. */
    readonly title: string;
    /**
     * Absolute CDN URL of the cover photo. ABSENT → the deliberate no-photo fallback (never an empty source).
     *
     * This is the recipe's canonical cover (the same field the card tile paints), NOT `photos[0]`, so the hero
     * and the card can never disagree about which image represents the recipe.
     */
    readonly coverPhotoUrl?: string;
}

/**
 * Props for the recipe-detail view — a presentational render of an already-loaded {@link RecipeDetail}.
 *
 * The cooking-progress sets + toggle callbacks and the tag-filter callback are OPTIONAL: the view is a pure
 * `props → JSX` render, and the interaction/state lives in the orchestration container (which passes them
 * from `useCookingProgress` + router navigation). Rendered standalone (e.g. a story or a narrow test) the
 * checkboxes read unchecked and the tag chips are inert — no crashes, no hidden state.
 */
export interface RecipeDetailViewProps {
    readonly recipe: RecipeDetail;
    /** Ingredient ids the cook has checked off (D5). Absent → all unchecked. */
    readonly checkedIngredients?: ReadonlySet<string>;
    /** Toggle an ingredient's gathered state (D5). */
    readonly onToggleIngredient?: (ingredientId: string) => void;
    /** 1-based step numbers the cook has marked done (D4). Absent → all unchecked. */
    readonly checkedSteps?: ReadonlySet<number>;
    /** Toggle a step's completed state (D4). */
    readonly onToggleStep?: (stepNumber: number) => void;
    /** Navigate to the visibility-scoped search filtered by `tag` (D6). */
    readonly onFilterByTag?: (tag: string) => void;
    /**
     * Caller-supplied content grouped into the ONE footer row alongside the version + visibility badges (C3
     * wireframe parity) — e.g. the clone action for a non-owner viewer. Absent renders no slot (e.g. the
     * owner viewing their own recipe, where the shared `canClone` gate excludes a clone control entirely).
     */
    readonly footerActions?: ReactNode;
}

/**
 * Props for the PURE detail body — the whole `RecipeDetailView` contract plus the serving scale it renders
 * at. Split out so the body stays `props → JSX` while `RecipeDetailView` itself is a thin orchestration
 * shell that binds the session serving-scale store and computes the scaled projection.
 *
 * The scale is deliberately NOT on {@link RecipeDetailViewProps}: it is not something an app can forget to
 * wire, because there is nothing for an app to wire. That is the structural answer to the failure this
 * feature was added to fix — a capability that reaches the screen only if a container remembers to pass it.
 */
export interface RecipeDetailBodyProps extends RecipeDetailViewProps {
    /** The serving count the body renders at (already clamped to the recipe's supported `servingsRange`). */
    readonly servings: number;
    /** Report a newly chosen serving count back to the shell. */
    readonly onServingsChange: (servings: number) => void;
}

/**
 * Props for the recipe-source (provenance) line, shared by the web (`RecipeSourceLine.tsx`) and native
 * (`RecipeSourceLine.native.tsx`) leaves so the two cannot drift on the contract (§14.4).
 *
 * Both fields are UNTRUSTED and both are optional; every combination renders something defensible, and the
 * all-absent case renders nothing at all. A `sourceUrl` becomes a link only if it survives `safeHttpUrl`.
 */
export interface RecipeSourceLineProps {
    /** The recipe's original URL, as stored. Untrusted — gated by `safeHttpUrl` before it is ever linked. */
    readonly sourceUrl?: string;
    /** The author-stated provenance ("Serious Eats", "Grandma's cookbook"). */
    readonly sourceAttribution?: string;
}

/**
 * The NATIVE source line's props: the shared contract plus the injected "open a URL" adapter.
 *
 * React Native has no declarative link, so leaving the app is a platform CALL. Injecting it (defaulting to
 * `openExternalUrl`) keeps the leaf a pure `props → JSX` render and gives tests a seam that a double
 * actually crosses. The web leaf needs no equivalent — `<a href>` already is the browser's link adapter.
 */
export interface RecipeSourceLineNativeProps extends RecipeSourceLineProps {
    /** Open a VERIFIED href. Defaults to the `Linking.openURL` adapter. */
    readonly onOpen?: (href: string) => void;
}

/**
 * Props for the serving-count control, shared by the web and native leaves (§14.4).
 *
 * Controlled by construction: it owns no state and derives its own bounds from `baseServings` via
 * `servingsRange`, so it cannot offer a serving count the domain would refuse.
 */
export interface ServingScaleControlProps {
    /** The serving count currently displayed. */
    readonly servings: number;
    /** The recipe's authored serving count — the default, and what defines the selectable range. */
    readonly baseServings: number;
    /** Report a newly chosen serving count. Absent → the control renders inert rather than disappearing. */
    readonly onServingsChange?: (servings: number) => void;
}
