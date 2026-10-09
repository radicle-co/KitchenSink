/**
 * @module @commise/features-recipes/form — `MoveToGroupSheet` (native): a row's `⋯` Move to group… (build spec
 * §7.5.5). The React Native leaf of `./MoveToGroupSheet.tsx`: 56 pt rows, the line's current group marked with a check
 * and `selected`.
 *
 * Presentational: `props → JSX` over the field group's Move to group view.
 *
 * @pattern Decorator — the sheet frame around a list of choices
 */
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MoveToGroupView } from './useIngredientGroups.js';

/** The Move to group sheet. */
export const MoveToGroupSheet: FC<{ readonly view: MoveToGroupView }> = ({ view }) => {
    const { colors, wash } = useTheme();

    return (
        <Sheet
            open={view.open}
            onOpenChange={(next) => {
                if (!next) {
                    view.onClose();
                }
            }}
            title={view.title}
            closeLabel={view.closeLabel}
            size="content"
        >
            <View>
                {view.choices.map((choice) => (
                    <Pressable
                        key={choice.key}
                        accessibilityRole="button"
                        aria-selected={choice.current}
                        onPress={choice.onSelect}
                        style={({ pressed }) => [styles.choice, pressed && { backgroundColor: wash }]}
                    >
                        <Text style={[styles.label, { color: colors.ink }]}>{choice.label}</Text>
                        {choice.current && (
                            <View aria-hidden>
                                <Icon name="check" size={20} tone="ink" />
                            </View>
                        )}
                    </Pressable>
                ))}
            </View>
        </Sheet>
    );
};

const styles = StyleSheet.create({
    choice: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[2],
        borderRadius: nativeTokens.radius.md,
    },
    label: { ...nativeTokens.type.body, flexShrink: 1 },
});
