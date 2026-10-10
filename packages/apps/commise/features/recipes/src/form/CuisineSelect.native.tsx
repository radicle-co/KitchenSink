/**
 * @module @commise/features-recipes/form/CuisineSelect — native cuisine dropdown for the recipe form (U6).
 * Replaces the native Basics section's cuisine RADIO-CHIP CLOUD (a wrapping row of every curated cuisine as a
 * tappable radio) with a compact Select/dropdown, matching the web leaf's `<select>` and freeing the step-1
 * layout the radio cloud dominated. The web platform keeps its native `<select>`; this is the RN parity.
 *
 * Presentational + controlled: a trigger showing the current selection which, when open, expands the ordered
 * {@link cuisineOptions} (the SAME "no cuisine" clear + custom-value-preservation + curated list the web
 * dropdown renders, so the two platforms cannot drift), each a tappable option that reports the chosen wire
 * value up via `onChange` and collapses the list. The custom-value case keeps a preselected non-curated
 * cuisine visible and selected instead of silently dropping it.
 */
import { useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { FIELD_EDGE, fieldGeometry } from '@commise/ui/input';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeFormMessages } from './messages.js';
import { cuisineOptions } from './props.js';

/** Props for {@link CuisineSelect}. */
export interface CuisineSelectProps {
    /** The form's current cuisine wire value (`''` = no cuisine). */
    readonly value: string;
    /** Called with the chosen wire value (`''` clears it). */
    readonly onChange: (cuisine: string) => void;
}

/**
 * The native cuisine dropdown.
 *
 * @param props - The current cuisine value and its change handler.
 * @returns The select trigger and, when open, the option list.
 */
export const CuisineSelect: FC<CuisineSelectProps> = ({ value, onChange }) => {
    const m = useMessages(recipeFormMessages);
    const { colors } = useTheme();
    const [open, setOpen] = useState(false);
    const options = cuisineOptions(value, m);
    const selected = options.find((option) => option.value === value) ?? options[0];

    return (
        <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.inkMuted }]}>{m.cuisineLabel}</Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={m.cuisineLabel}
                accessibilityState={{ expanded: open }}
                // react-native-web does not forward `accessibilityState.expanded`; set the ARIA attr explicitly.
                aria-expanded={open}
                onPress={() => setOpen((prev) => !prev)}
                style={[styles.trigger, { backgroundColor: colors.paper, borderColor: colors.lineControl }]}
            >
                <Text style={[styles.triggerLabel, { color: colors.ink }]}>
                    {selected?.label ?? m.cuisineUnsetOption}
                </Text>
                <Icon name={open ? 'chevronUp' : 'chevronDown'} size={20} tone="inkMuted" />
            </Pressable>
            {open && (
                <View
                    collapsable={false}
                    accessibilityRole="menu"
                    style={[styles.menu, { backgroundColor: colors.paperRaised, borderColor: colors.lineControl }]}
                >
                    {options.map((option) => {
                        const isSelected = option.value === value;

                        return (
                            <Pressable
                                key={option.value === '' ? '__none__' : option.value}
                                accessibilityRole="menuitem"
                                accessibilityLabel={option.label}
                                accessibilityState={{ selected: isSelected }}
                                // react-native-web does not forward `accessibilityState.selected` to
                                // `aria-selected` — set it explicitly so AT (and tests) see the selection.
                                aria-selected={isSelected}
                                onPress={() => {
                                    onChange(option.value);
                                    setOpen(false);
                                }}
                                style={[styles.option, isSelected ? { backgroundColor: colors.selectedFill } : null]}
                            >
                                <Text
                                    style={[
                                        styles.optionLabel,
                                        { color: isSelected ? colors.actionText : colors.ink },
                                        isSelected ? styles.optionLabelSelected : null,
                                    ]}
                                >
                                    {option.label}
                                </Text>
                                {/* Contrast (WCAG 2.1 AA): the check is this row's selection affordance and
                                    carries the same tone as the label beside it — seafoam on the pearl
                                    highlight is 3.68:1, and a two-tone row would read as two states. */}
                                {isSelected && <Icon name="check" size={16} tone="actionText" />}
                            </Pressable>
                        );
                    })}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    field: { gap: nativeTokens.spacing[1] },
    fieldLabel: nativeTokens.type.label,
    trigger: {
        ...fieldGeometry,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderWidth: FIELD_EDGE,
    },
    // A CUSTOM (non-curated) cuisine value is deliberately preserved and shown here, and RN defaults
    // `flexShrink` to 0 — so a long one used to take its full intrinsic width and push the disclosure chevron
    // (the only affordance that opens this menu) past the field's right edge. Same for an option row's check.
    triggerLabel: { ...nativeTokens.type.body, flexShrink: 1 },
    menu: { borderRadius: nativeTokens.radius.md, borderWidth: FIELD_EDGE, overflow: 'hidden' },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 44,
        paddingHorizontal: nativeTokens.spacing[3],
    },
    optionLabel: { ...nativeTokens.type.body, flexShrink: 1 },
    optionLabelSelected: { fontWeight: nativeTokens.fontWeight.semibold },
});
