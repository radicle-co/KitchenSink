/**
 * @module @commise/features-recipes — native recipe create/edit form (T067 building block).
 *
 * The React Native leaf of {@link import('./RecipeForm.js').RecipeForm} — same controlled, presentational
 * contract and the same sections (Basics with a READ-ONLY computed total, a dynamic Ingredients list with
 * per-line resolution-status badges + add/remove, a dynamic Instructions list + add/remove, and a
 * visibility toggle), rendered with RN primitives. It fetches nothing and resolves no ingredient.
 *
 * Photo upload (wireframe step 4) is intentionally OUT OF SCOPE here — a later increment adds it.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';

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

    const ingredientRows: ReactElement[] = values.ingredients.map((line, index) => {
        const number = index + 1;

        return (
            <View key={index}>
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientNameLabel, { number })}
                    value={line.name}
                    onChangeText={(text) => onChange(updateIngredientAt(values, index, { name: text }))}
                />
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientQuantityLabel, { number })}
                    keyboardType="numeric"
                    value={String(line.quantity)}
                    onChangeText={(text) =>
                        onChange(updateIngredientAt(values, index, { quantity: parseNumericInput(text) }))
                    }
                />
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientUnitLabel, { number })}
                    value={line.unit ?? ''}
                    onChangeText={(text) => onChange(updateIngredientAt(values, index, { unit: text }))}
                />
                {line.resolutionStatus !== undefined && (
                    <Text accessibilityLabel={fillTemplate(m.ingredientStatusLabel, { number })}>
                        {resolutionStatusLabel(m, line.resolutionStatus)}
                    </Text>
                )}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fillTemplate(m.removeIngredient, { number })}
                    onPress={() => onChange(removeIngredientAt(values, index))}
                >
                    <Text>{fillTemplate(m.removeIngredient, { number })}</Text>
                </Pressable>
            </View>
        );
    });

    const stepRows: ReactElement[] = values.steps.map((step, index) => {
        const number = index + 1;

        return (
            <View key={index}>
                <TextInput
                    accessibilityLabel={fillTemplate(m.stepInstructionLabel, { number })}
                    value={step.instruction}
                    onChangeText={(text) => onChange(updateStepAt(values, index, { instruction: text }))}
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
                />
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fillTemplate(m.removeStep, { number })}
                    onPress={() => onChange(removeStepAt(values, index))}
                >
                    <Text>{fillTemplate(m.removeStep, { number })}</Text>
                </Pressable>
            </View>
        );
    });

    return (
        <View accessibilityLabel={headingText}>
            <Text accessibilityRole="header">{headingText}</Text>

            <View accessibilityLabel={m.basicsHeading}>
                <Text accessibilityRole="header">{m.basicsHeading}</Text>
                <TextInput
                    accessibilityLabel={m.titleLabel}
                    placeholder={m.titlePlaceholder}
                    value={values.title}
                    onChangeText={(text) => onChange({ ...values, title: text })}
                />
                {errors?.title !== undefined && <Text accessibilityRole="alert">{errors.title}</Text>}
                <TextInput
                    accessibilityLabel={m.descriptionLabel}
                    multiline
                    value={values.description}
                    onChangeText={(text) => onChange({ ...values, description: text })}
                />
                <TextInput
                    accessibilityLabel={m.cuisineLabel}
                    value={values.cuisine}
                    onChangeText={(text) => onChange({ ...values, cuisine: text })}
                />
                <TextInput
                    accessibilityLabel={m.tagsLabel}
                    placeholder={m.tagsHint}
                    value={values.tags.join(', ')}
                    onChangeText={(text) => onChange({ ...values, tags: parseCommaList(text) })}
                />
                <TextInput
                    accessibilityLabel={m.dietaryFlagsLabel}
                    placeholder={m.tagsHint}
                    value={values.dietaryFlags.join(', ')}
                    onChangeText={(text) => onChange({ ...values, dietaryFlags: parseCommaList(text) })}
                />
                <TextInput
                    accessibilityLabel={m.servingsLabel}
                    keyboardType="numeric"
                    value={String(values.servings)}
                    onChangeText={(text) => onChange({ ...values, servings: parseNumericInput(text) })}
                />
                {errors?.servings !== undefined && <Text accessibilityRole="alert">{errors.servings}</Text>}
                <TextInput
                    accessibilityLabel={m.prepTimeLabel}
                    keyboardType="numeric"
                    value={String(values.prepTimeMinutes)}
                    onChangeText={(text) => onChange({ ...values, prepTimeMinutes: parseNumericInput(text) })}
                />
                <TextInput
                    accessibilityLabel={m.cookTimeLabel}
                    keyboardType="numeric"
                    value={String(values.cookTimeMinutes)}
                    onChangeText={(text) => onChange({ ...values, cookTimeMinutes: parseNumericInput(text) })}
                />
                {errors?.times !== undefined && <Text accessibilityRole="alert">{errors.times}</Text>}
                <Text>
                    {m.totalTimeLabel} {fillTemplate(m.durationMinutes, { minutes: totalTime })}
                </Text>
            </View>

            <View accessibilityLabel={m.ingredientsHeading}>
                <Text accessibilityRole="header">{m.ingredientsHeading}</Text>
                {errors?.ingredients !== undefined && <Text accessibilityRole="alert">{errors.ingredients}</Text>}
                {ingredientRows.length === 0 ? <Text>{m.noIngredients}</Text> : ingredientRows}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={m.addIngredient}
                    onPress={() => onChange(addIngredient(values))}
                >
                    <Text>{m.addIngredient}</Text>
                </Pressable>
            </View>

            <View accessibilityLabel={m.stepsHeading}>
                <Text accessibilityRole="header">{m.stepsHeading}</Text>
                {errors?.steps !== undefined && <Text accessibilityRole="alert">{errors.steps}</Text>}
                {stepRows.length === 0 ? <Text>{m.noSteps}</Text> : stepRows}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={m.addStep}
                    onPress={() => onChange(addStep(values))}
                >
                    <Text>{m.addStep}</Text>
                </Pressable>
            </View>

            <Switch
                accessibilityLabel={m.visibilityLabel}
                value={values.visibility === 'private'}
                onValueChange={(next) => onChange({ ...values, visibility: next ? 'private' : 'public' })}
            />

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={submitLabel}
                accessibilityState={{ disabled: submitting, busy: submitting }}
                disabled={submitting}
                onPress={onSubmit}
            >
                <Text>{submitLabel}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={m.cancel} onPress={onCancel}>
                <Text>{m.cancel}</Text>
            </Pressable>
        </View>
    );
};
