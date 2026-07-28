/**
 * @module @commise/features-recipes — web recipe-detail view (T066 building block).
 *
 * Read-only, presentational render of a loaded {@link RecipeDetail}: header (title, badges, description),
 * meta stats, photo gallery, ingredients, instructions, and per-serving nutrition (with the partial-
 * nutrition notice from FR-007). Fetch states (loading/error) belong to the composing app, not here.
 *
 * Styled to the Commise design language (docs/mockups/screens/screen-recipe-detail): Playfair display
 * title, seafoam/coral tag pills, a four-up stats strip, checklist ingredients, numbered seafoam step
 * markers, and a nutrition grid — all via `@commise/ui` design tokens exposed as Tailwind v4 utilities.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { GradientSurface } from '@commise/ui/surface';
import { hasUserEnteredIngredients, RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import { fillTemplate, formatDurationMinutes } from '../list/model.js';
import { PhotoCarousel } from './PhotoCarousel.js';
import { RecipeHero } from './RecipeHero.js';
import { formatQuantity, type RecipeDetailViewProps } from './model.js';

const statCards = 'grid grid-cols-2 gap-4 rounded-2xl bg-card p-6 shadow-sm sm:grid-cols-4';
const statValue = 'font-display text-2xl font-bold text-charcoal';
const statLabel = 'text-caption uppercase tracking-wide text-slate';

export const RecipeDetailView: FC<RecipeDetailViewProps> = ({
    recipe,
    checkedIngredients,
    onToggleIngredient,
    checkedSteps,
    onToggleStep,
    onFilterByTag,
    footerActions,
}) => {
    const { list, detail } = useMessages(recipeMessages);
    const locale = useLocale();
    // Cuisine + dietary flags are descriptive pills; only `tags` are the search-filter chips (D6).
    const staticBadges = [...(recipe.cuisine ? [recipe.cuisine] : []), ...recipe.dietaryFlags];

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
                                    className={`rounded-full px-3 py-1 text-body-sm font-medium ${
                                        index % 2 === 0 ? 'bg-seafoam/10 text-seafoam' : 'bg-coral/15 text-coral'
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
                                        className="inline-flex min-h-11 items-center rounded-full bg-coral/15 px-3 py-1 text-body-sm font-medium text-coral transition hover:bg-coral/25 md:min-h-0"
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

            {/* C2 wireframe parity: Serves leads the strip, then Prep, Cook, Total. */}
            <dl className={statCards}>
                <div className="flex flex-col items-center gap-1 text-center">
                    <dt className={statLabel}>{detail.servingsLabel}</dt>
                    <dd className={statValue}>{recipe.servings}</dd>
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                    <dt className={statLabel}>{detail.prepLabel}</dt>
                    <dd className={statValue}>{formatDurationMinutes(recipe.prepTimeMinutes, list.durationMinutes)}</dd>
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                    <dt className={statLabel}>{detail.cookLabel}</dt>
                    <dd className={statValue}>{formatDurationMinutes(recipe.cookTimeMinutes, list.durationMinutes)}</dd>
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                    <dt className={statLabel}>{detail.totalLabel}</dt>
                    <dd className={statValue}>
                        {formatDurationMinutes(recipe.totalTimeMinutes, list.durationMinutes)}
                    </dd>
                </div>
            </dl>

            <PhotoCarousel photos={recipe.photos} title={recipe.title} />

            <section aria-label={detail.ingredientsHeading} className="flex flex-col gap-3">
                <h2 className="font-display text-heading-lg font-semibold text-charcoal">
                    {detail.ingredientsHeading}
                </h2>
                <ul className="flex flex-col divide-y divide-border rounded-2xl bg-card p-2 shadow-sm">
                    {recipe.ingredients.map((ingredient) => {
                        const label = formatQuantity(ingredient.quantity, locale, ingredient.unit);
                        const checked = checkedIngredients?.has(ingredient.ingredientId) ?? false;

                        return (
                            <li key={ingredient.ingredientId} className="flex items-center gap-3 px-3 py-3">
                                {/* The interactive control is the 44px base touch target (`size-11`), collapsing
                                    to the original 24px box (`sm:size-5`) from sm up. The visible tick box is a
                                    nested element (`size-6 sm:size-5`) so the mobile tap area grows without
                                    enlarging the desktop glyph — desktop is byte-identical (a 24px box in a 24px
                                    control). */}
                                <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={checked}
                                    aria-label={`${label} ${ingredient.name}`.trim()}
                                    onClick={() => onToggleIngredient?.(ingredient.ingredientId)}
                                    className="flex size-11 shrink-0 items-center justify-center sm:size-5"
                                >
                                    <span
                                        aria-hidden
                                        className={`flex size-6 items-center justify-center rounded border-2 transition sm:size-5 ${
                                            checked
                                                ? 'border-seafoam bg-seafoam text-white'
                                                : 'border-mist bg-transparent'
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
                                    <span
                                        aria-hidden
                                        className={`flex size-8 items-center justify-center rounded-full text-body-sm font-semibold transition ${
                                            done ? 'bg-seafoam text-white' : 'border-2 border-seafoam text-seafoam'
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
                                        <span className="text-body-sm font-medium text-seafoam">
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
                <span className="rounded-full bg-seafoam/10 px-3 py-1 text-caption font-medium text-seafoam">
                    {recipe.visibility === RecipeVisibility.PUBLIC ? detail.visibilityPublic : detail.visibilityPrivate}
                </span>
            </footer>
        </article>
    );
};
