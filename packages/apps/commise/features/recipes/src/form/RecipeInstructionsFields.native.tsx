/**
 * @module @commise/features-recipes/form — `RecipeInstructionsFields` (native): step 3 of the recipe form,
 * the dynamic instruction-step list.
 *
 * The React Native leaf of `./RecipeInstructionsFields.tsx`: a step body of the 4-step edit wizard
 * (`wizard/Wizard.native.tsx`).
 */
import { Button } from '@commise/ui/button';
import { DurationField } from '@commise/ui/duration-field';
import { useMessages } from '@commise/i18n/react';
import { TextInput } from '@commise/ui/text-input';
import type { FC, ReactElement } from 'react';
import { Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeFormMessages } from './messages.js';
import { stepsErrorId } from './fieldErrorIds.js';
import { styles } from './formSectionStyles.native.js';
import { applyDraftAction, type RecipeFormSectionProps } from './props.js';

/** Step 3: the dynamic instruction-step list. */
export const RecipeInstructionsFields: FC<RecipeFormSectionProps> = ({ values, errors, onChange }) => {
    const m = useMessages(recipeFormMessages);
    // B8: mirrors the web leaf — a step is invalid only when it is ITSELF the reason `errors.steps` is set
    // (a blank instruction), never every row on a `stepsRequired` (empty-list) error.
    const stepsInvalid = errors?.steps !== undefined;

    const stepRows: ReactElement[] = values.steps.map((step, index) => {
        const number = index + 1;
        const instructionInvalid = stepsInvalid && step.instruction.trim() === '';

        return (
            <View key={index} style={styles.listRow}>
                <Text style={styles.stepMarker}>{number}</Text>
                <TextInput
                    accessibilityLabel={fillTemplate(m.stepInstructionLabel, { number })}
                    aria-invalid={instructionInvalid || undefined}
                    aria-describedby={instructionInvalid ? stepsErrorId : undefined}
                    value={step.instruction}
                    onChangeText={(text) =>
                        onChange(
                            applyDraftAction(values, { kind: 'updateStepAt', index, patch: { instruction: text } }),
                        )
                    }
                    style={[styles.input, styles.rowGrow]}
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
                <View style={styles.rowAction}>
                    <Button
                        variant="destructive"
                        icon="trash"
                        onPress={() => onChange(applyDraftAction(values, { kind: 'removeAt', field: 'steps', index }))}
                    >
                        {fillTemplate(m.removeStep, { number })}
                    </Button>
                </View>
            </View>
        );
    });

    return (
        <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {m.stepsHeading}
            </Text>
            {errors?.steps !== undefined && (
                <Text id={stepsErrorId} accessibilityRole="alert" style={styles.error}>
                    {m.errors[errors.steps]}
                </Text>
            )}
            {stepRows.length === 0 ? <Text style={styles.emptyText}>{m.noSteps}</Text> : stepRows}
            <View style={styles.addAction}>
                <Button
                    variant="secondary"
                    icon="plus"
                    onPress={() => onChange(applyDraftAction(values, { kind: 'addStep' }))}
                >
                    {m.addStep}
                </Button>
            </View>
        </View>
    );
};
