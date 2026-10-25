/**
 * @module @commise/ui/radio-list — the native design-system {@link RadioList}.
 *
 * A `radiogroup` of whole-row `Pressable` radios with `aria-checked` — the row is the control, so the label, the tag and
 * the hint are read as its name. Each row is at least 48 dp tall: an 18 dp circle (a 2 dp `lineControl` ring at rest, a
 * 5 dp `action` ring when checked), the label in `meta` type that wraps, then the quiet tag as a `note` badge. Colours
 * come from the theme at render, so it repaints in the dark scheme. Nothing animates.
 *
 * Controlled with no default: `value` `undefined` checks nothing, and a press reports to `onChange` only.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Composite — the group owns the `radiogroup` semantics and the one value its rows cannot state alone
 * @pattern Registry consumer — `look` picks its group style from a closed `Record`; the structure is shared, so the
 *     semantics cannot differ between the looks
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { StatusBadge } from '../statusBadge/StatusBadge.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { RadioListLook, RadioListProps } from './props.js';

/** The radio circle's size, dp (`ingredientMatching.md`: 18 px radios). */
const RADIO_SIZE = 18;

/** The touch floor every row keeps, dp. */
const ROW_MIN_HEIGHT = 48;

/** The native design-system option list. */
export const RadioList: FC<RadioListProps> = ({ label, options, value, onChange, look }) => {
    const { colors } = useTheme();
    const cards = look === 'cards';
    const groupStyle = LOOK_GROUP[look];

    return (
        <View
            collapsable={false}
            role="radiogroup"
            aria-label={label}
            style={[
                groupStyle,
                cards ? null : { borderColor: colors.lineDivider, backgroundColor: colors.paperRaised },
            ]}
        >
            {options.map((option, index) => {
                const checked = option.id === value;

                return (
                    <Pressable
                        key={option.id}
                        role="radio"
                        aria-checked={checked}
                        onPress={() => onChange(option.id)}
                        style={[
                            styles.row,
                            cards
                                ? [styles.card, { borderColor: colors.lineDivider, backgroundColor: colors.paper }]
                                : index > 0
                                  ? [styles.divided, { borderTopColor: colors.lineDivider }]
                                  : null,
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
                            <Text style={[cards ? styles.cardLabel : styles.label, { color: colors.ink }]}>
                                {option.label}
                            </Text>
                            {option.hint === undefined ? null : (
                                <Text style={[styles.hint, { color: colors.inkMuted }]}>{option.hint}</Text>
                            )}
                        </View>
                        {option.tag === undefined ? null : <StatusBadge status="note">{option.tag}</StatusBadge>}
                    </Pressable>
                );
            })}
        </View>
    );
};

const styles = StyleSheet.create({
    rowsGroup: { borderWidth: 1, borderRadius: nativeTokens.radius.md, overflow: 'hidden' },
    cardsGroup: { gap: nativeTokens.spacing[3] },
    row: {
        minHeight: ROW_MIN_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    card: { borderWidth: 1, borderRadius: nativeTokens.radius.md, paddingHorizontal: nativeTokens.spacing[4] },
    divided: { borderTopWidth: StyleSheet.hairlineWidth },
    radio: { width: RADIO_SIZE, height: RADIO_SIZE, borderRadius: RADIO_SIZE / 2, alignSelf: 'flex-start' },
    words: { flex: 1, minWidth: 0 },
    label: nativeTokens.type.meta,
    cardLabel: nativeTokens.type.cardTitle,
    hint: nativeTokens.type.meta,
});

/** Each look's group style. */
const LOOK_GROUP: Readonly<Record<RadioListLook, StyleProp<ViewStyle>>> = {
    rows: styles.rowsGroup,
    cards: styles.cardsGroup,
};
