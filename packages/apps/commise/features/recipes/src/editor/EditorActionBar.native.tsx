/**
 * @module @commise/features-recipes/editor — the native editor's action bar (build spec §7.1, §7.8, §7.12): Preview,
 * then the primary at the end, in the thumb zone — Publish for a recipe not yet published, Save changes for a
 * published one. Its material is the editor's one glass surface (owner D12): real Liquid Glass on iOS 26, solid
 * elsewhere (`ChromeSurface`).
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import { ChromeSurface } from '@commise/ui/chrome-surface';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { EditorActionBarProps } from './frameProps.js';

/** The native editor's action bar. */
export const EditorActionBar: FC<EditorActionBarProps> = ({
    label,
    previewLabel,
    onPreview,
    primaryLabel,
    onPrimary,
    primaryDisabled,
    busy,
    fixLine,
    readyLine,
    notice,
    keyboardShown = false,
}) => {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();

    return (
        <View
            style={[
                styles.bar,
                // The keyboard covers the system navigation bar, so its inset would be a dead band above the keys.
                {
                    paddingBottom: keyboardShown
                        ? nativeTokens.spacing[3]
                        : Math.max(nativeTokens.spacing[3], insets.bottom),
                },
            ]}
        >
            <ChromeSurface edge="top" />
            {notice}
            <LiveRegion politeness="polite" style={[styles.fix, { color: colors.dangerText }]}>
                {fixLine ?? ''}
            </LiveRegion>
            <LiveRegion politeness="polite" style={[styles.fix, { color: colors.inkMuted }]}>
                {readyLine ?? ''}
            </LiveRegion>
            <View collapsable={false} role="group" aria-label={label} style={styles.controls}>
                <Button variant="secondary" icon="eye" onPress={onPreview} disabled={busy}>
                    {previewLabel}
                </Button>
                <Button icon="check" onPress={onPrimary} busy={busy} disabled={primaryDisabled}>
                    {primaryLabel}
                </Button>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    bar: {
        gap: nativeTokens.spacing[2],
        paddingTop: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
    },
    fix: { ...nativeTokens.type.meta },
    controls: {
        flexDirection: 'row',
        // Wrap, never shrink-and-overflow: at 200% text the two buttons can be wider than the bar, and an unwrapped
        // end-aligned row pushes the first one off the leading edge. Wrapped, Preview sits above Publish (build spec §1.1).
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: nativeTokens.spacing[3],
    },
});
