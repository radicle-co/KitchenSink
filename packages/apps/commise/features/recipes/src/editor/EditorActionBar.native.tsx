/**
 * @module @commise/features-recipes/editor — the native editor's action bar (build spec §7.1, §7.8, §7.12): Preview,
 * then the primary at the end, in the thumb zone — Publish for a recipe not yet published, Save changes for a
 * published one. Its material is the editor's one glass surface (owner D12): real Liquid Glass on iOS 26, solid
 * elsewhere (`ChromeSurface`).
 *
 * While a finish waits for its photos (`finishing`), Preview and the primary give way to one secondary control,
 * "Finish without the remaining photos", under a line that says what is happening.
 *
 * Presentational: props → JSX.
 *
 * @pattern State — the controls follow the editor's phase: editing (Preview, primary) or waiting for photos (Finish)
 */
import { Button } from '@commise/ui/button';
import { ChromeSurface } from '@commise/ui/chrome-surface';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
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
    finishing,
    keyboardShown = false,
}) => {
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
            <LiveRegion politeness="polite" typeRole="meta" tone="dangerText">
                {fixLine ?? (finishing?.danger === true ? finishing.line : '')}
            </LiveRegion>
            <LiveRegion politeness="polite" typeRole="meta" tone="inkMuted">
                {readyLine ?? (finishing?.danger === false ? finishing.line : '')}
            </LiveRegion>
            <View collapsable={false} role="group" aria-label={label} style={styles.controls}>
                {finishing === undefined ? (
                    <>
                        <Button variant="secondary" icon="eye" onPress={onPreview} disabled={busy}>
                            {previewLabel}
                        </Button>
                        <Button icon="check" onPress={onPrimary} busy={busy} disabled={primaryDisabled}>
                            {primaryLabel}
                        </Button>
                    </>
                ) : (
                    <Button
                        variant="secondary"
                        onPress={finishing.onAction}
                        focusRequested={finishing.focusRequested}
                        onFocusRequestHandled={finishing.onFocusRequestHandled}
                    >
                        {finishing.actionLabel}
                    </Button>
                )}
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
