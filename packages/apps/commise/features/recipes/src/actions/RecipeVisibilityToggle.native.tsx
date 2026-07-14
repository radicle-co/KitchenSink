/**
 * @module @commise/features-recipes — native recipe visibility toggle (T074 building block).
 *
 * The React Native leaf of {@link import('./RecipeVisibilityToggle.js').RecipeVisibilityToggle} — same
 * controlled radio-group contract: the current `visibility` is the checked option, selections report upward
 * via `onChange`, and the private option is disabled with its (localized) `disabledReason` shown when the
 * tier cannot go private (C-004). State rides on the radio's checked/disabled semantics and text, not colour.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

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

    return (
        <View accessibilityRole="radiogroup" accessibilityLabel={messages.groupLabel}>
            <Pressable
                accessibilityRole="radio"
                accessibilityLabel={messages.publicLabel}
                aria-checked={visibility === RecipeVisibility.PUBLIC}
                onPress={() => onChange(RecipeVisibility.PUBLIC)}
            >
                <Text>{messages.publicLabel}</Text>
            </Pressable>
            <Pressable
                accessibilityRole="radio"
                accessibilityLabel={messages.privateLabel}
                aria-checked={visibility === RecipeVisibility.PRIVATE}
                disabled={!canGoPrivate}
                onPress={selectPrivate}
            >
                <Text>{messages.privateLabel}</Text>
            </Pressable>
            {showReason && <Text>{disabledReason}</Text>}
        </View>
    );
};
