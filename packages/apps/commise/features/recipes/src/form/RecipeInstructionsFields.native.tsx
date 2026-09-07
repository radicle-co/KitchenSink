/**
 * @module @commise/features-recipes/form — `RecipeInstructionsFields` (native): step 3 of the recipe form,
 * the dynamic instruction-step list.
 *
 * The React Native leaf of `./RecipeInstructionsFields.tsx` — same extraction rationale (see that module's
 * doc): the SAME field markup composes both under `RecipeForm.native.tsx`'s single scroll form (unchanged)
 * and, one-for-one, as a step body of the 4-step edit wizard (`wizard/Wizard.native.tsx`).
 */
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Feather } from '@expo/vector-icons';
import type { FC, ReactElement } from 'react';
import { Text, TextInput, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeFormMessages } from './messages.js';
import { stepsErrorId } from './fieldErrorIds.js';
import { styles } from './formSectionStyles.native.js';
import { addStep, parseNumericInput, removeStepAt, updateStepAt, type RecipeFormSectionProps } from './props.js';

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
                    onChangeText={(text) => onChange(updateStepAt(values, index, { instruction: text }))}
                    style={[styles.input, styles.rowGrow]}
                />
                <TextInput
                    accessibilityLabel={fillTemplate(m.stepTimerLabel, { number })}
                    keyboardType="numeric"
                    value={step.timerSeconds === undefined ? '' : String(step.timerSeconds)}
                    onChangeText={(text) => {
                        const raw = text.trim();
                        onChange(
                            updateStepAt(values, index, {
                                timerSeconds: raw === '' ? undefined : parseNumericInput(raw),
                            }),
                        );
                    }}
                    style={[styles.input, styles.rowNarrow]}
                />
                <View style={styles.rowAction}>
                    <Button
                        variant="destructive"
                        icon={<Feather name="trash-2" size={16} color={palette['error-dark']} />}
                        onPress={() => onChange(removeStepAt(values, index))}
                    >
                        {fillTemplate(m.removeStep, { number })}
                    </Button>
                </View>
            </View>
        );
    });

    return (
        <View accessibilityLabel={m.stepsHeading} style={styles.card}>
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
                    icon={<Feather name="plus" size={16} color={palette.charcoal} />}
                    onPress={() => onChange(addStep(values))}
                >
                    {m.addStep}
                </Button>
            </View>
        </View>
    );
};
