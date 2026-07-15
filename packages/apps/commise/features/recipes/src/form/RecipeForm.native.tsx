/**
 * @module @commise/features-recipes — native recipe create/edit form (T067 building block).
 *
 * The React Native leaf of {@link import('./RecipeForm.js').RecipeForm} — same controlled, presentational
 * contract and the same sections (Basics with a READ-ONLY computed total, a dynamic Ingredients list with
 * per-line resolution-status badges + add/remove, a dynamic Instructions list + add/remove, and a
 * visibility toggle). Styled to the Commise design language (@commise/ui palette): card sections, labeled
 * rounded fields, numbered seafoam step markers, and a seafoam primary. Mirrors the web `RecipeForm`.
 *
 * Photo upload (wireframe step 4) is intentionally OUT OF SCOPE here — a later increment adds it.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC, ReactElement, ReactNode } from 'react';
import { StyleSheet, Switch, Text, TextInput, View, Pressable } from 'react-native';

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

/** A labeled field wrapper (visible label above its control) for the Basics section. */
const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
    <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {children}
    </View>
);

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
            <View key={index} style={styles.row}>
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientNameLabel, { number })}
                    value={line.name}
                    onChangeText={(text) => onChange(updateIngredientAt(values, index, { name: text }))}
                    style={[styles.input, styles.rowGrow]}
                />
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientQuantityLabel, { number })}
                    keyboardType="numeric"
                    value={String(line.quantity)}
                    onChangeText={(text) =>
                        onChange(updateIngredientAt(values, index, { quantity: parseNumericInput(text) }))
                    }
                    style={[styles.input, styles.rowNarrow]}
                />
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientUnitLabel, { number })}
                    value={line.unit ?? ''}
                    onChangeText={(text) => onChange(updateIngredientAt(values, index, { unit: text }))}
                    style={[styles.input, styles.rowNarrow]}
                />
                {line.resolutionStatus !== undefined && (
                    <Text
                        accessibilityLabel={fillTemplate(m.ingredientStatusLabel, { number })}
                        style={styles.statusBadge}
                    >
                        {resolutionStatusLabel(m, line.resolutionStatus)}
                    </Text>
                )}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fillTemplate(m.removeIngredient, { number })}
                    onPress={() => onChange(removeIngredientAt(values, index))}
                    style={styles.removeButton}
                >
                    <Text style={styles.removeLabel}>{fillTemplate(m.removeIngredient, { number })}</Text>
                </Pressable>
            </View>
        );
    });

    const stepRows: ReactElement[] = values.steps.map((step, index) => {
        const number = index + 1;

        return (
            <View key={index} style={styles.stepRow}>
                <Text style={styles.stepMarker}>{number}</Text>
                <TextInput
                    accessibilityLabel={fillTemplate(m.stepInstructionLabel, { number })}
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
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fillTemplate(m.removeStep, { number })}
                    onPress={() => onChange(removeStepAt(values, index))}
                    style={styles.removeButton}
                >
                    <Text style={styles.removeLabel}>{fillTemplate(m.removeStep, { number })}</Text>
                </Pressable>
            </View>
        );
    });

    return (
        <View accessibilityLabel={headingText} style={styles.container}>
            <Text accessibilityRole="header" style={styles.heading}>
                {headingText}
            </Text>

            <View accessibilityLabel={m.basicsHeading} style={styles.card}>
                <Text accessibilityRole="header" style={styles.sectionHeading}>
                    {m.basicsHeading}
                </Text>
                <Field label={m.titleLabel}>
                    <TextInput
                        accessibilityLabel={m.titleLabel}
                        placeholder={m.titlePlaceholder}
                        placeholderTextColor={palette.mist}
                        value={values.title}
                        onChangeText={(text) => onChange({ ...values, title: text })}
                        style={styles.input}
                    />
                </Field>
                {errors?.title !== undefined && (
                    <Text accessibilityRole="alert" style={styles.error}>
                        {errors.title}
                    </Text>
                )}
                <Field label={m.descriptionLabel}>
                    <TextInput
                        accessibilityLabel={m.descriptionLabel}
                        multiline
                        value={values.description}
                        onChangeText={(text) => onChange({ ...values, description: text })}
                        style={[styles.input, styles.multiline]}
                    />
                </Field>
                <Field label={m.cuisineLabel}>
                    <TextInput
                        accessibilityLabel={m.cuisineLabel}
                        value={values.cuisine}
                        onChangeText={(text) => onChange({ ...values, cuisine: text })}
                        style={styles.input}
                    />
                </Field>
                <Field label={m.tagsLabel}>
                    <TextInput
                        accessibilityLabel={m.tagsLabel}
                        placeholder={m.tagsHint}
                        placeholderTextColor={palette.mist}
                        value={values.tags.join(', ')}
                        onChangeText={(text) => onChange({ ...values, tags: parseCommaList(text) })}
                        style={styles.input}
                    />
                </Field>
                <Field label={m.dietaryFlagsLabel}>
                    <TextInput
                        accessibilityLabel={m.dietaryFlagsLabel}
                        placeholder={m.tagsHint}
                        placeholderTextColor={palette.mist}
                        value={values.dietaryFlags.join(', ')}
                        onChangeText={(text) => onChange({ ...values, dietaryFlags: parseCommaList(text) })}
                        style={styles.input}
                    />
                </Field>
                <Field label={m.servingsLabel}>
                    <TextInput
                        accessibilityLabel={m.servingsLabel}
                        keyboardType="numeric"
                        value={String(values.servings)}
                        onChangeText={(text) => onChange({ ...values, servings: parseNumericInput(text) })}
                        style={styles.input}
                    />
                </Field>
                {errors?.servings !== undefined && (
                    <Text accessibilityRole="alert" style={styles.error}>
                        {errors.servings}
                    </Text>
                )}
                <Field label={m.prepTimeLabel}>
                    <TextInput
                        accessibilityLabel={m.prepTimeLabel}
                        keyboardType="numeric"
                        value={String(values.prepTimeMinutes)}
                        onChangeText={(text) => onChange({ ...values, prepTimeMinutes: parseNumericInput(text) })}
                        style={styles.input}
                    />
                </Field>
                <Field label={m.cookTimeLabel}>
                    <TextInput
                        accessibilityLabel={m.cookTimeLabel}
                        keyboardType="numeric"
                        value={String(values.cookTimeMinutes)}
                        onChangeText={(text) => onChange({ ...values, cookTimeMinutes: parseNumericInput(text) })}
                        style={styles.input}
                    />
                </Field>
                {errors?.times !== undefined && (
                    <Text accessibilityRole="alert" style={styles.error}>
                        {errors.times}
                    </Text>
                )}
                <Text style={styles.totalTime}>
                    {m.totalTimeLabel} {fillTemplate(m.durationMinutes, { minutes: totalTime })}
                </Text>
            </View>

            <View accessibilityLabel={m.ingredientsHeading} style={styles.card}>
                <Text accessibilityRole="header" style={styles.sectionHeading}>
                    {m.ingredientsHeading}
                </Text>
                {errors?.ingredients !== undefined && (
                    <Text accessibilityRole="alert" style={styles.error}>
                        {errors.ingredients}
                    </Text>
                )}
                {ingredientRows.length === 0 ? <Text style={styles.emptyText}>{m.noIngredients}</Text> : ingredientRows}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={m.addIngredient}
                    onPress={() => onChange(addIngredient(values))}
                    style={styles.ghostButton}
                >
                    <Text style={styles.ghostLabel}>{m.addIngredient}</Text>
                </Pressable>
            </View>

            <View accessibilityLabel={m.stepsHeading} style={styles.card}>
                <Text accessibilityRole="header" style={styles.sectionHeading}>
                    {m.stepsHeading}
                </Text>
                {errors?.steps !== undefined && (
                    <Text accessibilityRole="alert" style={styles.error}>
                        {errors.steps}
                    </Text>
                )}
                {stepRows.length === 0 ? <Text style={styles.emptyText}>{m.noSteps}</Text> : stepRows}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={m.addStep}
                    onPress={() => onChange(addStep(values))}
                    style={styles.ghostButton}
                >
                    <Text style={styles.ghostLabel}>{m.addStep}</Text>
                </Pressable>
            </View>

            <View style={styles.switchRow}>
                <Switch
                    accessibilityLabel={m.visibilityLabel}
                    value={values.visibility === 'private'}
                    onValueChange={(next) => onChange({ ...values, visibility: next ? 'private' : 'public' })}
                    trackColor={{ true: palette.seafoam, false: palette.mist }}
                />
                <Text style={styles.switchLabel}>{m.visibilityLabel}</Text>
            </View>

            <View style={styles.actions}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={submitLabel}
                    accessibilityState={{ disabled: submitting, busy: submitting }}
                    disabled={submitting}
                    onPress={onSubmit}
                    style={[styles.primaryButton, submitting && styles.primaryButtonBusy]}
                >
                    <Text style={styles.primaryLabel}>{submitLabel}</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={m.cancel}
                    onPress={onCancel}
                    style={styles.ghostButton}
                >
                    <Text style={styles.ghostLabel}>{m.cancel}</Text>
                </Pressable>
            </View>
        </View>
    );
};

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    container: { gap: 16, paddingHorizontal: 16, paddingVertical: 16 },
    heading: { fontSize: 28, fontWeight: '700', color: palette.charcoal },
    card: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 16,
        gap: 12,
    },
    sectionHeading: { fontSize: 20, fontWeight: '600', color: palette.charcoal },
    field: { gap: 4 },
    fieldLabel: { fontSize: 13, fontWeight: '500', color: palette.slate },
    input: {
        backgroundColor: palette.white,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: 10,
        paddingHorizontal: 12,
        fontSize: 16,
        color: palette.charcoal,
    },
    multiline: { minHeight: 88, textAlignVertical: 'top' },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    rowGrow: { flexGrow: 1, flexBasis: '60%' },
    rowNarrow: { width: 88 },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepMarker: {
        width: 28,
        height: 28,
        borderRadius: 999,
        backgroundColor: palette.seafoam,
        color: palette.white,
        textAlign: 'center',
        lineHeight: 28,
        fontWeight: '600',
        overflow: 'hidden',
    },
    statusBadge: { fontSize: 11, color: palette.slate },
    removeButton: { paddingVertical: 6, paddingHorizontal: 10 },
    removeLabel: { color: palette.error, fontSize: 13, fontWeight: '500' },
    error: { color: palette.error, fontSize: 13 },
    emptyText: { color: palette.slate, fontSize: 13 },
    totalTime: { color: palette.slate, fontSize: 13 },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 16,
    },
    switchLabel: { fontSize: 16, color: palette.charcoal },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    primaryButton: { backgroundColor: palette.seafoam, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 24 },
    primaryButtonBusy: { opacity: 0.6 },
    primaryLabel: { color: palette.white, fontWeight: '600', fontSize: 15 },
    ghostButton: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
    ghostLabel: { color: palette.slate, fontWeight: '500', fontSize: 14 },
});
