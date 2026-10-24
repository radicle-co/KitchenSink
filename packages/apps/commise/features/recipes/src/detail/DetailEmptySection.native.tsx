/**
 * @module @commise/features-recipes — an empty section of the native recipe page (build spec §6.7): the mirror of
 * `DetailEmptySection.tsx`. Its line, and for the owner the ghost action that opens the editor at that section.
 * Presentational; colours from the theme at render.
 */
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Props for {@link DetailEmptySection}. */
export interface DetailEmptySectionProps {
    /** The section's empty line ("No steps yet."). */
    readonly text: string;
    /** The owner's action ("Add steps"). */
    readonly actionLabel: string;
    /** Opens the editor at this section, for the owner; absent for another cook. */
    readonly onAction: (() => void) | undefined;
}

/** The native empty section. */
export const DetailEmptySection: FC<DetailEmptySectionProps> = ({ text, actionLabel, onAction }) => {
    const { colors } = useTheme();

    return (
        <View style={styles.empty}>
            <Text style={[styles.text, { color: colors.inkMuted }]}>{text}</Text>
            {onAction !== undefined && (
                <Button variant="ghost" size="sm" icon="plus" onPress={onAction}>
                    {actionLabel}
                </Button>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    empty: { alignItems: 'flex-start', gap: nativeTokens.spacing[2], paddingVertical: nativeTokens.spacing[2] },
    text: { ...nativeTokens.type.body },
});
