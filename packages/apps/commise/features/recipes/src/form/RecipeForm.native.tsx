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
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Feather } from '@expo/vector-icons';
import type { FC, ReactElement, ReactNode } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View, Pressable } from 'react-native';

import { fillTemplate } from '../list/model.js';
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
                <Button
                    variant="destructive"
                    icon={<Feather name="trash-2" size={16} color={palette.error} />}
                    onPress={() => onChange(removeIngredientAt(values, index))}
                >
                    {fillTemplate(m.removeIngredient, { number })}
                </Button>
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
                <Button
                    variant="destructive"
                    icon={<Feather name="trash-2" size={16} color={palette.error} />}
                    onPress={() => onChange(removeStepAt(values, index))}
                >
                    {fillTemplate(m.removeStep, { number })}
                </Button>
            </View>
        );
    });

    return (
        // A ScrollView, not a plain View: the form is taller than the viewport (Basics + ingredients + steps
        // + submit), so without it the fields below the fold — including the submit button — are unreachable
        // on a device. `keyboardShouldPersistTaps="handled"` lets a tap land on a button/field while the soft
        // keyboard is still open instead of being swallowed by the dismiss.
        <ScrollView
            accessibilityLabel={headingText}
            style={styles.scroll}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
        >
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
                        {m.errors[errors.title]}
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
                <View style={styles.field}>
                    <Text style={styles.fieldLabel}>{m.difficultyLabel}</Text>
                    <View role="radiogroup" aria-label={m.difficultyLabel} style={styles.difficultyRow}>
                        {difficultyOptions(m).map((option) => {
                            const selected = values.difficulty === option.value;

                            return (
                                <Pressable
                                    key={option.label}
                                    role="radio"
                                    aria-label={option.label}
                                    aria-checked={selected}
                                    onPress={() => onChange(setDifficulty(values, option.value))}
                                    style={[styles.difficultyChip, selected && styles.difficultyChipSelected]}
                                >
                                    <Text
                                        style={[
                                            styles.difficultyChipLabel,
                                            selected && styles.difficultyChipLabelSelected,
                                        ]}
                                    >
                                        {option.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>
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
                        {m.errors[errors.servings]}
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
                        {m.errors[errors.times]}
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
                        {m.errors[errors.ingredients]}
                    </Text>
                )}
                {ingredientRows.length === 0 ? <Text style={styles.emptyText}>{m.noIngredients}</Text> : ingredientRows}
                <View style={styles.addAction}>
                    <Button
                        variant="secondary"
                        icon={<Feather name="plus" size={16} color={palette.charcoal} />}
                        onPress={() => onChange(addIngredient(values))}
                    >
                        {m.addIngredient}
                    </Button>
                </View>
            </View>

            <View accessibilityLabel={m.stepsHeading} style={styles.card}>
                <Text accessibilityRole="header" style={styles.sectionHeading}>
                    {m.stepsHeading}
                </Text>
                {errors?.steps !== undefined && (
                    <Text accessibilityRole="alert" style={styles.error}>
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
                <Button
                    icon={<Feather name="check" size={16} color={palette.white} />}
                    busy={submitting}
                    onPress={onSubmit}
                >
                    {submitLabel}
                </Button>
                <Button
                    variant="secondary"
                    icon={<Feather name="x" size={16} color={palette.charcoal} />}
                    onPress={onCancel}
                >
                    {m.cancel}
                </Button>
            </View>
        </ScrollView>
    );
};

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    scroll: { flex: 1 },
    // Extra bottom padding so the submit/cancel actions clear the device's gesture/navigation bar at the
    // foot of the scroll.
    container: { gap: 16, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 },
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
    difficultyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    difficultyChip: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: palette.white,
        paddingVertical: 6,
        paddingHorizontal: 16,
    },
    difficultyChipSelected: { borderColor: palette.seafoam, backgroundColor: palette.seafoam },
    difficultyChipLabel: { fontSize: 14, color: palette.charcoal },
    difficultyChipLabelSelected: { color: palette.white },
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
    // Keeps an "add ingredient / add step" button at content width + left-aligned inside the stretch column.
    addAction: { alignSelf: 'flex-start' },
});
