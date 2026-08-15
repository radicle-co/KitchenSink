/**
 * @module @commise/features-recipes/form — `RecipeBasicsFields` (web): step 1 of the recipe form, minus
 * visibility. Title, description, cuisine, tags, dietary flags, servings, prep/cook time, the read-only
 * computed total, and difficulty.
 *
 * One of the four field GROUPS extracted from `RecipeForm.tsx` (T067, w3) so the SAME field markup composes
 * two ways with unchanged behavior and unchanged accessible names/DOM: inside `RecipeForm`'s single `<form>`,
 * and — one-for-one — as a step body of the 4-step edit wizard (`wizard/Wizard.tsx`). Nothing here is
 * rewritten; it is the original markup relocated into its own named, independently-composable leaf.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { ChipInput } from './ChipInput.js';
import { errorText, field, sectionCard, sectionHeading } from './formSectionStyles.js';
import { fillTemplate } from '../list/model.js';
import { computeTotalTime, DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from './model.js';
import { recipeFormMessages } from './messages.js';
import { servingsErrorId, timesErrorId, titleErrorId } from './fieldErrorIds.js';
import {
    cuisineOptions,
    difficultyOptions,
    parseNumericInput,
    setDifficulty,
    type RecipeFormSectionProps,
} from './props.js';

const caption = 'text-caption text-slate';
const fieldLabel = 'text-body-sm font-medium text-slate';
// Layout and state-independent chrome ONLY — deliberately carries no `bg-*`, `text-<colour>`, or
// `border-<colour>` utility. Those live in the two mutually-exclusive state consts below.
//
// DO NOT fold the resting colours back in here and override them conditionally. Tailwind orders utilities by
// its own EMISSION order, NOT by the order they appear in the class attribute, so `base + override` resolves
// to whichever utility Tailwind happened to emit last. That is not hypothetical: this chip shipped with
// `bg-white`(base) beating `bg-seafoam`(selected) while `text-white`(selected) beat `text-charcoal`(base),
// rendering the selected label white-on-white in every browser — and because "Not stated" carries
// `value: undefined`, `undefined === undefined` made a FRESH form open with a blank pill.
const difficultyChipBase =
    'relative flex cursor-pointer items-center rounded-full border px-4 py-1.5 text-body-sm transition focus-within:ring-2 focus-within:ring-seafoam';
// The radio input is a transparent overlay covering its whole chip (not `sr-only`), so the semantic control
// is itself the click/tap target — directly actionable for pointer users and E2E (`getByRole('radio')`),
// while the visible chip text renders beneath. `sr-only` would shrink it to a 1px point the visible label
// then overlays, which pointer-based drivers (Playwright) cannot reach.
const difficultyRadioOverlay = 'absolute inset-0 cursor-pointer opacity-0';
const difficultyChipResting = 'border-border bg-white text-charcoal';
const difficultyChipSelected = 'border-seafoam bg-seafoam text-white';

/** Step 1 (minus visibility): title, description, cuisine, tags, dietary flags, servings, prep/cook time, the read-only computed total, and difficulty. */
export const RecipeBasicsFields: FC<RecipeFormSectionProps> = ({ values, errors, onChange }) => {
    const m = useMessages(recipeFormMessages);
    const totalTime = computeTotalTime(values.prepTimeMinutes, values.cookTimeMinutes);
    const titleInvalid = errors?.title !== undefined;
    const servingsInvalid = errors?.servings !== undefined;
    const timesInvalid = errors?.times !== undefined;

    return (
        <section aria-label={m.basicsHeading} className={sectionCard}>
            <h2 className={sectionHeading}>{m.basicsHeading}</h2>
            <label className="flex flex-col gap-1">
                <span className={fieldLabel}>{m.titleLabel}</span>
                <input
                    type="text"
                    aria-label={m.titleLabel}
                    aria-invalid={titleInvalid || undefined}
                    aria-describedby={titleInvalid ? titleErrorId : undefined}
                    placeholder={m.titlePlaceholder}
                    value={values.title}
                    maxLength={TITLE_MAX_LENGTH}
                    onChange={(event) => onChange({ ...values, title: event.target.value })}
                    className={field}
                />
                <span className={caption}>
                    {fillTemplate(m.charCounterTemplate, { count: values.title.length, max: TITLE_MAX_LENGTH })}
                </span>
            </label>
            {errors?.title !== undefined && (
                <p id={titleErrorId} className={errorText} role="alert">
                    {m.errors[errors.title]}
                </p>
            )}
            <label className="flex flex-col gap-1">
                <span className={fieldLabel}>{m.descriptionLabel}</span>
                <textarea
                    aria-label={m.descriptionLabel}
                    value={values.description}
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    onChange={(event) => onChange({ ...values, description: event.target.value })}
                    className={`${field} min-h-24 resize-y`}
                />
                <span className={caption}>
                    {fillTemplate(m.charCounterTemplate, {
                        count: values.description.length,
                        max: DESCRIPTION_MAX_LENGTH,
                    })}
                </span>
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                    <span className={fieldLabel}>{m.cuisineLabel}</span>
                    <select
                        aria-label={m.cuisineLabel}
                        value={values.cuisine}
                        onChange={(event) => onChange({ ...values, cuisine: event.target.value })}
                        className={field}
                    >
                        {cuisineOptions(values.cuisine, m).map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
                <ChipInput
                    label={m.tagsLabel}
                    values={values.tags}
                    onChange={(tags) => onChange({ ...values, tags })}
                    placeholder={m.tagsHint}
                    removeChipLabel={m.removeChipLabel}
                />
                <ChipInput
                    label={m.dietaryFlagsLabel}
                    values={values.dietaryFlags}
                    onChange={(dietaryFlags) => onChange({ ...values, dietaryFlags })}
                    placeholder={m.tagsHint}
                    removeChipLabel={m.removeChipLabel}
                />
                <label className="flex flex-col gap-1">
                    <span className={fieldLabel}>{m.servingsLabel}</span>
                    <input
                        type="number"
                        aria-label={m.servingsLabel}
                        aria-invalid={servingsInvalid || undefined}
                        aria-describedby={servingsInvalid ? servingsErrorId : undefined}
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
                        aria-invalid={timesInvalid || undefined}
                        aria-describedby={timesInvalid ? timesErrorId : undefined}
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
                        aria-invalid={timesInvalid || undefined}
                        aria-describedby={timesInvalid ? timesErrorId : undefined}
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
                                className={`${difficultyChipBase} ${selected ? difficultyChipSelected : difficultyChipResting}`}
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
                <p id={servingsErrorId} className={errorText} role="alert">
                    {m.errors[errors.servings]}
                </p>
            )}
            {errors?.times !== undefined && (
                <p id={timesErrorId} className={errorText} role="alert">
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
