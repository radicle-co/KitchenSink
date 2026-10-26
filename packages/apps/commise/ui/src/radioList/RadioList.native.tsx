/**
 * @module @commise/ui/radio-list — the native design-system {@link RadioList}.
 *
 * A `radiogroup` of whole-row `Pressable` radios with `aria-checked`. Each row is named by its label and hands its hint
 * to the platform as `accessibilityHint`, read after the name as the web leaf's `aria-describedby` is. Each row keeps
 * the native touch floor: an 18 dp circle (a 2 dp `lineControl` ring at rest, a 5 dp `action` ring when checked), the
 * label that wraps, then the hint under it. A pressed row takes the theme's press wash, as `ChipRow` does. Colours come
 * from the theme at render, so it repaints in the dark scheme. Nothing animates.
 *
 * Controlled with no default: `value` `undefined` checks nothing, and a press reports to `onChange` only.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Registry consumer — `look` picks its group, row and label styles from one closed `LOOK` record; the structure
 *     is shared, so the semantics cannot differ between the looks
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import type { Theme } from '../theme/themeFor.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { RadioListLook, RadioListProps } from './props.js';

/** The radio circle's size, dp (`ingredientMatching.md`: 18 px radios). */
const RADIO_SIZE = 18;

/** The native design-system option list. */
export const RadioList: FC<RadioListProps> = ({ label, options, value, onChange, look }) => {
    const { colors, wash } = useTheme();
    const chrome = LOOK[look];
    const paint = chrome.paint(colors);

    return (
        <View collapsable={false} role="radiogroup" aria-label={label} style={[chrome.group, paint.group]}>
            {options.map((option, index) => {
                const checked = option.id === value;

                return (
                    <Pressable
                        key={option.id}
                        role="radio"
                        aria-checked={checked}
                        accessibilityLabel={option.label}
                        accessibilityHint={option.hint}
                        onPress={() => {
                            onChange(option.id);
                        }}
                        style={({ pressed }) => [
                            styles.row,
                            chrome.row,
                            paint.row,
                            index > 0 ? [chrome.divided, { borderTopColor: colors.lineDivider }] : null,
                            pressed ? { backgroundColor: wash } : null,
                        ]}
                    >
                        <View
                            aria-hidden
                            importantForAccessibility="no-hide-descendants"
                            style={[
                                styles.radio,
                                checked
                                    ? { borderWidth: 5, borderColor: colors.action }
                                    : { borderWidth: 2, borderColor: colors.lineControl },
                            ]}
                        />
                        <View style={styles.words}>
                            <Text style={[chrome.label, { color: colors.ink }]}>{option.label}</Text>
                            {option.hint === undefined ? null : (
                                <Text style={[styles.hint, { color: colors.inkMuted }]}>{option.hint}</Text>
                            )}
                        </View>
                    </Pressable>
                );
            })}
        </View>
    );
};

const styles = StyleSheet.create({
    row: {
        minHeight: nativeTokens.touchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    radio: { width: RADIO_SIZE, height: RADIO_SIZE, borderRadius: RADIO_SIZE / 2, alignSelf: 'flex-start' },
    words: { flex: 1, minWidth: 0 },
    hint: nativeTokens.type.meta,
});

/** One look's chrome. Only the look differs, never the semantics. */
interface LookStyle {
    readonly group: ViewStyle;
    readonly row: ViewStyle;
    /** The edge between a row and the one above it; `cards` draws none, each card having its own. */
    readonly divided: ViewStyle;
    readonly label: TextStyle;
    /** The look's theme colours, painted at render so the list repaints with the scheme. */
    readonly paint: (colors: Theme['colors']) => { readonly group: ViewStyle | null; readonly row: ViewStyle | null };
}

/** Each look's chrome, as the web leaf's `LOOK` record. */
const LOOK: Readonly<Record<RadioListLook, LookStyle>> = {
    // One bordered group on the raised paper, rows divided by hairlines.
    rows: {
        ...StyleSheet.create({
            group: { borderWidth: 1, borderRadius: nativeTokens.radius.md, overflow: 'hidden' },
            row: { paddingHorizontal: nativeTokens.spacing[3] },
            divided: { borderTopWidth: StyleSheet.hairlineWidth },
            label: nativeTokens.type.meta,
        }),
        paint: (colors) => ({
            group: { borderColor: colors.lineDivider, backgroundColor: colors.paperRaised },
            row: null,
        }),
    },
    // Each row its own bordered card on the paper, with a bolder label.
    cards: {
        ...StyleSheet.create({
            group: { gap: nativeTokens.spacing[3] },
            row: { borderWidth: 1, borderRadius: nativeTokens.radius.md, paddingHorizontal: nativeTokens.spacing[4] },
            divided: {},
            label: nativeTokens.type.cardTitle,
        }),
        paint: (colors) => ({ group: null, row: { borderColor: colors.lineDivider, backgroundColor: colors.paper } }),
    },
};
