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
import { Combobox } from '@commise/ui/combobox';
import { DurationField } from '@commise/ui/duration-field';
import { Icon } from '@commise/ui/icon';
import { FieldLabel, Stepper, TextArea } from '@commise/ui/input';
import { useContainerClass } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { MAX_RECIPE_CUISINE_LENGTH } from '@kitchensink/recipe-core';
import type { FC, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { editorMessages } from '../editor/messages.js';
import { formatDuration } from '../format/duration.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';
import { ChipInput } from './ChipInput.native.js';
import { readLimit, singleLine } from './fieldText.js';
import { descriptionErrorId, servingsErrorId, timesErrorId, titleErrorId } from './fieldErrorIds.js';
import {
    cuisineFieldId,
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
import { useCuisineField } from './useCuisineField.js';
import type { RecipeFormValues } from './values.js';

/** The cuisine list's bound on a phone: five rows and a half, so the fields below stay in reach (`cuisineField.md` §3.4). */
const CUISINE_LIST_MAX_ROWS = 5;

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
    // Past 256 Publish is refused (a draft still saves): the limit is said as soon as it is passed, and as the refusal
    // once Publish has been tried — never both.
    const descriptionMessage =
        errors?.description === undefined
            ? description.over
                ? e.details.descriptionLimit
                : undefined
            : m.errors[errors.description];
    const total = formatDuration(
        durationOfMinutes(computeTotalTime(values.prepTimeMinutes, values.cookTimeMinutes)),
        duration,
    );
    const difficulties = statedDifficultyOptions(m);
    const mealTypes = statedMealTypeOptions(m);
    const cuisineField = useCuisineField({
        value: values.cuisine,
        onChange: (next) => onChange({ ...values, cuisine: next }),
    });
    const cuisineMessage =
        errors?.cuisine === undefined
            ? undefined
            : fillTemplate(m.errors[errors.cuisine], { max: MAX_RECIPE_CUISINE_LENGTH });

    // One refusal covers prep and cook, so both fields say it (React Native has no `aria-describedby` to link them).
    const timesMessage = errors?.times === undefined ? undefined : m.errors[errors.times];

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
            {...(timesMessage === undefined ? {} : { error: timesMessage })}
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
            {...(errors?.servings === undefined ? {} : { error: m.errors[errors.servings] })}
        />
    );
    // Two cells of one row at every width: the duration field fits the 136 dp a half cell has at 320 (build spec §7.4).
    const prep = (
        <View style={styles.cell}>
            {durationField(m.prepTimeLabel, values.prepTimeMinutes, (prepTimeMinutes) => ({ prepTimeMinutes }))}
        </View>
    );
    const cook = (
        <View style={styles.cell}>
            {durationField(m.cookTimeLabel, values.cookTimeMinutes, (cookTimeMinutes) => ({ cookTimeMinutes }))}
        </View>
    );

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
            {/* `cuisineField.md` §3: free text, the typed text IS the value (`typedText="isValue"`: Done ends the entry),
                with the 90 suggestions in a list bounded to five rows (§3.4, P2) and the cook's own words as "Use “…”".
                The clear button empties it. */}
            <Combobox
                id={cuisineFieldId}
                label={m.cuisineLabel}
                listLabel={m.cuisineListLabel}
                hint={m.cuisineHint}
                {...cuisineField}
                clear={{ label: m.cuisineClear, icon: <Icon name="x" size={20} tone="inkMuted" /> }}
                {...(cuisineMessage === undefined ? {} : { error: cuisineMessage })}
                // S9 is spoken once, here; S8 is already spoken by the publish-refusal path (cuisineField.md §3.3).
                // The error slot itself is never live.
                alertAnnouncement={errors?.cuisine === 'cuisineTooLong' ? (cuisineMessage ?? '') : ''}
                typedText="isValue"
                listMaxRows={CUISINE_LIST_MAX_ROWS}
                openOnFocus
            />
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
                            label={m.titleLabel}
                            {...(titleMessage === undefined ? {} : { error: titleMessage })}
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
                            label={m.descriptionLabel}
                            {...(descriptionMessage === undefined ? {} : { error: descriptionMessage })}
                            describedBy={describedByOf(
                                descriptionMessage === undefined ? undefined : descriptionErrorId,
                                description.shown ? descriptionCounterId : undefined,
                            )}
                            onChangeText={(text) => onChange({ ...values, description: text })}
                        />
                        {description.shown
                            ? counter(descriptionCounterId, description.over, description.count, DESCRIPTION_MAX_LENGTH)
                            : null}
                        {descriptionMessage === undefined
                            ? null
                            : message(descriptionErrorId, descriptionMessage, errors?.description !== undefined)}
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
                            <View style={styles.timesRow}>
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
                        addLabel={m.addDietaryFlagLabel}
                    />
                    <ChipInput
                        id={tagsFieldId}
                        label={m.tagsLabel}
                        hint={m.tagsHint}
                        values={values.tags}
                        onChange={(tags) => onChange({ ...values, tags })}
                        removeChipLabel={m.removeChipLabel}
                        addLabel={m.addTagLabel}
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
    // Prep and cook below 600: two cells that share the line and never wrap.
    timesRow: { flexDirection: 'row', gap: nativeTokens.spacing[4] },
});
