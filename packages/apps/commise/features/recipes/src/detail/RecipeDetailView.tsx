/**
 * @module @commise/features-recipes — web recipe-detail view (T066 building block).
 *
 * Read-only, presentational render of a loaded {@link RecipeDetail}: header (title, badges, description),
 * meta stats, photo gallery, ingredients, instructions, and per-serving nutrition (with the partial-
 * nutrition notice from FR-007). Fetch states (loading/error) belong to the composing app, not here.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import { fillTemplate, formatDurationMinutes } from '../list/model.js';
import { formatQuantity, type RecipeDetailViewProps } from './model.js';

export const RecipeDetailView: FC<RecipeDetailViewProps> = ({ recipe }) => {
    const { list, detail } = useMessages(recipeMessages);
    const badges = [...(recipe.cuisine ? [recipe.cuisine] : []), ...recipe.dietaryFlags, ...recipe.tags];

    return (
        <article aria-label={recipe.title}>
            <header>
                <h1>{recipe.title}</h1>
                {badges.length > 0 && (
                    <ul aria-label={`${recipe.title} tags`}>
                        {badges.map((badge) => (
                            <li key={badge}>{badge}</li>
                        ))}
                    </ul>
                )}
                <p>{recipe.description}</p>
            </header>

            <dl>
                <div>
                    <dt>{detail.prepLabel}</dt>
                    <dd>{formatDurationMinutes(recipe.prepTimeMinutes, list.durationMinutes)}</dd>
                </div>
                <div>
                    <dt>{detail.cookLabel}</dt>
                    <dd>{formatDurationMinutes(recipe.cookTimeMinutes, list.durationMinutes)}</dd>
                </div>
                <div>
                    <dt>{detail.totalLabel}</dt>
                    <dd>{formatDurationMinutes(recipe.totalTimeMinutes, list.durationMinutes)}</dd>
                </div>
                <div>
                    <dt>{detail.servingsLabel}</dt>
                    <dd>{recipe.servings}</dd>
                </div>
            </dl>

            {recipe.photos.length > 0 && (
                <ul aria-label={detail.photosLabel}>
                    {recipe.photos.map((photo, index) => (
                        <li key={photo.id}>
                            <img
                                src={photo.url}
                                alt={fillTemplate(detail.photoAlt, { title: recipe.title, index: index + 1 })}
                            />
                        </li>
                    ))}
                </ul>
            )}

            <section aria-label={detail.ingredientsHeading}>
                <h2>{detail.ingredientsHeading}</h2>
                <ul>
                    {recipe.ingredients.map((ingredient) => (
                        <li key={ingredient.ingredientId}>
                            <span>{formatQuantity(ingredient.quantity, ingredient.unit)}</span>{' '}
                            <span>{ingredient.name}</span>
                            {ingredient.notes !== undefined && ingredient.notes.length > 0 && (
                                <span>{ingredient.notes}</span>
                            )}
                            {ingredient.isUserEntered && <span>{detail.userEnteredBadge}</span>}
                        </li>
                    ))}
                </ul>
            </section>

            <section aria-label={detail.instructionsHeading}>
                <h2>{detail.instructionsHeading}</h2>
                <ol>
                    {recipe.steps.map((step) => (
                        <li key={step.stepNumber}>
                            <span>{step.instruction}</span>
                            {step.timerSeconds !== undefined && (
                                <span>{fillTemplate(detail.stepTimer, { seconds: step.timerSeconds })}</span>
                            )}
                        </li>
                    ))}
                </ol>
            </section>

            <section aria-label={detail.nutritionHeading}>
                <h2>{detail.nutritionHeading}</h2>
                <dl>
                    <div>
                        <dt>{detail.caloriesLabel}</dt>
                        <dd>{recipe.nutrition.calories}</dd>
                    </div>
                    <div>
                        <dt>{detail.proteinLabel}</dt>
                        <dd>{fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.proteinG })}</dd>
                    </div>
                    <div>
                        <dt>{detail.carbsLabel}</dt>
                        <dd>{fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.carbsG })}</dd>
                    </div>
                    <div>
                        <dt>{detail.fatLabel}</dt>
                        <dd>{fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.fatG })}</dd>
                    </div>
                </dl>
                {!recipe.nutrition.isComplete && <p>{detail.nutritionPartial}</p>}
            </section>
        </article>
    );
};
