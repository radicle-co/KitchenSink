/**
 * @module @commise/features-recipes — native recipe visibility toggle (T074 building block).
 *
 * The React Native leaf of {@link import('./RecipeVisibilityToggle.js').RecipeVisibilityToggle} — same
 * controlled radio-group contract: the current `visibility` is the checked option, selections report upward
 * via `onChange`, and the private option is disabled with its (localized) `disabledReason` shown when the
 * tier cannot go private (C-004). State rides on the radio's checked/disabled semantics and text, not colour.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RecipeVisibility } from '@kitchensink/recipe-core';

import { recipeActionMessages } from './messages.js';
import type { RecipeVisibilityToggleProps } from './model.js';

export const RecipeVisibilityToggle: FC<RecipeVisibilityToggleProps> = ({
    visibility,
    canGoPrivate,
    disabledReason,
    onChange,
}) => {
    const { visibility: messages } = useMessages(recipeActionMessages);
    const showReason = !canGoPrivate && disabledReason !== undefined && disabledReason.length > 0;

    // Enforce the tier gate in the handler too, not only via `disabled`: the component must never emit a
    // transition to a visibility the tier can't select, however the event arrives.
    const selectPrivate = () => {
        if (canGoPrivate) {
            onChange(RecipeVisibility.PRIVATE);
        }
    };

    const isPublic = visibility === RecipeVisibility.PUBLIC;
    const isPrivate = visibility === RecipeVisibility.PRIVATE;

    return (
        <View accessibilityRole="radiogroup" accessibilityLabel={messages.groupLabel} style={styles.wrap}>
            <View style={styles.segment}>
                <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel={messages.publicLabel}
                    aria-checked={isPublic}
                    onPress={() => onChange(RecipeVisibility.PUBLIC)}
                    style={[styles.option, isPublic && styles.optionActive]}
                >
                    <Text style={[styles.optionLabel, isPublic && styles.optionLabelActive]}>
                        {messages.publicLabel}
                    </Text>
                </Pressable>
                <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel={messages.privateLabel}
                    aria-checked={isPrivate}
                    disabled={!canGoPrivate}
                    onPress={selectPrivate}
                    style={[styles.option, isPrivate && styles.optionActive, !canGoPrivate && styles.optionDisabled]}
                >
                    <Text style={[styles.optionLabel, isPrivate && styles.optionLabelActive]}>
                        {messages.privateLabel}
                    </Text>
                </Pressable>
            </View>
            {showReason && <Text style={styles.reason}>{disabledReason}</Text>}
        </View>
    );
};

const styles = StyleSheet.create({
    wrap: { gap: 8 },
    segment: {
        flexDirection: 'row',
        alignSelf: 'flex-start',
        gap: 4,
        backgroundColor: palette.pearl,
        borderRadius: 999,
        padding: 4,
    },
    option: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 18 },
    optionActive: { backgroundColor: palette.white },
    optionDisabled: { opacity: 0.5 },
    optionLabel: { fontSize: 14, fontWeight: '500', color: palette.slate },
    optionLabelActive: { color: palette.charcoal, fontWeight: '600' },
    reason: { fontSize: 13, color: palette.warning },
});
