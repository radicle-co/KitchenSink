/**
 * @module navigation/ScreenFrame — the safe-area frame every routed screen sits in: the top inset clears the status bar
 * (without it the top row renders UNDER it, and the occluded nodes drop out of the accessibility tree — invisible to
 * screen readers and to Maestro), the side insets clear a camera cutout or a three-button navigation bar in landscape,
 * and — on a focused task with no tab bar under it — the bottom inset clears the home indicator. Inside a tab the bar
 * owns the bottom edge instead.
 *
 * Transparent, so the root `AppCanvas` wash shows through (issue #145).
 *
 * Presentational: props → JSX.
 */
import type { JSX, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Props for {@link ScreenFrame}. */
export interface ScreenFrameProps {
    /** Whether this frame owns the bottom edge: true above the tabs (a focused task), false inside a tab. */
    readonly ownsBottom: boolean;
    readonly children: ReactNode;
}

/**
 * @param props - Whether the frame owns the bottom edge, and the screen.
 * @returns The screen inside the safe-area insets.
 */
export function ScreenFrame({ ownsBottom, children }: ScreenFrameProps): JSX.Element {
    const insets = useSafeAreaInsets();

    return (
        <View
            style={[
                styles.frame,
                {
                    paddingTop: insets.top,
                    paddingLeft: insets.left,
                    paddingRight: insets.right,
                    paddingBottom: ownsBottom ? insets.bottom : 0,
                },
            ]}
        >
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    frame: { flex: 1 },
});
