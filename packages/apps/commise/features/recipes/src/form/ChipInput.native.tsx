/**
 * @module @commise/features-recipes/form/ChipInput — native token (chip) input for the recipe form's tags +
 * dietary-flags fields (U6). The React Native leaf of {@link import('./ChipInput.js').ChipInput} — same
 * controlled contract and same pure transitions ({@link addChip}/{@link removeChipAt}), RN primitives.
 * Replaces the old single comma-separated `TextInput` (`values.tags.join(', ')` → `parseCommaList`): the
 * committed chips live in the form's `values`, only the in-progress draft is local state, and each entry
 * commits ONE chip (trim + case-insensitive de-dupe) via the draft field's submit or the explicit Add control.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Feather } from '@expo/vector-icons';
import type { FC } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeFormMessages } from './messages.js';
import { addChip, removeChipAt } from './props.js';

/** Props for {@link ChipInput}. */
export interface ChipInputProps {
    /** The field's visible + accessible label (also the draft input's accessible name — e.g. "Tags"). */
    readonly label: string;
    /** The committed chips (from the form's `values`). */
    readonly values: readonly string[];
    /** Called with the next chip list on every add or remove. */
    readonly onChange: (next: string[]) => void;
    /** Placeholder shown in the draft text input (the type-and-enter hint). */
    readonly placeholder: string;
    /** Accessible-label template for a chip's remove control (contains `{value}`). */
    readonly removeChipLabel: string;
}

/**
 * The native tag/dietary-flag chip input.
 *
 * @param props - The label, the committed chips, the change handler, the placeholder, and the remove-label
 *   template.
 * @returns The labelled chip row plus the draft text input and its Add control.
 */
export const ChipInput: FC<ChipInputProps> = ({ label, values, onChange, placeholder, removeChipLabel }) => {
    const m = useMessages(recipeFormMessages);
    const [draft, setDraft] = useState('');

    const commit = (): void => {
        const next = addChip(values, draft);

        if (next.length !== values.length) {
            onChange(next);
        }

        setDraft('');
    };

    return (
        <View style={styles.field}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <View style={styles.chipRow}>
                {values.map((value, index) => (
                    <View key={value} style={styles.chip}>
                        <Text style={styles.chipLabel}>{value}</Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={fillTemplate(removeChipLabel, { value })}
                            onPress={() => onChange(removeChipAt(values, index))}
                            style={styles.chipRemove}
                        >
                            {/* Contrast (WCAG 2.1 AA): the `×` is the chip's removal affordance and takes the
                                same tone as the label beside it — seafoam on the chip tint is 3.66:1, and a
                                seafoam × next to an ocean-dark label would render one chip in two greens. */}
                            <Feather name="x" size={14} color={palette['ocean-dark']} />
                        </Pressable>
                    </View>
                ))}
            </View>
            <View style={styles.entryRow}>
                <TextInput
                    accessibilityLabel={label}
                    placeholder={placeholder}
                    // Placeholder text is TEXT, so it takes `slate`, never the `mist` hairline tone — see the
                    // palette JSDoc in `@commise/ui`'s `tokens/colors.ts`.
                    placeholderTextColor={palette.slate}
                    value={draft}
                    onChangeText={setDraft}
                    onSubmitEditing={commit}
                    blurOnSubmit={false}
                    returnKeyType="done"
                    style={styles.input}
                />
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fillTemplate(m.addChipLabel, { field: label })}
                    onPress={commit}
                    style={styles.addButton}
                >
                    <Feather name="plus" size={16} color={palette.charcoal} />
                </Pressable>
            </View>
        </View>
    );
};

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    field: { gap: 6 },
    fieldLabel: { fontSize: 13, fontWeight: '500', color: palette.slate },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    // `chipRow` wraps BETWEEN chips, which cannot help a single over-long tag: RN defaults `flexShrink` to 0,
    // so one long tag used to claim its full intrinsic width and push its OWN remove control off the field —
    // and that control is the only way to remove it, so the tag became permanent. The chip (and its label)
    // therefore yield width while the 20pt remove target never does. The web leaf spells the same pair
    // `min-w-0 break-words` / `shrink-0`.
    chip: {
        flexShrink: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: 999,
        backgroundColor: 'rgba(46, 196, 182, 0.12)',
        paddingVertical: 4,
        paddingLeft: 12,
        paddingRight: 6,
    },
    // Contrast (WCAG 2.1 AA): the chip's tint stays; the label a reader READS takes `ocean-dark`. Mirrors the
    // web leaf's `text-ocean-dark`; see `@commise/ui`'s palette JSDoc for the accent-vs-text split.
    chipLabel: { flexShrink: 1, fontSize: 13, fontWeight: '500', color: palette['ocean-dark'] },
    chipRemove: {
        flexShrink: 0,
        width: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
    },
    entryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    input: {
        flex: 1,
        backgroundColor: palette.white,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: 10,
        paddingHorizontal: 12,
        fontSize: 16,
        color: palette.charcoal,
    },
    addButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: palette.white,
    },
});
