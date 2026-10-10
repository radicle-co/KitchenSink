/**
 * @module @commise/features-recipes/form — `RecipeBasicsFields` (native): the one-page editor's Details section
 * (`docs/design/uiOverhaul/buildSpec.md` §7.4, §7.12), the React Native leaf of `./RecipeBasicsFields.tsx`, on the same
 * props, the same pure rules (`./fieldText.ts`, `./minutesDuration.ts`) and the same copy.
 *
 * What differs from web, and why:
 * - The layout follows the container class of the window's width (`useContainerClass`): below 600 prep and cook share
 *   a row and servings sits above them; from 600 servings, prep and cook share one row, and cuisine sits beside meal
 *   type. Web reads the same thresholds through `@regular/main:` variants.
 * - The title's return key is not blocked, because React Native has no cancellable key event; `singleLine` turns the
 *   break into a space instead, as it does a pasted one on both platforms.
 * - `onFieldBlur` is not called: no design-system field reports its blur on native, and React Native does not bubble
 *   focus events. The editor's other checkpoints still save the draft.
 * - Colours come from the theme at render, so both colour schemes paint (owner D15).
 */
import { useMessages } from '@commise/i18n/react';
import { ChipRow } from '@commise/ui/chip';
import { DurationField } from '@commise/ui/duration-field';
import { FieldLabel, Stepper, TextArea } from '@commise/ui/input';
import { useContainerClass } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { editorMessages } from '../editor/messages.js';
import { formatDuration } from '../format/duration.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';
import { ChipInput } from './ChipInput.native.js';
import { CuisineSelect } from './CuisineSelect.native.js';
import { readLimit, singleLine } from './fieldText.js';
import { servingsErrorId, timesErrorId, titleErrorId } from './fieldErrorIds.js';
import {
    describedByOf,
    descriptionCounterId,
    descriptionFieldId,
    dietaryFlagsFieldId,
    servingsFieldId,
    tagsFieldId,
    titleCounterId,
    titleFieldId,
} from './fieldIds.js';
import { DESCRIPTION_COUNTER_FROM, DESCRIPTION_MAX_LENGTH, TITLE_COUNTER_FROM, TITLE_MAX_LENGTH } from './limits.js';
import { recipeFormMessages } from './messages.js';
import { durationOfMinutes, minutesOfDuration } from './minutesDuration.js';
import {
    applyDraftAction,
    statedChoice,
    statedDifficultyOptions,
    statedMealTypeOptions,
    type RecipeEditorSectionProps,
} from './props.js';
import { computeTotalTime } from './totalTime.js';
import type { RecipeFormValues } from './values.js';

/** The Details section: four groups of fields. */
export const RecipeBasicsFields: FC<RecipeEditorSectionProps> = ({ values, errors, onChange }) => {
    const m = useMessages(recipeFormMessages);
    const e = useMessages(editorMessages);
    const { duration } = useMessages(recipeMessages);
    const { colors } = useTheme();
    const wide = useContainerClass() !== 'narrow';

    const title = readLimit(values.title, TITLE_MAX_LENGTH, TITLE_COUNTER_FROM);
    const titleMessage =
        errors?.title === undefined ? (title.over ? e.details.titleLimit : undefined) : m.errors[errors.title];
    const description = readLimit(values.description, DESCRIPTION_MAX_LENGTH, DESCRIPTION_COUNTER_FROM);
    const total = formatDuration(
        durationOfMinutes(computeTotalTime(values.prepTimeMinutes, values.cookTimeMinutes)),
        duration,
    );
    const difficulties = statedDifficultyOptions(m);
    const mealTypes = statedMealTypeOptions(m);

    const group = (heading: string, children: ReactNode) => (
        <View style={styles.group}>
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.inkMuted }]}>
                {heading}
            </Text>
            {children}
        </View>
    );

    const counter = (id: string, over: boolean, count: number, max: number) => (
        <Text nativeID={id} style={[styles.caption, { color: over ? colors.dangerText : colors.inkMuted }]}>
            {fillTemplate(e.details.titleCounter, { count, max })}
        </Text>
    );

    const message = (id: string, text: string, alert: boolean) => (
        <Text
            nativeID={id}
            {...(alert ? { accessibilityRole: 'alert' as const } : {})}
            style={[styles.message, { color: colors.dangerText }]}
        >
            {text}
        </Text>
    );

    const durationField = (label: string, minutes: number, patch: (next: number) => Partial<RecipeFormValues>) => (
        <DurationField
            label={label}
            hoursLabel={fillTemplate(m.durationHoursLabel, { field: label })}
            minutesLabel={fillTemplate(m.durationMinutesLabel, { field: label })}
            hoursUnit={m.timerHoursUnit}
            minutesUnit={m.timerMinutesUnit}
            value={durationOfMinutes(minutes)}
            onChange={(seconds) => onChange({ ...values, ...patch(minutesOfDuration(seconds)) })}
        />
    );

    const servings = (
        <Stepper
            id={servingsFieldId}
            label={m.servingsLabel}
            value={values.servings}
            min={1}
            onChange={(next) => onChange({ ...values, servings: next })}
            announce={(count) => fillTemplate(m.servingsAnnounce, { count })}
            decreaseLabel={m.servingsDecrease}
            increaseLabel={m.servingsIncrease}
        />
    );
    const prep = durationField(m.prepTimeLabel, values.prepTimeMinutes, (prepTimeMinutes) => ({ prepTimeMinutes }));
    const cook = durationField(m.cookTimeLabel, values.cookTimeMinutes, (cookTimeMinutes) => ({ cookTimeMinutes }));

    const choiceRow = (label: string, row: ReactNode) => (
        <View style={styles.field}>
            {/* The row is named by the same words; the visible label is not read twice. */}
            <Text aria-hidden style={[styles.label, { color: colors.inkMuted }]}>
                {label}
            </Text>
            {row}
        </View>
    );

    const cuisine = (
        <View style={wide ? styles.cell : null}>
            <CuisineSelect value={values.cuisine} onChange={(next) => onChange({ ...values, cuisine: next })} />
        </View>
    );
    const mealType = (
        <View style={wide ? styles.cell : null}>
            {choiceRow(
                m.mealTypeLabel,
                <ChipRow
                    mode="choice"
                    clearable
                    label={m.mealTypeLabel}
                    overflow="wrap"
                    options={mealTypes}
                    value={values.mealType ?? null}
                    onChange={(next) =>
                        onChange(
                            applyDraftAction(values, { kind: 'setMealType', value: statedChoice(mealTypes, next) }),
                        )
                    }
                />,
            )}
        </View>
    );

    return (
        <View style={styles.section}>
            {group(
                m.groups.about,
                <>
                    <View style={styles.field}>
                        <FieldLabel forId={titleFieldId} label={m.titleLabel} />
                        <TextArea
                            id={titleFieldId}
                            value={values.title}
                            minRows={1}
                            maxRows={3}
                            placeholder={m.titlePlaceholder}
                            autoCapitalize="sentences"
                            invalid={titleMessage !== undefined}
                            describedBy={describedByOf(
                                titleMessage === undefined ? undefined : titleErrorId,
                                title.shown ? titleCounterId : undefined,
                            )}
                            onChangeText={(text) => onChange({ ...values, title: singleLine(text) })}
                        />
                        {title.shown ? counter(titleCounterId, title.over, title.count, TITLE_MAX_LENGTH) : null}
                        {titleMessage === undefined
                            ? null
                            : message(titleErrorId, titleMessage, errors?.title !== undefined)}
                    </View>
                    <View style={styles.field}>
                        <FieldLabel forId={descriptionFieldId} label={m.descriptionLabel} />
                        <TextArea
                            id={descriptionFieldId}
                            value={values.description}
                            minRows={4}
                            autoCapitalize="sentences"
                            describedBy={description.shown ? descriptionCounterId : undefined}
                            onChangeText={(text) => onChange({ ...values, description: text })}
                        />
                        {description.shown
                            ? counter(descriptionCounterId, description.over, description.count, DESCRIPTION_MAX_LENGTH)
                            : null}
                    </View>
                </>,
            )}

            {group(
                m.groups.timeAndServings,
                <>
                    {wide ? (
                        <View style={styles.row}>
                            <View style={styles.cell}>{servings}</View>
                            {prep}
                            {cook}
                        </View>
                    ) : (
                        <>
                            {servings}
                            <View style={styles.row}>
                                {prep}
                                {cook}
                            </View>
                        </>
                    )}
                    {errors?.servings === undefined ? null : message(servingsErrorId, m.errors[errors.servings], true)}
                    {errors?.times === undefined ? null : message(timesErrorId, m.errors[errors.times], true)}
                    {total === undefined ? null : (
                        <Text style={[styles.meta, { color: colors.inkMuted }]}>
                            {fillTemplate(m.totalTimeValue, { duration: total })}
                        </Text>
                    )}
                </>,
            )}

            {group(
                m.groups.kindOfDish,
                <>
                    {wide ? (
                        <View style={styles.row}>
                            {cuisine}
                            {mealType}
                        </View>
                    ) : (
                        <>
                            {cuisine}
                            {mealType}
                        </>
                    )}
                    {choiceRow(
                        m.difficultyLabel,
                        <ChipRow
                            mode="choice"
                            clearable
                            label={m.difficultyLabel}
                            overflow="wrap"
                            options={difficulties}
                            value={values.difficulty ?? null}
                            onChange={(next) =>
                                onChange(
                                    applyDraftAction(values, {
                                        kind: 'setDifficulty',
                                        value: statedChoice(difficulties, next),
                                    }),
                                )
                            }
                        />,
                    )}
                </>,
            )}

            {group(
                m.groups.dietAndTags,
                <>
                    <ChipInput
                        id={dietaryFlagsFieldId}
                        label={m.dietaryFlagsLabel}
                        hint={m.tagsHint}
                        values={values.dietaryFlags}
                        onChange={(dietaryFlags) => onChange({ ...values, dietaryFlags })}
                        removeChipLabel={m.removeChipLabel}
                    />
                    <ChipInput
                        id={tagsFieldId}
                        label={m.tagsLabel}
                        hint={m.tagsHint}
                        values={values.tags}
                        onChange={(tags) => onChange({ ...values, tags })}
                        removeChipLabel={m.removeChipLabel}
                    />
                </>,
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    section: { gap: nativeTokens.spacing[8] },
    group: { gap: nativeTokens.spacing[4] },
    heading: nativeTokens.type.label,
    field: { gap: nativeTokens.spacing[1] },
    label: nativeTokens.type.label,
    caption: nativeTokens.type.caption,
    meta: nativeTokens.type.meta,
    message: nativeTokens.type.label,
    // Prep and cook (and, from 600, servings) side by side; each takes an equal share and may shrink.
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: nativeTokens.spacing[4] },
    cell: { flex: 1, minWidth: 0 },
});
