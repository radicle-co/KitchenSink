/**
 * @module @commise/features-recipes/form — `RecipeBasicsFields` (native): step 1 of the recipe form, minus
 * visibility. Title, description, cuisine, tags, dietary flags, servings, prep/cook time, the read-only
 * computed total, difficulty, and meal type.
 *
 * The React Native leaf of `./RecipeBasicsFields.tsx` — same extraction rationale (see that module's doc):
 * the SAME field markup composes both under `RecipeForm.native.tsx`'s single scroll form (unchanged) and,
 * one-for-one, as a step body of the 4-step edit wizard (`wizard/Wizard.native.tsx`).
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { ChipInput } from './ChipInput.native.js';
import { CuisineSelect } from './CuisineSelect.native.js';
import { Field } from './Field.native.js';
import { fillTemplate } from '../list/model.js';
import { computeTotalTime, DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from './model.js';
import { recipeFormMessages } from './messages.js';
import { servingsErrorId, timesErrorId, titleErrorId } from './fieldErrorIds.js';
import { styles } from './formSectionStyles.native.js';
import {
    difficultyOptions,
    mealTypeOptions,
    parseNumericInput,
    setDifficulty,
    setMealType,
    type RecipeFormSectionProps,
} from './props.js';

/** Step 1 (minus visibility): title, description, cuisine, meal type, tags, dietary flags, servings, prep/cook time, the read-only computed total, and difficulty. */
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
                    // Placeholder text is TEXT, so it takes `slate`, never the `mist` hairline tone — see the
                    // palette JSDoc in `@commise/ui`'s `tokens/colors.ts`.
                    placeholderTextColor={palette.slate}
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
            <CuisineSelect value={values.cuisine} onChange={(cuisine) => onChange({ ...values, cuisine })} />
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
            <View style={styles.field}>
                <Text style={styles.fieldLabel}>{m.mealTypeLabel}</Text>
                {/*
                  U34 — the ONE closed axis. It reuses the difficulty chip group's shape deliberately: both
                  are "pick at most one from a fixed set, or state nothing". The two `ChipInput`s below stay
                  free text, which is what keeps the two kinds of chip visibly and semantically different.
                */}
                <View role="radiogroup" aria-label={m.mealTypeLabel} style={styles.difficultyRow}>
                    {mealTypeOptions(m).map((option) => {
                        const selected = values.mealType === option.value;

                        return (
                            <Pressable
                                key={option.label}
                                role="radio"
                                aria-label={option.label}
                                aria-checked={selected}
                                onPress={() => onChange(setMealType(values, option.value))}
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
            {/* Prep + cook grouped on one row (U6 — de-densify the step-1 pile). */}
            <View style={styles.timesRow}>
                <View style={styles.timeCol}>
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
                </View>
                <View style={styles.timeCol}>
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
                </View>
            </View>
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
