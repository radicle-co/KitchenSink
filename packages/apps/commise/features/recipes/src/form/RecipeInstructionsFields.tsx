/**
 * @module @commise/features-recipes/form — `RecipeInstructionsFields` (web): step 3 of the recipe form, the
 * dynamic instruction-step list.
 *
 * One of the four field GROUPS extracted from `RecipeForm.tsx` (T067, w3) so the SAME field markup composes
 * two ways with unchanged behavior and unchanged accessible names/DOM: inside `RecipeForm`'s single `<form>`,
 * and — one-for-one — as a step body of the 4-step edit wizard (`wizard/Wizard.tsx`).
 */
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { errorText, field, rowField, sectionCard, sectionHeading } from './formSectionStyles.js';
import { fillTemplate } from '../list/model.js';
import { PlusIcon, TrashIcon } from './icons.js';
import { recipeFormMessages } from './messages.js';
import { stepsErrorId } from './fieldErrorIds.js';
import { addStep, parseNumericInput, removeStepAt, updateStepAt, type RecipeFormSectionProps } from './props.js';

/** Step 3: the dynamic instruction-step list. */
export const RecipeInstructionsFields: FC<RecipeFormSectionProps> = ({ values, errors, onChange }) => {
    const m = useMessages(recipeFormMessages);
    // B8: mirrors the ingredients section — a step is marked invalid only when it is ITSELF the reason
    // `errors.steps` is set (a blank instruction), never every row on a `stepsRequired` (empty-list) error.
    const stepsInvalid = errors?.steps !== undefined;

    const stepRows: ReactElement[] = values.steps.map((step, index) => {
        const number = index + 1;
        const instructionInvalid = stepsInvalid && step.instruction.trim() === '';

        return (
            <li key={index} className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-seafoam text-body-sm font-semibold text-white">
                    {number}
                </span>
                <input
                    type="text"
                    aria-label={fillTemplate(m.stepInstructionLabel, { number })}
                    aria-invalid={instructionInvalid || undefined}
                    aria-describedby={instructionInvalid ? stepsErrorId : undefined}
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
                    {/* Icon-only on cramped phone rows (`sr-only`), full label from sm up — see the ingredient
                        remove control in `RecipeIngredientsFields.tsx`. */}
                    <span className="sr-only sm:not-sr-only">{fillTemplate(m.removeStep, { number })}</span>
                </Button>
            </li>
        );
    });

    return (
        <section aria-label={m.stepsHeading} className={sectionCard}>
            <h2 className={sectionHeading}>{m.stepsHeading}</h2>
            {errors?.steps !== undefined && (
                <p id={stepsErrorId} className={errorText} role="alert">
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
