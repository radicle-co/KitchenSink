'use client';

/**
 * @module @commise/features-recipes — web recipe-detail view (T066 building block).
 *
 * Read-only, presentational render of a loaded `RecipeDetail`: header (title, badges, description),
 * meta stats, photo gallery, ingredients, instructions, and per-serving nutrition (with the partial-
 * nutrition notice from FR-007). Fetch states (loading/error) belong to the composing app, not here.
 *
 * Styled to the Commise design language (docs/mockups/screens/screen-recipe-detail): Playfair display
 * title, seafoam/coral tag pills, a four-up stats strip, checklist ingredients, numbered seafoam step
 * markers, and a nutrition grid — all via `@commise/ui` design tokens exposed as Tailwind v4 utilities.
 *
 * This is the PURE render half of the recipe detail. Its orchestration shell —
 * `RecipeDetailView.tsx`, which binds the session serving scale — is a separate file because a file
 * does ONE thing (CODING_STANDARDS §1) and a component per file is enforced.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { GradientSurface } from '@commise/ui/surface';
import { hasUserEnteredIngredients, RecipeVisibility } from '@kitchensink/recipe-core';
import { scaleRecipeForServings } from '@kitchensink/recipe-core/scaling';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import { fillTemplate, formatDurationMinutes } from '../list/model.js';
import { PhotoCarousel } from './PhotoCarousel.js';
import { RecipeHero } from './RecipeHero.js';
import { RecipeSourceLine } from './RecipeSourceLine.js';
import { ServingScaleControl } from './ServingScaleControl.js';
import {
    formatQuantity,
    isLineNeedsReview,
    needsReviewNotice,
    rangeDerivedNotice,
    type RecipeDetailBodyProps,
} from './model.js';

const statCards = 'grid grid-cols-2 gap-4 rounded-2xl bg-card p-6 shadow-sm sm:grid-cols-4';
const statValue = 'font-display text-2xl font-bold text-charcoal';
const statLabel = 'text-caption uppercase tracking-wide text-slate';

/**
 * The pure `props → JSX` detail render: one responsibility, no state, no fetching, no ref. Everything it
 * shows for a chosen serving count comes from `scaleRecipeForServings`, so what scales (and what
 * deliberately does not) is decided once, in the domain, for both platforms.
 *
 * Exported for tests and for its shell; deliberately NOT on the package barrel — an app composes
 * `RecipeDetailView`, which cannot be shipped with the serving scale un-wired.
 */
export const RecipeDetailBody: FC<RecipeDetailBodyProps> = ({
    recipe,
    checkedIngredients,
    onToggleIngredient,
    checkedSteps,
    onToggleStep,
    onFilterByTag,
    footerActions,
    servings,
    onServingsChange,
}) => {
    const { list, detail } = useMessages(recipeMessages);
    const locale = useLocale();
    // Cuisine + dietary flags are descriptive pills; only `tags` are the search-filter chips (D6).
    const staticBadges = [...(recipe.cuisine ? [recipe.cuisine] : []), ...recipe.dietaryFlags];
    // R38 — read from the STORED figure, not the scaled projection: scaling multiplies both bounds, so which
    // bound the total came from is a fact about the computation, not about the serving count on screen.
    const rangeNotice = rangeDerivedNotice(recipe.nutrition, {
        low: detail.nutritionRangeDerivedLow,
        high: detail.nutritionRangeDerivedHigh,
    });
    // ONE derivation of what the chosen serving count means — the same pure policy the native leaf reads,
    // so the platforms cannot disagree about WHAT scales. Quantities and prep scale; cook time and the
    // per-step timers below are rendered from the STORED recipe, on purpose (see `scaleRecipeForServings`).
    const scaled = scaleRecipeForServings(recipe, servings);
    // U14 — read from the STORED lines rather than the scaled projection, for the same reason `rangeNotice`
    // is: which lines the gate doubted is a fact about the recipe, not about the serving count on screen.
    const reviewNotice = needsReviewNotice(recipe.ingredients, detail);

    return (
        <article aria-label={recipe.title} className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8">
            {/* The mockup LEADS the detail with the cover hero, before any type. A recipe with no cover gets the
                hero's deliberate branded placeholder rather than nothing — see `RecipeHero`. */}
            <RecipeHero title={recipe.title} coverPhotoUrl={recipe.coverPhotoUrl} />

            {/* U8: the header rides a beach-glow gradient title band (mockup recipe-detail), mirroring the
                native leaf so both platforms present the same branded hero. */}
            <header>
                <GradientSurface gradient="hero" className="flex flex-col gap-4 rounded-2xl p-6">
                    <h1 className="font-display text-2xl font-bold leading-tight text-charcoal sm:text-4xl">
                        {recipe.title}
                    </h1>
                    {(staticBadges.length > 0 || recipe.tags.length > 0) && (
                        <ul aria-label={`${recipe.title} tags`} className="flex flex-wrap gap-2">
                            {staticBadges.map((badge, index) => (
                                <li
                                    key={badge}
                                    // Contrast (WCAG AA): a tint-on-tint badge labels itself in a DARKENED
                                    // relative of its own hue, never the hue itself — seafoam-on-seafoam was
                                    // 3.57:1 and coral-on-coral 2.06:1, both under the 4.5:1 body-text floor.
                                    // `ocean-dark` (5.51:1) keeps the seafoam badge's identity; the coral
                                    // badge takes slate (4.67:1), matching the native leaf and the card chip.
                                    className={`rounded-full px-3 py-1 text-body-sm font-medium ${
                                        index % 2 === 0 ? 'bg-seafoam/10 text-ocean-dark' : 'bg-coral/15 text-slate'
                                    }`}
                                >
                                    {badge}
                                </li>
                            ))}
                            {recipe.tags.map((tag) => (
                                <li key={tag}>
                                    <button
                                        type="button"
                                        aria-label={fillTemplate(detail.tagFilterLabel, { tag })}
                                        onClick={() => onFilterByTag?.(tag)}
                                        // Touch floor: the chip is an interactive filter, so it clears 44px at
                                        // base; `md:min-h-0` restores the original desktop chip density.
                                        // Contrast (WCAG AA): slate at rest (4.67:1); the hover tint deepens
                                        // to `coral/25`, where slate would fall to 4.26:1 — so hover darkens
                                        // the LABEL to charcoal (10.31:1) rather than leaving it behind.
                                        className="inline-flex min-h-11 items-center rounded-full bg-coral/15 px-3 py-1 text-body-sm font-medium text-slate transition hover:bg-coral/25 hover:text-charcoal md:min-h-0"
                                    >
                                        {tag}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="text-body-lg leading-relaxed text-slate">{recipe.description}</p>
                </GradientSurface>
            </header>

            {/* Provenance renders for EVERY viewer, owner or not — it is a property of the recipe, not of
                who is looking. Absent source renders nothing at all. */}
            <RecipeSourceLine
                {...(recipe.sourceUrl === undefined ? {} : { sourceUrl: recipe.sourceUrl })}
                {...(recipe.sourceAttribution === undefined ? {} : { sourceAttribution: recipe.sourceAttribution })}
            />

            {/* C2 wireframe parity: Serves leads the strip, then Prep, Cook, Total. */}
            <dl className={statCards}>
                <div className="flex flex-col items-center gap-1 text-center">
                    <dt className={statLabel}>{detail.servingsLabel}</dt>
                    <dd>
                        <ServingScaleControl
                            servings={servings}
                            baseServings={recipe.servings}
                            onServingsChange={onServingsChange}
                        />
                    </dd>
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                    <dt className={statLabel}>{detail.prepLabel}</dt>
                    <dd className={statValue}>{formatDurationMinutes(scaled.prepTimeMinutes, list.durationMinutes)}</dd>
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                    <dt className={statLabel}>{detail.cookLabel}</dt>
                    {/* NOT `scaled` by accident — `ScaledRecipe.cookTimeMinutes` IS the stored value. */}
                    <dd className={statValue}>{formatDurationMinutes(scaled.cookTimeMinutes, list.durationMinutes)}</dd>
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                    <dt className={statLabel}>{detail.totalLabel}</dt>
                    <dd className={statValue}>
                        {formatDurationMinutes(scaled.totalTimeMinutes, list.durationMinutes)}
                    </dd>
                </div>
            </dl>

            {/* The disclosure is part of the feature, not decoration: a cook reading doubled quantities must
                be told, in the same breath, that the cook times beside them did NOT double. `role="status"`
                so it is announced when it appears rather than discovered by sighted scanning alone. */}
            {scaled.scaling.isScaled && (
                <div role="status" className="flex flex-col gap-1 rounded-2xl bg-pearl px-4 py-3">
                    <p className="text-body-sm text-charcoal">
                        {fillTemplate(detail.scaledNotice, { original: recipe.servings })}
                    </p>
                    <p className="text-body-sm font-medium text-charcoal">{detail.scaledTimingCaveat}</p>
                </div>
            )}

            <PhotoCarousel photos={recipe.photos} title={recipe.title} />

            <section aria-label={detail.ingredientsHeading} className="flex flex-col gap-3">
                <h2 className="font-display text-heading-lg font-semibold text-charcoal">
                    {detail.ingredientsHeading}
                </h2>
                <ul className="flex flex-col divide-y divide-border rounded-2xl bg-card p-2 shadow-sm">
                    {scaled.ingredients.map((ingredient) => {
                        const label = formatQuantity(ingredient.quantity, locale, ingredient.unit);
                        const checked = checkedIngredients?.has(ingredient.ingredientId) ?? false;

                        return (
                            <li key={ingredient.ingredientId} className="flex items-center gap-3 px-3 py-3">
                                {/* The interactive control is the 44px base touch target (`size-11`), collapsing
                                    to the 24px box (`sm:size-6`) from sm up. The visible tick box is a nested
                                    element (`size-8 sm:size-6` — 32px mobile, 24px desktop) so the mobile tap
                                    area grows without enlarging the desktop glyph, and desktop stays a 24px box
                                    in a 24px control.

                                    The step indices moved (`size-6 sm:size-5` → `size-8 sm:size-6`) with NO
                                    change in painted pixels: the DS used to redefine Tailwind's `--spacing-*`
                                    scale, so the old classes resolved to these same 32/24px. Now that the
                                    numeric utilities are back on Tailwind's own ramp, the same geometry needs
                                    the true indices. See `@commise/ui/tokens/themeCss`. */}
                                <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={checked}
                                    aria-label={`${label} ${ingredient.name}`.trim()}
                                    onClick={() => onToggleIngredient?.(ingredient.ingredientId)}
                                    className="flex size-11 shrink-0 items-center justify-center sm:size-6"
                                >
                                    <span
                                        aria-hidden
                                        className={`flex size-8 items-center justify-center rounded border-2 transition sm:size-6 ${
                                            checked
                                                ? 'border-seafoam bg-seafoam text-white'
                                                : // Unchecked, the outline IS the affordance (no fill, no
                                                  // glyph) — a UI component owing 3:1 under SC 1.4.11, where
                                                  // `mist` was 1.90:1. Mirrors the native leaf's U4 fix.
                                                  'border-slate bg-transparent'
                                        }`}
                                    >
                                        {checked && <span>✓</span>}
                                    </span>
                                </button>
                                <span className="shrink-0 font-medium text-charcoal">{label}</span>{' '}
                                {/* The user-supplied name/notes yield the width (`min-w-0` so a single long
                                    token can break too); the trailing badge never does. Parity with the
                                    native leaf's `flexShrink` pair — see `RecipeDetailView.native.tsx`. */}
                                <span className="min-w-0 break-words text-charcoal">{ingredient.name}</span>
                                {/* U26 — the PREPARATION, rendered as its own element immediately after the
                                    name and NEVER concatenated into it. Without this a cook could enter
                                    "finely chopped" in the editor, save, and find it nowhere on the recipe
                                    they cook from — the field would round-trip and be invisible. It sits
                                    BEFORE `notes` because it is about this line's food, while `notes` is a
                                    free-form display override the importer fills with the whole source
                                    clause. */}
                                {ingredient.preparation !== undefined && ingredient.preparation.length > 0 && (
                                    <span className="min-w-0 break-words text-body-sm text-slate">
                                        {ingredient.preparation}
                                    </span>
                                )}
                                {ingredient.notes !== undefined && ingredient.notes.length > 0 && (
                                    <span className="min-w-0 break-words text-body-sm text-slate">
                                        {ingredient.notes}
                                    </span>
                                )}
                                {ingredient.isUserEntered && (
                                    <span className="ml-auto shrink-0 rounded-full bg-pearl px-2 py-0.5 text-caption text-slate">
                                        {detail.userEnteredBadge}
                                    </span>
                                )}
                                {/* U14 — the LINE the verification gate contradicted. `ml-auto` so it takes
                                    the trailing slot when there is no `Custom` badge, and a WARNING tone
                                    rather than the neutral pearl: this is the one status a cook can act on.
                                    ⛔ CHARCOAL on a `warning` TINT, never `warning` as the text colour —
                                    `colors.ts` is explicit that #F5B041 is a light fill taking a charcoal
                                    label, and as a foreground on near-white it is far under the 4.5:1 floor.
                                    ⚠️ No ARIA role and no `aria-label`: the badge's own TEXT is its content,
                                    and text inside the list item is already announced with the line. A
                                    `role="note"` here would add a second landmark per doubted line and
                                    (being a role that does not take its name from content) would name none
                                    of them — the mistake `RecipeCalorieChip`'s docstring describes. */}
                                {isLineNeedsReview(ingredient) && (
                                    <span className="ml-auto shrink-0 rounded-full bg-warning/25 px-2 py-0.5 text-caption font-medium text-charcoal">
                                        {detail.needsReviewBadge}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </section>

            <section aria-label={detail.instructionsHeading} className="flex flex-col gap-3">
                <h2 className="font-display text-heading-lg font-semibold text-charcoal">
                    {detail.instructionsHeading}
                </h2>
                <ol className="flex flex-col gap-4">
                    {recipe.steps.map((step) => {
                        const done = checkedSteps?.has(step.stepNumber) ?? false;

                        return (
                            <li key={step.stepNumber} className="flex items-start gap-4">
                                {/* Same idiom as the ingredient checkbox above: the interactive control is the
                                    44px tap target (`size-11`) at base and collapses to the original 32px
                                    marker box (`sm:size-8`) from sm up, while the VISIBLE numbered circle is a
                                    nested `size-8` element — so the mobile tap area grows without enlarging the
                                    desktop marker (desktop renders a 32px circle in a 32px control, unchanged). */}
                                <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={done}
                                    aria-label={fillTemplate(detail.stepToggleLabel, { step: step.stepNumber })}
                                    onClick={() => onToggleStep?.(step.stepNumber)}
                                    className="flex size-11 shrink-0 items-center justify-center sm:size-8"
                                >
                                    {/* Contrast (WCAG 2.1 AA): in the not-done state the NUMERAL is the only
                                        thing in the circle and a reader reads it, so it takes `ocean-dark`
                                        (6.20:1) instead of seafoam (4.02:1). The `border-seafoam` ring stays
                                        seafoam — a boundary is a 3:1 graphic, which it clears. See
                                        `@commise/ui`'s palette JSDoc for the one statement of that split. */}
                                    <span
                                        aria-hidden
                                        className={`flex size-8 items-center justify-center rounded-full text-body-sm font-semibold transition ${
                                            done ? 'bg-seafoam text-white' : 'border-2 border-seafoam text-ocean-dark'
                                        }`}
                                    >
                                        {done ? '✓' : step.stepNumber}
                                    </span>
                                </button>
                                <div className="flex flex-col gap-1 pt-1">
                                    <span
                                        className={`leading-relaxed text-charcoal ${done ? 'line-through opacity-60' : ''}`}
                                    >
                                        {step.instruction}
                                    </span>
                                    {step.timerSeconds !== undefined && (
                                        <span className="text-body-sm font-medium text-ocean-dark">
                                            {fillTemplate(detail.stepTimer, { seconds: step.timerSeconds })}
                                        </span>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            </section>

            <section aria-label={detail.nutritionHeading} className="flex flex-col gap-3">
                <h2 className="font-display text-heading-lg font-semibold text-charcoal">{detail.nutritionHeading}</h2>
                <dl className="grid grid-cols-2 gap-4 rounded-2xl bg-card p-6 shadow-sm sm:grid-cols-4">
                    <div className="flex flex-col items-center gap-1 text-center">
                        <dd className={statValue}>{recipe.nutrition.calories}</dd>
                        <dt className={statLabel}>{detail.caloriesLabel}</dt>
                    </div>
                    <div className="flex flex-col items-center gap-1 text-center">
                        <dd className={statValue}>
                            {fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.proteinG })}
                        </dd>
                        <dt className={statLabel}>{detail.proteinLabel}</dt>
                    </div>
                    <div className="flex flex-col items-center gap-1 text-center">
                        <dd className={statValue}>
                            {fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.carbsG })}
                        </dd>
                        <dt className={statLabel}>{detail.carbsLabel}</dt>
                    </div>
                    <div className="flex flex-col items-center gap-1 text-center">
                        <dd className={statValue}>
                            {fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.fatG })}
                        </dd>
                        <dt className={statLabel}>{detail.fatLabel}</dt>
                    </div>
                </dl>
                {!recipe.nutrition.isComplete && <p className="text-body-sm text-slate">{detail.nutritionPartial}</p>}
                {/* R38 — a DIFFERENT admission from the partial notice above: that one says some lines were
                    left out, this one says a counted line was counted at one end of the amount the recipe
                    actually states. Both can be true at once, so both render. */}
                {rangeNotice !== undefined && <p className="text-body-sm text-slate">{rangeNotice}</p>}
                {/* U14 — a THIRD admission, and the only one that is our own doubt rather than a gap in the
                    data. The catalog HAD these lines' figures; the verification gate read them against the
                    cook's own wording, disagreed, and we withheld them. `role="note"` so the sentence reaches
                    a screen reader as a remark rather than as loose prose, and a warning tone because unlike
                    the two above it is ACTIONABLE: re-pick the food. */}
                {reviewNotice !== undefined && (
                    <p role="note" className="text-body-sm font-medium text-charcoal">
                        {reviewNotice}
                    </p>
                )}
                {hasUserEnteredIngredients(recipe.ingredients) && (
                    <p className="text-caption text-slate">{detail.nutritionSourceNote}</p>
                )}
            </section>

            {/* C3 wireframe parity: the clone action (caller-supplied) + version + visibility badges are ONE
                grouped footer row — `[Clone to My Recipes] [v12] [Public]` — rather than three loose pieces. */}
            <footer role="group" aria-label={detail.badgesLabel} className="flex flex-wrap items-center gap-2">
                {footerActions}
                {recipe.currentVersion > 1 && (
                    <span
                        aria-label={fillTemplate(detail.versionLabel, { version: recipe.currentVersion })}
                        className="rounded-full bg-pearl px-3 py-1 text-caption font-medium text-slate"
                    >
                        {fillTemplate(detail.versionBadge, { version: recipe.currentVersion })}
                    </span>
                )}
                {/* Same tint-on-tint contrast contract as the hero badge row: seafoam tint, `ocean-dark` text. */}
                <span className="rounded-full bg-seafoam/10 px-3 py-1 text-caption font-medium text-ocean-dark">
                    {recipe.visibility === RecipeVisibility.PUBLIC ? detail.visibilityPublic : detail.visibilityPrivate}
                </span>
            </footer>
        </article>
    );
};
