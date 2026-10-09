/**
 * @module @commise/features-recipes/form — `RecipeBasicsFields` (web): the one-page editor's Details section
 * (`docs/design/uiOverhaul/buildSpec.md` §7.4), in four H3 groups. The editor frame renders the section's H2.
 *
 * - About the recipe: the title (one line however it arrives, a soft 120 limit counted on the trimmed text) and the
 *   description (a soft cap with a counter from 80%).
 * - Time and servings: a stepper, prep and cook as durations that never show a "0", and the computed total.
 * - Kind of dish: the cuisine select, and the meal-type and difficulty choice rows, each clearable.
 * - Diet and tags: the two chip inputs.
 *
 * Presentational and controlled: every edit goes up through `onChange`. The one listener on the frame reports a field
 * leaving focus (`onFieldBlur`, the editor's checkpoint) and keeps Enter out of the title; both events bubble, so the
 * design-system fields need no props for them. The native leaf is `./RecipeBasicsFields.native.tsx`.
 */
import { useMessages } from '@commise/i18n/react';
import { ChipRow } from '@commise/ui/chip';
import { DurationField } from '@commise/ui/duration-field';
import { FieldLabel, Stepper, TextArea } from '@commise/ui/input';
import type { FC, FocusEvent, KeyboardEvent, ReactNode } from 'react';

import { editorMessages } from '../editor/messages.js';
import { formatDuration } from '../format/duration.js';
import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import { ChipInput } from './ChipInput.js';
import { readLimit, singleLine } from './fieldText.js';
import { servingsErrorId, timesErrorId, titleErrorId } from './fieldErrorIds.js';
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
import { field } from './formSectionStyles.js';
import { DESCRIPTION_COUNTER_FROM, DESCRIPTION_MAX_LENGTH, TITLE_COUNTER_FROM, TITLE_MAX_LENGTH } from './limits.js';
import { recipeFormMessages } from './messages.js';
import { durationOfMinutes, minutesOfDuration } from './minutesDuration.js';
import {
    applyDraftAction,
    cuisineOptions,
    statedChoice,
    statedDifficultyOptions,
    statedMealTypeOptions,
    type RecipeEditorSectionProps,
} from './props.js';
import { computeTotalTime } from './totalTime.js';
import type { RecipeFormValues } from './values.js';

/** A field's message under it (§7.8): the `label` role in `dangerText`. */
const fieldMessage = 'text-label text-danger-text';

/** A group heading: H3 in the `label` role, muted. */
const GroupHeading: FC<{ readonly children: string }> = ({ children }) => (
    <h3 className="text-label text-ink-muted">{children}</h3>
);

/** A group: its heading, then its fields. */
const Group: FC<{ readonly heading: string; readonly children: ReactNode }> = ({ heading, children }) => (
    <div className="flex flex-col gap-4">
        <GroupHeading>{heading}</GroupHeading>
        {children}
    </div>
);

/** A counter under a field: muted, or `danger` once past its limit. */
const Counter: FC<{ readonly id: string; readonly over: boolean; readonly children: string }> = ({
    id,
    over,
    children,
}) => (
    <p id={id} className={`text-caption tabular-nums ${over ? 'text-danger-text' : 'text-ink-muted'}`}>
        {children}
    </p>
);

/** A text or number field, as distinct from a button: what the blur checkpoint is about. */
const isField = (target: EventTarget): boolean =>
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

/** The Details section: four groups of fields. */
export const RecipeBasicsFields: FC<RecipeEditorSectionProps> = ({ values, errors, onChange, onFieldBlur }) => {
    const m = useMessages(recipeFormMessages);
    const e = useMessages(editorMessages);
    const { duration } = useMessages(recipeMessages);

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

    const counterText = (count: number, max: number): string => fillTemplate(e.details.titleCounter, { count, max });

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

    const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
        if (isField(event.target)) {
            onFieldBlur?.();
        }
    };

    // The title is one line: Enter adds nothing (`singleLine` also covers a paste and the native return key). An Enter
    // that confirms an input method's composition is left alone.
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (
            event.key === 'Enter' &&
            !event.nativeEvent.isComposing &&
            event.target instanceof HTMLElement &&
            event.target.id === titleFieldId
        ) {
            event.preventDefault();
        }
    };

    return (
        // The listeners catch events bubbling up from the fields inside; the frame itself is never interactive.
        <div className="flex flex-col gap-8" onBlur={onBlur} onKeyDown={onKeyDown}>
            <Group heading={m.groups.about}>
                <div className="flex flex-col gap-1">
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
                    {title.shown ? (
                        <Counter id={titleCounterId} over={title.over}>
                            {counterText(title.count, TITLE_MAX_LENGTH)}
                        </Counter>
                    ) : null}
                    {titleMessage === undefined ? null : (
                        <p
                            id={titleErrorId}
                            className={fieldMessage}
                            {...(errors?.title === undefined ? {} : { role: 'alert' })}
                        >
                            {titleMessage}
                        </p>
                    )}
                </div>
                <div className="flex flex-col gap-1">
                    <FieldLabel forId={descriptionFieldId} label={m.descriptionLabel} />
                    <TextArea
                        id={descriptionFieldId}
                        value={values.description}
                        minRows={4}
                        autoCapitalize="sentences"
                        describedBy={description.shown ? descriptionCounterId : undefined}
                        onChangeText={(text) => onChange({ ...values, description: text })}
                    />
                    {description.shown ? (
                        <Counter id={descriptionCounterId} over={description.over}>
                            {counterText(description.count, DESCRIPTION_MAX_LENGTH)}
                        </Counter>
                    ) : null}
                </div>
            </Group>

            <Group heading={m.groups.timeAndServings}>
                {/* Wraps rather than overflows: a cell never shrinks below its duration boxes (`min-w-fit`), so where two
                    do not fit side by side the second takes the next line, as on native. */}
                <div className="flex flex-wrap gap-4">
                    <div className="basis-full @regular/main:min-w-fit @regular/main:flex-1 @regular/main:basis-0">
                        <Stepper
                            id={servingsFieldId}
                            label={m.servingsLabel}
                            value={values.servings}
                            min={1}
                            onChange={(servings) => onChange({ ...values, servings })}
                            announce={(count) => fillTemplate(m.servingsAnnounce, { count })}
                            decreaseLabel={m.servingsDecrease}
                            increaseLabel={m.servingsIncrease}
                        />
                    </div>
                    <div className="min-w-fit flex-1">
                        {durationField(m.prepTimeLabel, values.prepTimeMinutes, (prepTimeMinutes) => ({
                            prepTimeMinutes,
                        }))}
                    </div>
                    <div className="min-w-fit flex-1">
                        {durationField(m.cookTimeLabel, values.cookTimeMinutes, (cookTimeMinutes) => ({
                            cookTimeMinutes,
                        }))}
                    </div>
                </div>
                {errors?.servings === undefined ? null : (
                    <p id={servingsErrorId} className={fieldMessage} role="alert">
                        {m.errors[errors.servings]}
                    </p>
                )}
                {errors?.times === undefined ? null : (
                    <p id={timesErrorId} className={fieldMessage} role="alert">
                        {m.errors[errors.times]}
                    </p>
                )}
                {total === undefined ? null : (
                    <p className="text-meta text-ink-muted">{fillTemplate(m.totalTimeValue, { duration: total })}</p>
                )}
            </Group>

            <Group heading={m.groups.kindOfDish}>
                <div className="grid grid-cols-1 gap-4 @regular/main:grid-cols-2">
                    <div className="flex flex-col gap-1">
                        <FieldLabel forId={cuisineFieldId} label={m.cuisineLabel} />
                        <select
                            id={cuisineFieldId}
                            value={values.cuisine}
                            onChange={(event) => onChange({ ...values, cuisine: event.target.value })}
                            className={field}
                        >
                            {cuisineOptions(values.cuisine, m).map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        {/* The row is named by the same words; the visible label is not read twice. */}
                        <span aria-hidden="true" className="text-label text-ink-muted">
                            {m.mealTypeLabel}
                        </span>
                        <ChipRow
                            mode="choice"
                            clearable
                            label={m.mealTypeLabel}
                            overflow="wrap"
                            options={mealTypes}
                            value={values.mealType ?? null}
                            onChange={(next) =>
                                onChange(
                                    applyDraftAction(values, {
                                        kind: 'setMealType',
                                        value: statedChoice(mealTypes, next),
                                    }),
                                )
                            }
                        />
                    </div>
                </div>
                <div className="flex flex-col gap-1">
                    <span aria-hidden="true" className="text-label text-ink-muted">
                        {m.difficultyLabel}
                    </span>
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
                    />
                </div>
            </Group>

            <Group heading={m.groups.dietAndTags}>
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
            </Group>
        </div>
    );
};
