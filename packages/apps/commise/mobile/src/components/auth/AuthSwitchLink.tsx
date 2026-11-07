/**
 * @module components/auth/AuthSwitchLink — the "New to Commise? Create an account" row at the foot of both signed-out
 * screens (`buildSpec.md` §8 Order): the prompt, then an inline LINK, wrapping to a second line rather than
 * overflowing. Sign-in and sign-up differ only in the words and the handler, so the shape lives here once.
 *
 * The row wraps first, so the link moves under its prompt on a narrow screen. When the link alone is wider than the
 * screen, at the system's largest text, its label wraps too: a control's label is never cut off (owner ruling; it read
 * "Create an accou.." at Android font_scale 3.1). Its target is 48 px tall.
 *
 * Presentational: props → JSX.
 */
import { nativeTokens } from '@commise/ui/native';
import { PressScale } from '@commise/ui/press-scale';
import { Text } from '@commise/ui/text';
import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

/** Props for {@link AuthSwitchLink}. */
export interface AuthSwitchLinkProps {
    /** The question the link answers, e.g. "New to Commise?". */
    readonly prompt: string;
    /** The link's text, which is also its accessible name. */
    readonly label: string;
    /** Moves to the other screen. */
    readonly onPress: () => void;
    /** The screen is busy (a sign-in is in flight): the link takes no press. */
    readonly disabled?: boolean;
}

/**
 * @param props - The prompt, the link text and its handler.
 * @returns A wrapping row of the prompt and the link.
 */
export function AuthSwitchLink({ prompt, label, onPress, disabled = false }: AuthSwitchLinkProps): JSX.Element {
    return (
        <View style={styles.row}>
            <Text typeRole="meta" color="$inkMuted">
                {prompt}
            </Text>
            <PressScale accessibilityRole="link" accessibilityLabel={label} disabled={disabled} onPress={onPress}>
                <View style={styles.target}>
                    <Text typeRole="meta" color="$actionText" textDecorationLine="underline">
                        {label}
                    </Text>
                </View>
            </PressScale>
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: nativeTokens.spacing[2] },
    // The glyphs are small; the TARGET is the 48 px the touch rule asks for.
    target: { minHeight: 48, justifyContent: 'center' },
});
