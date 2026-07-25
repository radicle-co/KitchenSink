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
import { hasUserEnteredIngredients, RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import { fillTemplate, formatDurationMinutes } from '../list/model.js';
import { PhotoCarousel } from './PhotoCarousel.js';
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
}) => {
    const { list, detail } = useMessages(recipeMessages);
    const locale = useLocale();
    // Cuisine + dietary flags are descriptive pills; only `tags` are the search-filter chips (D6).
    const staticBadges = [...(recipe.cuisine ? [recipe.cuisine] : []), ...recipe.dietaryFlags];

    return (
        <article aria-label={recipe.title} className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8">
            <header className="flex flex-col gap-4">
                <h1 className="font-display text-4xl font-bold leading-tight text-charcoal">{recipe.title}</h1>
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
                                    className="rounded-full bg-coral/15 px-3 py-1 text-body-sm font-medium text-coral transition hover:bg-coral/25"
                                >
                                    {tag}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="text-body-lg leading-relaxed text-slate">{recipe.description}</p>
            </header>

            <dl className={statCards}>
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
                <div className="flex flex-col items-center gap-1 text-center">
                    <dt className={statLabel}>{detail.servingsLabel}</dt>
                    <dd className={statValue}>{recipe.servings}</dd>
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
                                <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={checked}
                                    aria-label={`${label} ${ingredient.name}`.trim()}
                                    onClick={() => onToggleIngredient?.(ingredient.ingredientId)}
                                    className={`flex size-5 shrink-0 items-center justify-center rounded border-2 transition ${
                                        checked ? 'border-seafoam bg-seafoam text-white' : 'border-mist bg-transparent'
                                    }`}
                                >
                                    {checked && <span aria-hidden>✓</span>}
                                </button>
                                <span className="font-medium text-charcoal">{label}</span>{' '}
                                <span className="text-charcoal">{ingredient.name}</span>
                                {ingredient.notes !== undefined && ingredient.notes.length > 0 && (
                                    <span className="text-body-sm text-slate">{ingredient.notes}</span>
                                )}
                                {ingredient.isUserEntered && (
                                    <span className="ml-auto rounded-full bg-pearl px-2 py-0.5 text-caption text-slate">
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
                                <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={done}
                                    aria-label={fillTemplate(detail.stepToggleLabel, { step: step.stepNumber })}
                                    onClick={() => onToggleStep?.(step.stepNumber)}
                                    className={`flex size-8 shrink-0 items-center justify-center rounded-full text-body-sm font-semibold transition ${
                                        done ? 'bg-seafoam text-white' : 'border-2 border-seafoam text-seafoam'
                                    }`}
                                >
                                    {done ? <span aria-hidden>✓</span> : step.stepNumber}
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

            <footer role="group" aria-label={detail.badgesLabel} className="flex flex-wrap items-center gap-2">
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
