'use client';

/**
 * @module @commise/features-recipes/form — `RecipeInstructionsFields` (web): the one-page editor's Steps section
 * (`docs/design/uiOverhaul/buildSpec.md` §7.6), a numbered list. The editor frame renders the section's H2 and, in it,
 * `PasteStepsControl`.
 *
 * Each step: its numeral, the visible "Step {n}" label naming a multi-line field the full column width, the timer
 * behind "Add a timer", and a ⋯ menu that moves or removes the step without drag (SC 2.5.7). "Add step" ends the list;
 * Ctrl or Cmd + Enter in a step does the same. The commands and the timer disclosure are `useStepList`'s, shared with the
 * native leaf.
 *
 * Presentational over that hook: every edit goes up through `onChange`. The one listener on the frame reports a field
 * leaving focus (`onFieldBlur`) and catches the add-step shortcut; both events bubble from the design-system fields.
 */
import { useMessages } from '@commise/i18n/react';
import { ActionMenu, type ActionMenuItem } from '@commise/ui/action-menu';
import { Button } from '@commise/ui/button';
import { DurationField } from '@commise/ui/duration-field';
import { FieldLabel, TextArea } from '@commise/ui/input';
import type { FC, FocusEvent, KeyboardEvent } from 'react';

import { editorMessages } from '../editor/messages.js';
import { fillTemplate } from '../list/model.js';
import { stepsErrorId } from './fieldErrorIds.js';
import { stepFieldId } from './fieldIds.js';
import { recipeFormMessages } from './messages.js';
import { applyDraftAction, type RecipeEditorSectionProps } from './props.js';
import { stepsMessage } from './stepsMessage.js';
import { useStepList } from './useStepList.js';

/** The Steps section: the numbered list, then Add step. */
export const RecipeInstructionsFields: FC<RecipeEditorSectionProps> = ({ values, errors, onChange, onFieldBlur }) => {
    const m = useMessages(recipeFormMessages);
    const e = useMessages(editorMessages);
    const list = useStepList({ values, onChange });
    const refused = stepsMessage(values, errors, e);
    const last = values.steps.length - 1;

    const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
        if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
            onFieldBlur?.();
        }
    };

    // Ctrl or Cmd + Enter in a step adds a step (§7.6). A plain Enter is left alone: it inserts a line break.
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (
            event.key === 'Enter' &&
            (event.ctrlKey || event.metaKey) &&
            !event.nativeEvent.isComposing &&
            event.target instanceof HTMLTextAreaElement
        ) {
            event.preventDefault();
            list.add();
        }
    };

    return (
        // The listeners catch events bubbling up from the fields inside; the frame itself is never interactive.
        <div className="flex flex-col gap-4" onBlur={onBlur} onKeyDown={onKeyDown}>
            {refused === undefined ? null : (
                <p id={stepsErrorId} className="text-label text-danger-text" role="alert">
                    {refused.text}
                </p>
            )}
            {values.steps.length === 0 ? (
                <p className="text-body text-ink-muted">{e.steps.empty}</p>
            ) : (
                <ol className="flex flex-col gap-6">
                    {values.steps.map((step, index) => {
                        const n = index + 1;
                        const label = fillTemplate(e.steps.label, { n });
                        const invalid = refused?.blank.includes(index) ?? false;
                        const items: ActionMenuItem[] = [
                            ...(index > 0
                                ? [{ id: 'moveUp', label: e.steps.moveUp, onSelect: () => list.move(index, index - 1) }]
                                : []),
                            ...(index < last
                                ? [
                                      {
                                          id: 'moveDown',
                                          label: e.steps.moveDown,
                                          onSelect: () => list.move(index, index + 1),
                                      },
                                  ]
                                : []),
                        ];

                        return (
                            <li key={index} className="flex flex-col gap-2">
                                <div className="flex items-center gap-3">
                                    <span
                                        aria-hidden="true"
                                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-selected-fill text-label tabular-nums text-ink"
                                    >
                                        {n}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <FieldLabel forId={stepFieldId(index)} label={label} />
                                    </div>
                                    <ActionMenu
                                        triggerLabel={fillTemplate(e.steps.actions, { n })}
                                        focusRequested={list.actionsFocus(index).requested}
                                        onFocusRequestHandled={list.actionsFocus(index).onHandled}
                                        title={label}
                                        closeLabel={fillTemplate(m.ingredientActionsMenuCloseLabel, { food: label })}
                                        items={items}
                                        destructiveItem={{
                                            id: 'remove',
                                            label: e.steps.remove,
                                            onSelect: () => list.remove(index),
                                        }}
                                    />
                                </div>
                                <TextArea
                                    id={stepFieldId(index)}
                                    value={step.instruction}
                                    minRows={2}
                                    autoCapitalize="sentences"
                                    invalid={invalid}
                                    {...(invalid ? { describedBy: stepsErrorId } : {})}
                                    onChangeText={(instruction) =>
                                        onChange(
                                            applyDraftAction(values, {
                                                kind: 'updateStepAt',
                                                index,
                                                patch: { instruction },
                                            }),
                                        )
                                    }
                                />
                                {list.timerShown(index) ? (
                                    <div className="flex flex-wrap items-end gap-3">
                                        <DurationField
                                            label={e.steps.timerLabel}
                                            hoursLabel={fillTemplate(m.stepTimerHoursLabel, { number: n })}
                                            minutesLabel={fillTemplate(m.stepTimerMinutesLabel, { number: n })}
                                            hoursUnit={m.timerHoursUnit}
                                            minutesUnit={m.timerMinutesUnit}
                                            value={step.timerSeconds}
                                            onChange={(seconds) => list.setTimer(index, seconds)}
                                        />
                                        <Button variant="ghost" onPress={() => list.removeTimer(index)}>
                                            {e.steps.removeTimer}
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="self-start">
                                        <Button variant="ghost" icon="timer" onPress={() => list.revealTimer(index)}>
                                            {e.steps.addTimer}
                                        </Button>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ol>
            )}
            <div className="self-start">
                <Button
                    variant="secondary"
                    icon="plus"
                    onPress={list.add}
                    focusRequested={list.addFocus.requested}
                    onFocusRequestHandled={list.addFocus.onHandled}
                >
                    {e.steps.add}
                </Button>
            </div>
        </div>
    );
};
