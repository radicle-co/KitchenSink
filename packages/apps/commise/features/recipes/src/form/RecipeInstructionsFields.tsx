/**
 * @module @commise/features-recipes/form — `RecipeInstructionsFields` (web): step 3 of the recipe form, the
 * dynamic instruction-step list.
 *
 * One of the four field GROUPS (T067, w3), each a step body of the 4-step edit wizard (`wizard/Wizard.tsx`).
 */
import { Button } from '@commise/ui/button';
import { DurationField } from '@commise/ui/duration-field';
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { errorText, field, sectionCard, sectionHeading } from './formSectionStyles.js';
import { fillTemplate } from '../list/model.js';
import { recipeFormMessages } from './messages.js';
import { stepsErrorId } from './fieldErrorIds.js';
import { applyDraftAction, type RecipeFormSectionProps } from './props.js';

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
            // I1: the row WRAPS and the instruction field takes a whole line, so at 320 px it is never squeezed beside
            // the timer and Remove (it was about 12 px wide). The same row shape as the native leaf's.
            <li key={index} className="flex flex-wrap items-end gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action text-body-sm font-semibold text-on-action">
                    {number}
                </span>
                <input
                    type="text"
                    aria-label={fillTemplate(m.stepInstructionLabel, { number })}
                    aria-invalid={instructionInvalid || undefined}
                    aria-describedby={instructionInvalid ? stepsErrorId : undefined}
                    value={step.instruction}
                    onChange={(event) =>
                        onChange(
                            applyDraftAction(values, {
                                kind: 'updateStepAt',
                                index,
                                patch: { instruction: event.target.value },
                            }),
                        )
                    }
                    className={`${field} min-w-0 basis-full`}
                />
                {/* F1: entered in hours and minutes, stored in seconds as before. */}
                <DurationField
                    label={m.timerLabel}
                    hoursLabel={fillTemplate(m.stepTimerHoursLabel, { number })}
                    minutesLabel={fillTemplate(m.stepTimerMinutesLabel, { number })}
                    hoursUnit={m.timerHoursUnit}
                    minutesUnit={m.timerMinutesUnit}
                    value={step.timerSeconds}
                    onChange={(timerSeconds) =>
                        onChange(applyDraftAction(values, { kind: 'updateStepAt', index, patch: { timerSeconds } }))
                    }
                />
                <Button
                    variant="destructive"
                    icon="trash"
                    onPress={() => onChange(applyDraftAction(values, { kind: 'removeAt', field: 'steps', index }))}
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
                <p className="text-body-sm text-ink-muted">{m.noSteps}</p>
            ) : (
                <ol className="flex flex-col gap-3">{stepRows}</ol>
            )}
            <div className="self-start">
                <Button
                    variant="secondary"
                    icon="plus"
                    onPress={() => onChange(applyDraftAction(values, { kind: 'addStep' }))}
                >
                    {m.addStep}
                </Button>
            </div>
        </section>
    );
};
