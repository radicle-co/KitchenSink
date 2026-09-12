/**
 * @module @commise/features-recipes/parse — NATIVE paste leaf.
 *
 * The React Native twin of `ParsePasteForm.tsx`: same {@link ParsePasteFormProps} contract, same states,
 * same withheld-refusal rule on an untouched field. A pure `props → JSX` render — the admission verdict
 * arrives already computed, so the two platforms cannot disagree about what is admissible.
 *
 * PLATFORM FORK, recorded: this leaf uses a `multiline` `TextInput` rather than `@commise/ui`'s `Input`.
 * `InputProps` exposes no `multiline`, and widening the shared primitive for one caller would change every
 * existing field's contract for a paste box — the same reasoning `IngredientPicker.native.tsx` applies to
 * its own search field. The primitive's own conventions ARE kept: the 44dp touch floor, `nativeTokens` for
 * every metric, `palette` for every colour, and the label/`role="alert"` pairing.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette, semantic } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { recipeParseMessages } from './messages.js';
import { formatParseLineCount } from './model.js';
import type { ParsePasteFormProps } from './props.js';

export const ParsePasteForm: FC<ParsePasteFormProps> = ({
    value,
    onChange,
    submission,
    onSubmit,
    submitting,
    errorNotice,
    onBack,
}) => {
    const messages = useMessages(recipeParseMessages);
    const locale = useLocale();
    // The field is untouched, so its (true) "nothing to read yet" refusal is withheld — an empty field is
    // the resting state, not a mistake the cook has made.
    const refusals = value === '' ? [] : submission.refusals;
    const blocked = !submission.canSubmit || submitting;

    return (
        // ⛔ SCROLLABLE. The 160dp paste box plus an on-screen keyboard pushes the submit control off a
        // phone screen, and every sibling native leaf reaches for a scroll container for the same reason.
        // A plain `View` clipped it with no way to reach it — invisible under jsdom, which hit-tests nothing.
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={styles.heading}>
                {messages.pasteHeading}
            </Text>
            <Text style={styles.intro}>{messages.pasteIntro}</Text>

            <View style={styles.field}>
                {/*
                 * VISUAL ONLY, and hidden from the accessibility tree on purpose: the field below already
                 * carries `pasteLabel` as its accessible NAME, so leaving this node visible to assistive tech
                 * announces "Ingredient lines" twice — and it put TWO nodes with that exact text on the
                 * screen, the label first. That ambiguity is what left the Maestro flow with nothing safe to
                 * tap: the placeholder is shadowed by the input's own `accessibilityLabel` (unlike the auth
                 * fields, which pass none to `@commise/ui`'s `Input` and so expose theirs), and the label
                 * text resolved to this inert `Text` rather than the field. The sibling `IngredientPicker`
                 * search box is the shape that works — one input, one accessible name, no duplicate node.
                 */}
                <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.label}>
                    {messages.pasteLabel}
                </Text>
                <TextInput
                    accessibilityLabel={messages.pasteLabel}
                    value={value}
                    onChangeText={onChange}
                    placeholder={messages.pastePlaceholder}
                    placeholderTextColor={palette.slate}
                    multiline
                    numberOfLines={10}
                    textAlignVertical="top"
                    style={styles.input}
                />
            </View>

            <Text style={styles.count}>
                {formatParseLineCount(submission.lineCount, messages.pasteLineCount, locale)}
            </Text>

            {refusals.map((refusal) => (
                <Text key={refusal} role="alert" style={styles.error}>
                    {refusal}
                </Text>
            ))}

            {errorNotice !== undefined && (
                <Text role="alert" style={styles.error}>
                    {errorNotice}
                </Text>
            )}

            {submitting && (
                <Text role="status" style={styles.intro}>
                    {messages.pasteSubmitting}
                </Text>
            )}

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.pasteSubmit}
                // All three forms are load-bearing: `accessibilityState` is the trait VoiceOver/TalkBack
                // read, `disabled` is what react-native-web projects into the DOM and what blocks the
                // press, and `aria-busy` is the ONLY one of the three that reaches the DOM at all —
                // react-native-web projects `accessibilityState` for nothing (`native-a11y` lint rule).
                // React Native reverse-maps the ARIA prop back into `accessibilityState`, so keeping both
                // is correct on device as well.
                accessibilityState={{ disabled: blocked, busy: submitting }}
                aria-busy={submitting}
                disabled={blocked}
                onPress={onSubmit}
                style={[styles.submit, blocked && styles.submitDisabled]}
            >
                <Text style={styles.submitLabel}>{messages.pasteSubmit}</Text>
            </Pressable>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.backAction}
                onPress={onBack}
                style={styles.back}
            >
                <Text style={styles.backLabel}>{messages.backAction}</Text>
            </Pressable>
        </ScrollView>
    );
};

/** RC-3's touch-target floor, in dp. */
const TOUCH_TARGET_DP = 44;

const styles = StyleSheet.create({
    container: { gap: nativeTokens.spacing[3] },
    heading: { fontSize: nativeTokens.fontSize.headingMd, fontWeight: '600', color: palette.charcoal },
    intro: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
    field: { gap: nativeTokens.spacing[1] },
    label: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette.charcoal },
    input: {
        minHeight: 160,
        borderWidth: 1,
        borderColor: semantic.border,
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
        fontSize: nativeTokens.fontSize.bodyMd,
        color: palette.charcoal,
        backgroundColor: palette.white,
    },
    count: { fontSize: nativeTokens.fontSize.caption, color: palette.slate },
    error: { fontSize: nativeTokens.fontSize.bodySm, color: palette['error-dark'] },
    submit: {
        minHeight: TOUCH_TARGET_DP,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.full,
        paddingHorizontal: nativeTokens.spacing[4],
        backgroundColor: palette.seafoam,
    },
    submitDisabled: { opacity: 0.6 },
    submitLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '600', color: palette['ocean-dark'] },
    back: {
        minHeight: TOUCH_TARGET_DP,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.full,
        paddingHorizontal: nativeTokens.spacing[4],
        backgroundColor: palette.pearl,
    },
    backLabel: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.slate },
});
