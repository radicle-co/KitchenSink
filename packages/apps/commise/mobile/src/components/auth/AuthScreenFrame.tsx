/**
 * @module components/auth/AuthScreenFrame — the shell every signed-out screen (sign-in, sign-up, the social finish
 * step) stands in: the safe area, keyboard avoidance so the keyboard never occludes an input, and a scroll that keeps
 * a tap on a control working while the keyboard is up.
 *
 * The root is TRANSPARENT so the root `AppCanvas` beach-glow gradient shows through (issue #145); an opaque fill here
 * occludes the whole canvas and restores the flat page the wireframes never had.
 *
 * @pattern Decorator — wraps a screen's content in the safe-area, keyboard and scroll shell the three signed-out
 *     screens used to copy
 */
import { KeyboardAvoider } from '@commise/ui/keyboard-avoider';
import { nativeTokens } from '@commise/ui/native';
import type { JSX, ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Props for {@link AuthScreenFrame}. */
export interface AuthScreenFrameProps {
    /** The screen's sections, in reading order; the frame spaces them. */
    readonly children: ReactNode;
}

/**
 * The frame a signed-out screen stands in. Presentational: props → JSX, no state of its own.
 *
 * @param props - The screen's content.
 * @returns The content inside the safe area, keyboard avoidance and scroll.
 */
export function AuthScreenFrame({ children }: AuthScreenFrameProps): JSX.Element {
    return (
        <SafeAreaView style={styles.safe}>
            <KeyboardAvoider style={styles.flex}>
                <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
                    {children}
                </ScrollView>
            </KeyboardAvoider>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    flex: { flex: 1 },
    container: {
        flexGrow: 1,
        gap: nativeTokens.spacing[5],
        paddingHorizontal: nativeTokens.spacing[5],
        paddingVertical: nativeTokens.spacing[6],
    },
});
