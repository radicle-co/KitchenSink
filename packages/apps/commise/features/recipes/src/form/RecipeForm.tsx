/**
 * @module @commise/features-recipes — web recipe create/edit form (T067 building block).
 *
 * Controlled, presentational editor over the full {@link RecipeFormValues}: Basics (title, description,
 * cuisine, tags, dietary flags, servings, prep/cook time + a READ-ONLY computed total), a dynamic
 * Ingredients list (name/quantity/unit + a resolution-status badge + add/remove), a dynamic Instructions
 * list (instruction + optional timer + add/remove), and a visibility toggle. It fetches nothing and
 * resolves no ingredient — the composing app owns the food-service typeahead and submission; this leaf just
 * renders the current values, surfaces `errors`, and reports every edit up via `onChange`.
 *
 * Photo upload (wireframe step 4) is intentionally OUT OF SCOPE here — a later increment adds it.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { fillTemplate } from '../list/model.js';
import { computeTotalTime } from './model.js';
import { recipeFormMessages } from './messages.js';
import {
    addIngredient,
    addStep,
    parseCommaList,
    parseNumericInput,
    removeIngredientAt,
    removeStepAt,
    resolutionStatusLabel,
    updateIngredientAt,
    updateStepAt,
    type RecipeFormProps,
} from './props.js';

export const RecipeForm: FC<RecipeFormProps> = ({
    values,
    errors,
    mode,
    submitting = false,
    onChange,
    onSubmit,
    onCancel,
}) => {
    const m = useMessages(recipeFormMessages);
    const headingText = mode === 'create' ? m.createHeading : m.editHeading;
    const submitLabel = mode === 'create' ? m.createSubmit : m.editSubmit;
    const totalTime = computeTotalTime(values.prepTimeMinutes, values.cookTimeMinutes);

    // The dynamic ingredient rows: each control carries a 1-based, row-scoped accessible name.
    const ingredientRows: ReactElement[] = values.ingredients.map((line, index) => {
        const number = index + 1;

        return (
            <li key={index}>
                <input
                    type="text"
                    aria-label={fillTemplate(m.ingredientNameLabel, { number })}
                    value={line.name}
                    onChange={(event) => onChange(updateIngredientAt(values, index, { name: event.target.value }))}
                />
                <input
                    type="number"
                    aria-label={fillTemplate(m.ingredientQuantityLabel, { number })}
                    value={String(line.quantity)}
                    onChange={(event) =>
                        onChange(updateIngredientAt(values, index, { quantity: parseNumericInput(event.target.value) }))
                    }
                />
                <input
                    type="text"
                    aria-label={fillTemplate(m.ingredientUnitLabel, { number })}
                    value={line.unit ?? ''}
                    onChange={(event) => onChange(updateIngredientAt(values, index, { unit: event.target.value }))}
                />
                {line.resolutionStatus !== undefined && (
                    <span aria-label={fillTemplate(m.ingredientStatusLabel, { number })}>
                        {resolutionStatusLabel(m, line.resolutionStatus)}
                    </span>
                )}
                <button type="button" onClick={() => onChange(removeIngredientAt(values, index))}>
                    {fillTemplate(m.removeIngredient, { number })}
                </button>
            </li>
        );
    });

    // The dynamic instruction rows: instruction + optional timer, each row-scoped by its 1-based number.
    const stepRows: ReactElement[] = values.steps.map((step, index) => {
        const number = index + 1;

        return (
            <li key={index}>
                <input
                    type="text"
                    aria-label={fillTemplate(m.stepInstructionLabel, { number })}
                    value={step.instruction}
                    onChange={(event) => onChange(updateStepAt(values, index, { instruction: event.target.value }))}
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
                />
                <button type="button" onClick={() => onChange(removeStepAt(values, index))}>
                    {fillTemplate(m.removeStep, { number })}
                </button>
            </li>
        );
    });

    return (
        <form
            aria-label={headingText}
            onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
            }}
        >
            <h1>{headingText}</h1>

            <section aria-label={m.basicsHeading}>
                <h2>{m.basicsHeading}</h2>
                <input
                    type="text"
                    aria-label={m.titleLabel}
                    placeholder={m.titlePlaceholder}
                    value={values.title}
                    onChange={(event) => onChange({ ...values, title: event.target.value })}
                />
                {errors?.title !== undefined && <p role="alert">{errors.title}</p>}
                <textarea
                    aria-label={m.descriptionLabel}
                    value={values.description}
                    onChange={(event) => onChange({ ...values, description: event.target.value })}
                />
                <input
                    type="text"
                    aria-label={m.cuisineLabel}
                    value={values.cuisine}
                    onChange={(event) => onChange({ ...values, cuisine: event.target.value })}
                />
                <input
                    type="text"
                    aria-label={m.tagsLabel}
                    placeholder={m.tagsHint}
                    value={values.tags.join(', ')}
                    onChange={(event) => onChange({ ...values, tags: parseCommaList(event.target.value) })}
                />
                <input
                    type="text"
                    aria-label={m.dietaryFlagsLabel}
                    placeholder={m.tagsHint}
                    value={values.dietaryFlags.join(', ')}
                    onChange={(event) => onChange({ ...values, dietaryFlags: parseCommaList(event.target.value) })}
                />
                <input
                    type="number"
                    aria-label={m.servingsLabel}
                    value={String(values.servings)}
                    onChange={(event) => onChange({ ...values, servings: parseNumericInput(event.target.value) })}
                />
                {errors?.servings !== undefined && <p role="alert">{errors.servings}</p>}
                <input
                    type="number"
                    aria-label={m.prepTimeLabel}
                    value={String(values.prepTimeMinutes)}
                    onChange={(event) =>
                        onChange({ ...values, prepTimeMinutes: parseNumericInput(event.target.value) })
                    }
                />
                <input
                    type="number"
                    aria-label={m.cookTimeLabel}
                    value={String(values.cookTimeMinutes)}
                    onChange={(event) =>
                        onChange({ ...values, cookTimeMinutes: parseNumericInput(event.target.value) })
                    }
                />
                {errors?.times !== undefined && <p role="alert">{errors.times}</p>}
                <p>
                    <span>{m.totalTimeLabel}</span>{' '}
                    <span>{fillTemplate(m.durationMinutes, { minutes: totalTime })}</span>
                </p>
            </section>

            <section aria-label={m.ingredientsHeading}>
                <h2>{m.ingredientsHeading}</h2>
                {errors?.ingredients !== undefined && <p role="alert">{errors.ingredients}</p>}
                {ingredientRows.length === 0 ? <p>{m.noIngredients}</p> : <ul>{ingredientRows}</ul>}
                <button type="button" onClick={() => onChange(addIngredient(values))}>
                    {m.addIngredient}
                </button>
            </section>

            <section aria-label={m.stepsHeading}>
                <h2>{m.stepsHeading}</h2>
                {errors?.steps !== undefined && <p role="alert">{errors.steps}</p>}
                {stepRows.length === 0 ? <p>{m.noSteps}</p> : <ol>{stepRows}</ol>}
                <button type="button" onClick={() => onChange(addStep(values))}>
                    {m.addStep}
                </button>
            </section>

            <label>
                <input
                    type="checkbox"
                    aria-label={m.visibilityLabel}
                    checked={values.visibility === 'private'}
                    onChange={(event) =>
                        onChange({ ...values, visibility: event.target.checked ? 'private' : 'public' })
                    }
                />
                {m.visibilityLabel}
            </label>

            <button type="submit" disabled={submitting} aria-busy={submitting}>
                {submitLabel}
            </button>
            <button type="button" onClick={onCancel}>
                {m.cancel}
            </button>
        </form>
    );
};
