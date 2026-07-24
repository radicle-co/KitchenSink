/**
 * @module @commise/features-recipes — web recipe form field GROUPS (w3), extracted from `RecipeForm.tsx`
 * (T067) so the SAME field markup can be composed two ways: inside `RecipeForm`'s single `<form>` (unchanged
 * behavior, unchanged accessible names/DOM — every existing `RecipeForm` test keeps passing unmodified) AND,
 * one-for-one, as the 4-step edit wizard's step bodies (`wizard/Wizard.tsx`). This is the "extract shared
 * field groups from RecipeForm rather than duplicating" seam the wizard plan calls for — no field is
 * rewritten here, only relocated out of `RecipeForm.tsx` into its own named, independently-composable leaf.
 *
 * Four groups, matching the wizard's 4 steps one-to-one: {@link RecipeBasicsFields} (step 1 minus
 * visibility), {@link RecipeVisibilityField} (also step 1 — split out because the wireframe's step-1 field
 * list and `RecipeForm`'s original layout both treat it as its own control, not part of the "Basics" card),
 * {@link RecipeIngredientsFields} (step 2 — the ingredient list; the picker itself stays app-owned and is
 * composed alongside this by the container/wizard-step, exactly as it already is in `RecipeForm`'s
 * composing containers today), {@link RecipeInstructionsFields} (step 3).
 */
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { fillTemplate } from '../list/model.js';
import { PlusIcon, TrashIcon } from './icons.js';
import { computeTotalTime, lineCalories, recipeNutritionTotal } from './model.js';
import { recipeFormMessages } from './messages.js';
import {
    addIngredient,
    addStep,
    difficultyOptions,
    parseCommaList,
    parseNumericInput,
    removeIngredientAt,
    removeStepAt,
    resolutionStatusLabel,
    setDifficulty,
    updateIngredientAt,
    updateStepAt,
    type RecipeFormSectionProps,
} from './props.js';

const sectionCard = 'flex flex-col gap-4 rounded-2xl bg-card p-6 shadow-sm';
const sectionHeading = 'font-display text-heading-md font-semibold text-charcoal';
const fieldLabel = 'text-body-sm font-medium text-slate';
const field =
    'w-full rounded-lg border border-border bg-white px-3 py-2 text-body-md text-charcoal outline-none focus:ring-2 focus:ring-seafoam-light';
const rowField = `${field} min-w-0 flex-1`;
const errorText = 'text-body-sm text-error';
const difficultyChip =
    'relative flex cursor-pointer items-center rounded-full border border-border bg-white px-4 py-1.5 text-body-sm text-charcoal transition focus-within:ring-2 focus-within:ring-seafoam-light';
// The radio input is a transparent overlay covering its whole chip (not `sr-only`), so the semantic control
// is itself the click/tap target — directly actionable for pointer users and E2E (`getByRole('radio')`),
// while the visible chip text renders beneath. `sr-only` would shrink it to a 1px point the visible label
// then overlays, which pointer-based drivers (Playwright) cannot reach.
const difficultyRadioOverlay = 'absolute inset-0 cursor-pointer opacity-0';
const difficultyChipSelected = 'border-seafoam bg-seafoam text-white';

/** Step 1 (minus visibility): title, description, cuisine, tags, dietary flags, servings, prep/cook time, the read-only computed total, and difficulty. */
export const RecipeBasicsFields: FC<RecipeFormSectionProps> = ({ values, errors, onChange }) => {
    const m = useMessages(recipeFormMessages);
    const totalTime = computeTotalTime(values.prepTimeMinutes, values.cookTimeMinutes);

    return (
        <section aria-label={m.basicsHeading} className={sectionCard}>
            <h2 className={sectionHeading}>{m.basicsHeading}</h2>
            <label className="flex flex-col gap-1">
                <span className={fieldLabel}>{m.titleLabel}</span>
                <input
                    type="text"
                    aria-label={m.titleLabel}
                    placeholder={m.titlePlaceholder}
                    value={values.title}
                    onChange={(event) => onChange({ ...values, title: event.target.value })}
                    className={field}
                />
            </label>
            {errors?.title !== undefined && (
                <p className={errorText} role="alert">
                    {m.errors[errors.title]}
                </p>
            )}
            <label className="flex flex-col gap-1">
                <span className={fieldLabel}>{m.descriptionLabel}</span>
                <textarea
                    aria-label={m.descriptionLabel}
                    value={values.description}
                    onChange={(event) => onChange({ ...values, description: event.target.value })}
                    className={`${field} min-h-24 resize-y`}
                />
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                    <span className={fieldLabel}>{m.cuisineLabel}</span>
                    <input
                        type="text"
                        aria-label={m.cuisineLabel}
                        value={values.cuisine}
                        onChange={(event) => onChange({ ...values, cuisine: event.target.value })}
                        className={field}
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className={fieldLabel}>{m.tagsLabel}</span>
                    <input
                        type="text"
                        aria-label={m.tagsLabel}
                        placeholder={m.tagsHint}
                        value={values.tags.join(', ')}
                        onChange={(event) => onChange({ ...values, tags: parseCommaList(event.target.value) })}
                        className={field}
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className={fieldLabel}>{m.dietaryFlagsLabel}</span>
                    <input
                        type="text"
                        aria-label={m.dietaryFlagsLabel}
                        placeholder={m.tagsHint}
                        value={values.dietaryFlags.join(', ')}
                        onChange={(event) => onChange({ ...values, dietaryFlags: parseCommaList(event.target.value) })}
                        className={field}
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className={fieldLabel}>{m.servingsLabel}</span>
                    <input
                        type="number"
                        aria-label={m.servingsLabel}
                        value={String(values.servings)}
                        onChange={(event) => onChange({ ...values, servings: parseNumericInput(event.target.value) })}
                        className={field}
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className={fieldLabel}>{m.prepTimeLabel}</span>
                    <input
                        type="number"
                        aria-label={m.prepTimeLabel}
                        value={String(values.prepTimeMinutes)}
                        onChange={(event) =>
                            onChange({ ...values, prepTimeMinutes: parseNumericInput(event.target.value) })
                        }
                        className={field}
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className={fieldLabel}>{m.cookTimeLabel}</span>
                    <input
                        type="number"
                        aria-label={m.cookTimeLabel}
                        value={String(values.cookTimeMinutes)}
                        onChange={(event) =>
                            onChange({ ...values, cookTimeMinutes: parseNumericInput(event.target.value) })
                        }
                        className={field}
                    />
                </label>
            </div>
            <div className="flex flex-col gap-1">
                <span id="recipe-difficulty-label" className={fieldLabel}>
                    {m.difficultyLabel}
                </span>
                <div role="radiogroup" aria-labelledby="recipe-difficulty-label" className="flex flex-wrap gap-2">
                    {difficultyOptions(m).map((option) => {
                        const selected = values.difficulty === option.value;

                        return (
                            <label
                                key={option.label}
                                className={`${difficultyChip} ${selected ? difficultyChipSelected : ''}`}
                            >
                                <input
                                    type="radio"
                                    name="recipe-difficulty"
                                    aria-label={option.label}
                                    checked={selected}
                                    onChange={() => onChange(setDifficulty(values, option.value))}
                                    className={difficultyRadioOverlay}
                                />
                                <span>{option.label}</span>
                            </label>
                        );
                    })}
                </div>
            </div>
            {errors?.servings !== undefined && (
                <p className={errorText} role="alert">
                    {m.errors[errors.servings]}
                </p>
            )}
            {errors?.times !== undefined && (
                <p className={errorText} role="alert">
                    {m.errors[errors.times]}
                </p>
            )}
            <p className="text-body-sm text-slate">
                <span className="font-medium">{m.totalTimeLabel}</span>{' '}
                <span className="font-semibold text-charcoal">
                    {fillTemplate(m.durationMinutes, { minutes: totalTime })}
                </span>
            </p>
        </section>
    );
};

/** Step 2: the dynamic ingredient list (the ingredient typeahead/picker itself is app-owned and composed alongside this). */
export const RecipeIngredientsFields: FC<RecipeFormSectionProps> = ({ values, errors, onChange }) => {
    const m = useMessages(recipeFormMessages);
    const total = recipeNutritionTotal(values);

    const ingredientRows: ReactElement[] = values.ingredients.map((line, index) => {
        const number = index + 1;
        const calories = lineCalories(line);

        return (
            <li key={index} className="flex flex-wrap items-center gap-2">
                <input
                    type="text"
                    aria-label={fillTemplate(m.ingredientNameLabel, { number })}
                    value={line.name}
                    onChange={(event) => onChange(updateIngredientAt(values, index, { name: event.target.value }))}
                    className={rowField}
                />
                <input
                    type="number"
                    aria-label={fillTemplate(m.ingredientQuantityLabel, { number })}
                    value={String(line.quantity)}
                    onChange={(event) =>
                        onChange(updateIngredientAt(values, index, { quantity: parseNumericInput(event.target.value) }))
                    }
                    className={`${field} w-24`}
                />
                <input
                    type="text"
                    aria-label={fillTemplate(m.ingredientUnitLabel, { number })}
                    value={line.unit ?? ''}
                    onChange={(event) => onChange(updateIngredientAt(values, index, { unit: event.target.value }))}
                    className={`${field} w-28`}
                />
                {line.resolutionStatus !== undefined && (
                    <span
                        aria-label={fillTemplate(m.ingredientStatusLabel, { number })}
                        className="rounded-full bg-pearl px-2 py-0.5 text-caption text-slate"
                    >
                        {resolutionStatusLabel(m, line.resolutionStatus)}
                    </span>
                )}
                {calories !== undefined && (
                    <span className="rounded-full bg-seafoam/10 px-2 py-0.5 text-caption font-medium text-seafoam">
                        {fillTemplate(m.ingredientCaloriesTemplate, { calories })}
                    </span>
                )}
                <Button
                    variant="destructive"
                    icon={<TrashIcon />}
                    onPress={() => onChange(removeIngredientAt(values, index))}
                >
                    {fillTemplate(m.removeIngredient, { number })}
                </Button>
            </li>
        );
    });

    return (
        <section aria-label={m.ingredientsHeading} className={sectionCard}>
            <h2 className={sectionHeading}>{m.ingredientsHeading}</h2>
            {errors?.ingredients !== undefined && (
                <p className={errorText} role="alert">
                    {m.errors[errors.ingredients]}
                </p>
            )}
            {ingredientRows.length === 0 ? (
                <p className="text-body-sm text-slate">{m.noIngredients}</p>
            ) : (
                <ul className="flex flex-col gap-3">{ingredientRows}</ul>
            )}
            <div className="self-start">
                <Button variant="secondary" icon={<PlusIcon />} onPress={() => onChange(addIngredient(values))}>
                    {m.addIngredient}
                </Button>
            </div>
            <div className="flex flex-col gap-1 rounded-xl bg-pearl/60 px-4 py-3">
                <p className="text-body-sm font-medium text-charcoal">
                    {fillTemplate(m.nutritionTotalTemplate, {
                        calories: total.calories,
                        protein: total.proteinG,
                        carbs: total.carbsG,
                        fat: total.fatG,
                    })}
                </p>
                {!total.isComplete && <p className="text-caption text-slate">{m.nutritionPartialNotice}</p>}
            </div>
        </section>
    );
};

/** Step 3: the dynamic instruction-step list. */
export const RecipeInstructionsFields: FC<RecipeFormSectionProps> = ({ values, errors, onChange }) => {
    const m = useMessages(recipeFormMessages);

    const stepRows: ReactElement[] = values.steps.map((step, index) => {
        const number = index + 1;

        return (
            <li key={index} className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-seafoam text-body-sm font-semibold text-white">
                    {number}
                </span>
                <input
                    type="text"
                    aria-label={fillTemplate(m.stepInstructionLabel, { number })}
                    value={step.instruction}
                    onChange={(event) => onChange(updateStepAt(values, index, { instruction: event.target.value }))}
                    className={rowField}
                />
                <input
                    type="number"
                    aria-label={fillTemplate(m.stepTimerLabel, { number })}
                    value={step.timerSeconds === undefined ? '' : String(step.timerSeconds)}
                    onChange={(event) => {
                        const raw = event.target.value.trim();
                        onChange(
                            updateStepAt(values, index, {
                                timerSeconds: raw === '' ? undefined : parseNumericInput(raw),
                            }),
                        );
                    }}
                    className={`${field} w-28`}
                />
                <Button
                    variant="destructive"
                    icon={<TrashIcon />}
                    onPress={() => onChange(removeStepAt(values, index))}
                >
                    {fillTemplate(m.removeStep, { number })}
                </Button>
            </li>
        );
    });

    return (
        <section aria-label={m.stepsHeading} className={sectionCard}>
            <h2 className={sectionHeading}>{m.stepsHeading}</h2>
            {errors?.steps !== undefined && (
                <p className={errorText} role="alert">
                    {m.errors[errors.steps]}
                </p>
            )}
            {stepRows.length === 0 ? (
                <p className="text-body-sm text-slate">{m.noSteps}</p>
            ) : (
                <ol className="flex flex-col gap-3">{stepRows}</ol>
            )}
            <div className="self-start">
                <Button variant="secondary" icon={<PlusIcon />} onPress={() => onChange(addStep(values))}>
                    {m.addStep}
                </Button>
            </div>
        </section>
    );
};

/** The private-visibility toggle — its own field (step 1) per the original `RecipeForm` layout. */
export const RecipeVisibilityField: FC<Omit<RecipeFormSectionProps, 'errors'>> = ({ values, onChange }) => {
    const m = useMessages(recipeFormMessages);

    return (
        <label className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-sm">
            <input
                type="checkbox"
                aria-label={m.visibilityLabel}
                checked={values.visibility === 'private'}
                onChange={(event) => onChange({ ...values, visibility: event.target.checked ? 'private' : 'public' })}
                className="size-5 accent-seafoam"
            />
            <span className="text-body-md text-charcoal">{m.visibilityLabel}</span>
        </label>
    );
};
