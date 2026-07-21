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
 * Styled to the Commise design language (@commise/ui tokens as Tailwind v4 utilities): card sections,
 * rounded seafoam-focused fields with visible labels, and a seafoam primary submit. Every control keeps
 * its `aria-label` so name-based selection (tests, Playwright, Maestro) resolves it unchanged.
 *
 * Photo upload (wireframe step 4) is intentionally OUT OF SCOPE here — a later increment adds it.
 */
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { fillTemplate } from '../list/model.js';
import { CheckIcon, PlusIcon, TrashIcon, XIcon } from './icons.js';
import { computeTotalTime } from './model.js';
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
    type RecipeFormProps,
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

    // The dynamic instruction rows: instruction + optional timer, each row-scoped by its 1-based number.
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
        <form
            aria-label={headingText}
            onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
            }}
            className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8"
        >
            <h1 className="font-display text-display-md font-bold text-charcoal">{headingText}</h1>

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
                            onChange={(event) =>
                                onChange({ ...values, dietaryFlags: parseCommaList(event.target.value) })
                            }
                            className={field}
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className={fieldLabel}>{m.servingsLabel}</span>
                        <input
                            type="number"
                            aria-label={m.servingsLabel}
                            value={String(values.servings)}
                            onChange={(event) =>
                                onChange({ ...values, servings: parseNumericInput(event.target.value) })
                            }
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
            </section>

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

            <label className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-sm">
                <input
                    type="checkbox"
                    aria-label={m.visibilityLabel}
                    checked={values.visibility === 'private'}
                    onChange={(event) =>
                        onChange({ ...values, visibility: event.target.checked ? 'private' : 'public' })
                    }
                    className="size-5 accent-seafoam"
                />
                <span className="text-body-md text-charcoal">{m.visibilityLabel}</span>
            </label>

            <div className="flex items-center gap-3">
                <Button type="submit" icon={<CheckIcon />} busy={submitting}>
                    {submitLabel}
                </Button>
                <Button variant="secondary" icon={<XIcon />} onPress={onCancel}>
                    {m.cancel}
                </Button>
            </div>
        </form>
    );
};
