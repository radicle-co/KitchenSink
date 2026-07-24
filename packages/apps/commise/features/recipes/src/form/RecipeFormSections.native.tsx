/**
 * @module @commise/features-recipes — native recipe form field GROUPS (w3). The React Native leaf of
 * {@link import('./RecipeFormSections.js')} — same extraction rationale (see that module's doc): the SAME
 * field markup composes both under `RecipeForm.native.tsx`'s single scroll form (unchanged) and, one-for-one,
 * as the 4-step edit wizard's step bodies (`wizard/Wizard.native.tsx`).
 */
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Feather } from '@expo/vector-icons';
import type { FC, ReactElement, ReactNode } from 'react';
import { StyleSheet, Switch, Text, TextInput, View, Pressable } from 'react-native';

import { fillTemplate } from '../list/model.js';
import {
    computeTotalTime,
    DESCRIPTION_MAX_LENGTH,
    lineCalories,
    recipeNutritionTotal,
    TITLE_MAX_LENGTH,
} from './model.js';
import { recipeFormMessages } from './messages.js';
import {
    addIngredient,
    addStep,
    cuisineOptions,
    difficultyOptions,
    parseCommaList,
    parseNumericInput,
    removeIngredientAt,
    removeStepAt,
    resolutionStatusLabel,
    setDifficulty,
    updateIngredientAt,
    updateStepAt,
    type RecipeFormSectionProps,
} from './props.js';

// B8: static ids for the Basics section's singleton fields — the alert `<Text>` an invalid field's
// `aria-describedby` points at (react-native-web maps both straight through to DOM attributes). Ingredient/
// step rows build their own per-index ids (see below) since those sections repeat.
const titleErrorId = 'recipe-title-error';
const servingsErrorId = 'recipe-servings-error';
const timesErrorId = 'recipe-times-error';
const ingredientsErrorId = 'recipe-ingredients-error';
const stepsErrorId = 'recipe-steps-error';

/** A labeled field wrapper (visible label above its control) for the Basics section. */
const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
    <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {children}
    </View>
);

/** Step 1 (minus visibility): title, description, cuisine, tags, dietary flags, servings, prep/cook time, the read-only computed total, and difficulty. */
export const RecipeBasicsFields: FC<RecipeFormSectionProps> = ({ values, errors, onChange }) => {
    const m = useMessages(recipeFormMessages);
    const totalTime = computeTotalTime(values.prepTimeMinutes, values.cookTimeMinutes);
    const titleInvalid = errors?.title !== undefined;
    const servingsInvalid = errors?.servings !== undefined;
    const timesInvalid = errors?.times !== undefined;

    return (
        <View accessibilityLabel={m.basicsHeading} style={styles.card}>
            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {m.basicsHeading}
            </Text>
            <Field label={m.titleLabel}>
                <TextInput
                    accessibilityLabel={m.titleLabel}
                    aria-invalid={titleInvalid || undefined}
                    aria-describedby={titleInvalid ? titleErrorId : undefined}
                    placeholder={m.titlePlaceholder}
                    placeholderTextColor={palette.mist}
                    value={values.title}
                    maxLength={TITLE_MAX_LENGTH}
                    onChangeText={(text) => onChange({ ...values, title: text })}
                    style={styles.input}
                />
                <Text style={styles.charCounter}>
                    {fillTemplate(m.charCounterTemplate, { count: values.title.length, max: TITLE_MAX_LENGTH })}
                </Text>
            </Field>
            {errors?.title !== undefined && (
                <Text id={titleErrorId} accessibilityRole="alert" style={styles.error}>
                    {m.errors[errors.title]}
                </Text>
            )}
            <Field label={m.descriptionLabel}>
                <TextInput
                    accessibilityLabel={m.descriptionLabel}
                    multiline
                    value={values.description}
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    onChangeText={(text) => onChange({ ...values, description: text })}
                    style={[styles.input, styles.multiline]}
                />
                <Text style={styles.charCounter}>
                    {fillTemplate(m.charCounterTemplate, {
                        count: values.description.length,
                        max: DESCRIPTION_MAX_LENGTH,
                    })}
                </Text>
            </Field>
            <View style={styles.field}>
                <Text style={styles.fieldLabel}>{m.cuisineLabel}</Text>
                <View role="radiogroup" aria-label={m.cuisineLabel} style={styles.difficultyRow}>
                    {cuisineOptions(values.cuisine, m).map((option) => {
                        const selected = values.cuisine === option.value;

                        return (
                            <Pressable
                                key={option.value}
                                role="radio"
                                aria-label={option.label}
                                aria-checked={selected}
                                onPress={() => onChange({ ...values, cuisine: option.value })}
                                style={[styles.difficultyChip, selected && styles.difficultyChipSelected]}
                            >
                                <Text
                                    style={[styles.difficultyChipLabel, selected && styles.difficultyChipLabelSelected]}
                                >
                                    {option.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            </View>
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
                                    style={[styles.difficultyChipLabel, selected && styles.difficultyChipLabelSelected]}
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
                    aria-invalid={servingsInvalid || undefined}
                    aria-describedby={servingsInvalid ? servingsErrorId : undefined}
                    keyboardType="numeric"
                    value={String(values.servings)}
                    onChangeText={(text) => onChange({ ...values, servings: parseNumericInput(text) })}
                    style={styles.input}
                />
            </Field>
            {errors?.servings !== undefined && (
                <Text id={servingsErrorId} accessibilityRole="alert" style={styles.error}>
                    {m.errors[errors.servings]}
                </Text>
            )}
            <Field label={m.prepTimeLabel}>
                <TextInput
                    accessibilityLabel={m.prepTimeLabel}
                    aria-invalid={timesInvalid || undefined}
                    aria-describedby={timesInvalid ? timesErrorId : undefined}
                    keyboardType="numeric"
                    value={String(values.prepTimeMinutes)}
                    onChangeText={(text) => onChange({ ...values, prepTimeMinutes: parseNumericInput(text) })}
                    style={styles.input}
                />
            </Field>
            <Field label={m.cookTimeLabel}>
                <TextInput
                    accessibilityLabel={m.cookTimeLabel}
                    aria-invalid={timesInvalid || undefined}
                    aria-describedby={timesInvalid ? timesErrorId : undefined}
                    keyboardType="numeric"
                    value={String(values.cookTimeMinutes)}
                    onChangeText={(text) => onChange({ ...values, cookTimeMinutes: parseNumericInput(text) })}
                    style={styles.input}
                />
            </Field>
            {errors?.times !== undefined && (
                <Text id={timesErrorId} accessibilityRole="alert" style={styles.error}>
                    {m.errors[errors.times]}
                </Text>
            )}
            <Text style={styles.totalTime}>
                {m.totalTimeLabel} {fillTemplate(m.durationMinutes, { minutes: totalTime })}
            </Text>
        </View>
    );
};

/** Step 2: the dynamic ingredient list (the ingredient typeahead/picker itself is app-owned and composed alongside this). */
export const RecipeIngredientsFields: FC<RecipeFormSectionProps> = ({ values, errors, onChange }) => {
    const m = useMessages(recipeFormMessages);
    const total = recipeNutritionTotal(values);

    // B8: mirrors the web leaf — a line is invalid only when it is ITSELF the reason `errors.ingredients` is
    // set, never every row on an `ingredientsEmpty` (empty-list) error.
    const ingredientsInvalid = errors?.ingredients !== undefined;

    const ingredientRows: ReactElement[] = values.ingredients.map((line, index) => {
        const number = index + 1;
        const calories = lineCalories(line);
        const nameInvalid = ingredientsInvalid && line.ingredientId === null;
        const quantityInvalid = ingredientsInvalid && line.quantity <= 0;

        return (
            <View key={index} style={styles.row}>
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientNameLabel, { number })}
                    aria-invalid={nameInvalid || undefined}
                    aria-describedby={nameInvalid ? ingredientsErrorId : undefined}
                    value={line.name}
                    onChangeText={(text) => onChange(updateIngredientAt(values, index, { name: text }))}
                    style={[styles.input, styles.rowGrow]}
                />
                <TextInput
                    accessibilityLabel={fillTemplate(m.ingredientQuantityLabel, { number })}
                    aria-invalid={quantityInvalid || undefined}
                    aria-describedby={quantityInvalid ? ingredientsErrorId : undefined}
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
                {calories !== undefined && (
                    <Text style={styles.caloriesBadge}>{fillTemplate(m.ingredientCaloriesTemplate, { calories })}</Text>
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

    return (
        <View accessibilityLabel={m.ingredientsHeading} style={styles.card}>
            <Text accessibilityRole="header" style={styles.sectionHeading}>
                {m.ingredientsHeading}
            </Text>
            {errors?.ingredients !== undefined && (
                <Text id={ingredientsErrorId} accessibilityRole="alert" style={styles.error}>
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
            <View style={styles.nutritionTotal}>
                <Text style={styles.nutritionTotalText}>
                    {fillTemplate(m.nutritionTotalTemplate, {
                        calories: total.calories,
                        protein: total.proteinG,
                        carbs: total.carbsG,
                        fat: total.fatG,
                    })}
                </Text>
                {!total.isComplete && <Text style={styles.emptyText}>{m.nutritionPartialNotice}</Text>}
            </View>
        </View>
    );
};

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
            <View key={index} style={styles.stepRow}>
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

/** The private-visibility toggle — its own field (step 1) per the original `RecipeForm.native` layout. */
export const RecipeVisibilityField: FC<Omit<RecipeFormSectionProps, 'errors'>> = ({ values, onChange }) => {
    const m = useMessages(recipeFormMessages);

    return (
        <View style={styles.switchRow}>
            <Switch
                accessibilityLabel={m.visibilityLabel}
                value={values.visibility === 'private'}
                onValueChange={(next) => onChange({ ...values, visibility: next ? 'private' : 'public' })}
                trackColor={{ true: palette.seafoam, false: palette.mist }}
            />
            <Text style={styles.switchLabel}>{m.visibilityLabel}</Text>
        </View>
    );
};

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
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
    caloriesBadge: { fontSize: 12, fontWeight: '600', color: palette.seafoam },
    error: { color: palette.error, fontSize: 13 },
    emptyText: { color: palette.slate, fontSize: 13 },
    charCounter: { color: palette.slate, fontSize: 12 },
    totalTime: { color: palette.slate, fontSize: 13 },
    nutritionTotal: {
        gap: 4,
        borderRadius: 12,
        backgroundColor: palette.pearl,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    nutritionTotalText: { fontSize: 13, fontWeight: '600', color: palette.charcoal },
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
    addAction: { alignSelf: 'flex-start' },
});
