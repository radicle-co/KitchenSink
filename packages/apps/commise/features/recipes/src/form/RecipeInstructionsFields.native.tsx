/**
 * @module @commise/features-recipes/form — `RecipeInstructionsFields` (native): the one-page editor's Steps section
 * (`docs/design/uiOverhaul/buildSpec.md` §7.6, §7.12), the React Native leaf of `./RecipeInstructionsFields.tsx`, on the
 * same props, the same commands and disclosure (`useStepList`) and the same copy.
 *
 * What differs from web, and why: there is no Ctrl/Cmd + Enter shortcut (§7.12 drops it: no hardware keyboard by
 * default), the ⋯ menu is the `ActionMenu`'s bottom sheet, and `onFieldBlur` is not called because no design-system
 * field reports its blur on native. Colours come from the theme at render, so both colour schemes paint (owner D15).
 */
import { useMessages } from '@commise/i18n/react';
import { ActionMenu, type ActionMenuItem } from '@commise/ui/action-menu';
import { Button } from '@commise/ui/button';
import { DurationField } from '@commise/ui/duration-field';
import { FieldLabel, TextArea } from '@commise/ui/input';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { editorMessages } from '../editor/messages.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { stepsErrorId } from './fieldErrorIds.js';
import { stepFieldId } from './fieldIds.js';
import { recipeFormMessages } from './messages.js';
import { applyDraftAction, type RecipeEditorSectionProps } from './props.js';
import { stepsMessage } from './stepsMessage.js';
import { useStepList } from './useStepList.js';

/** The numeral's circle, in points (§7.6). */
const NUMERAL = 32;

/** The Steps section: the list of steps, then Add step. */
export const RecipeInstructionsFields: FC<RecipeEditorSectionProps> = ({ values, errors, onChange }) => {
    const m = useMessages(recipeFormMessages);
    const e = useMessages(editorMessages);
    const { colors } = useTheme();
    const list = useStepList({ values, onChange });
    const refused = stepsMessage(values, errors, e);
    const last = values.steps.length - 1;

    return (
        <View style={styles.section}>
            {refused === undefined ? null : (
                <Text
                    nativeID={stepsErrorId}
                    accessibilityRole="alert"
                    style={[styles.message, { color: colors.dangerText }]}
                >
                    {refused.text}
                </Text>
            )}
            {values.steps.length === 0 ? (
                <Text style={[styles.body, { color: colors.inkMuted }]}>{e.steps.empty}</Text>
            ) : (
                <View collapsable={false} role="list" style={styles.list}>
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
                            <View key={index} collapsable={false} role="listitem" style={styles.step}>
                                <View style={styles.header}>
                                    <View
                                        aria-hidden
                                        style={[styles.numeral, { backgroundColor: colors.selectedFill }]}
                                    >
                                        <Text style={[styles.numeralText, { color: colors.ink }]}>{n}</Text>
                                    </View>
                                    <View style={styles.label}>
                                        <FieldLabel forId={stepFieldId(index)} label={label} />
                                    </View>
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
                                </View>
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
                                    <View style={styles.timer}>
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
                                    </View>
                                ) : (
                                    <View style={styles.start}>
                                        <Button variant="ghost" icon="timer" onPress={() => list.revealTimer(index)}>
                                            {e.steps.addTimer}
                                        </Button>
                                    </View>
                                )}
                            </View>
                        );
                    })}
                </View>
            )}
            <View style={styles.start}>
                <Button
                    variant="secondary"
                    icon="plus"
                    onPress={list.add}
                    focusRequested={list.addFocus.requested}
                    onFocusRequestHandled={list.addFocus.onHandled}
                >
                    {e.steps.add}
                </Button>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    section: { gap: nativeTokens.spacing[4] },
    list: { gap: nativeTokens.spacing[6] },
    step: { gap: nativeTokens.spacing[2] },
    header: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[3] },
    numeral: {
        width: NUMERAL,
        height: NUMERAL,
        borderRadius: NUMERAL / 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    numeralText: { ...nativeTokens.type.label, fontVariant: ['tabular-nums'] },
    label: { flex: 1, minWidth: 0 },
    timer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: nativeTokens.spacing[3] },
    start: { alignSelf: 'flex-start' },
    body: nativeTokens.type.body,
    message: nativeTokens.type.label,
});
