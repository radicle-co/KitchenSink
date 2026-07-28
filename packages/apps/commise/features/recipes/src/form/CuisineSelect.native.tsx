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
import { palette } from '@commise/ui';
import { Feather } from '@expo/vector-icons';
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
    const [open, setOpen] = useState(false);
    const options = cuisineOptions(value, m);
    const selected = options.find((option) => option.value === value) ?? options[0];

    return (
        <View style={styles.field}>
            <Text style={styles.fieldLabel}>{m.cuisineLabel}</Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={m.cuisineLabel}
                accessibilityState={{ expanded: open }}
                // react-native-web does not forward `accessibilityState.expanded`; set the ARIA attr explicitly.
                aria-expanded={open}
                onPress={() => setOpen((prev) => !prev)}
                style={styles.trigger}
            >
                <Text style={styles.triggerLabel}>{selected?.label ?? m.cuisineUnsetOption}</Text>
                <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={palette.slate} />
            </Pressable>
            {open && (
                <View accessibilityRole="menu" style={styles.menu}>
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
                                style={[styles.option, isSelected && styles.optionSelected]}
                            >
                                <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                                    {option.label}
                                </Text>
                                {isSelected && <Feather name="check" size={16} color={palette.seafoam} />}
                            </Pressable>
                        );
                    })}
                </View>
            )}
        </View>
    );
};

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    field: { gap: 6 },
    fieldLabel: { fontSize: 13, fontWeight: '500', color: palette.slate },
    trigger: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: palette.white,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    // A CUSTOM (non-curated) cuisine value is deliberately preserved and shown here, and RN defaults
    // `flexShrink` to 0 — so a long one used to take its full intrinsic width and push the disclosure chevron
    // (the only affordance that opens this menu) past the field's right edge. Same for an option row's check.
    triggerLabel: { flexShrink: 1, fontSize: 16, color: palette.charcoal },
    menu: {
        borderRadius: 10,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: palette.white,
        overflow: 'hidden',
    },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    optionSelected: { backgroundColor: palette.pearl },
    optionLabel: { flexShrink: 1, fontSize: 16, color: palette.charcoal },
    optionLabelSelected: { fontWeight: '600', color: palette.seafoam },
});
