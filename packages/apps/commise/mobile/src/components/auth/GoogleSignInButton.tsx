/**
 * @module components/auth/GoogleSignInButton — "Continue with Google", drawn to Google's sign-in branding guidelines
 * (plan 012 D9/D9a): the light theme in both colour schemes (white fill, a 1 pt `#747775` edge, `#1F1F1F` text) and
 * the official four-colour G, never recoloured.
 *
 * It is not the design system's `Button` on purpose: `Button` paints its glyph in the label's colour, which is exactly
 * the recolouring Google forbids, and a brand control whose look its owner specifies is not a design-system tier. It
 * still stands at a `Button`'s `lg` height ({@link BUTTON_VISUAL_HEIGHT}) as a capsule, so the three sign-in controls
 * share one size and weight. ⚠️ The label uses the app's `label` type role (Inter), not Google Sans — the web Clerk
 * button does the same; a recorded branding risk.
 *
 * The mark is decorative (`aria-hidden`), so the accessible name is the visible label (WCAG 2.2 SC 2.5.3).
 *
 * Presentational: props → JSX.
 */
import { BUTTON_VISUAL_HEIGHT } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import type { JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { Path, Svg } from 'react-native-svg';

/** Google's light-theme button palette (sign-in branding guidelines) — brand colours, not app colour roles. */
const GOOGLE_LIGHT = { fill: '#FFFFFF', edge: '#747775', text: '#1F1F1F' } as const;

const HEIGHT = BUTTON_VISUAL_HEIGHT.lg;

/** Props for {@link GoogleSignInButton}. */
export interface GoogleSignInButtonProps {
    /** The visible label, which is also the accessible name. */
    readonly label: string;
    readonly onPress: () => void;
    /** Locks the control (another sign-in is in flight). */
    readonly disabled: boolean;
    /** This provider's sheet is up: a spinner replaces the mark. */
    readonly busy: boolean;
}

/** The official Google "G", from Google's sign-in button assets (48-unit view box). */
function GoogleMark(): JSX.Element {
    return (
        <Svg width={20} height={20} viewBox="0 0 48 48" aria-hidden>
            <Path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <Path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <Path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <Path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
        </Svg>
    );
}

/**
 * @param props - The label, the press handler and the lock / busy state.
 * @returns The Google sign-in button.
 */
export function GoogleSignInButton({ label, onPress, disabled, busy }: GoogleSignInButtonProps): JSX.Element {
    return (
        <Pressable
            role="button"
            accessibilityLabel={label}
            aria-disabled={disabled}
            aria-busy={busy}
            disabled={disabled}
            onPress={onPress}
            style={[styles.button, disabled && !busy ? styles.dimmed : null]}
        >
            {busy ? <ActivityIndicator color={GOOGLE_LIGHT.text} /> : <GoogleMark />}
            <Text style={styles.label}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    button: {
        minHeight: HEIGHT,
        borderRadius: HEIGHT / 2,
        borderWidth: 1,
        borderColor: GOOGLE_LIGHT.edge,
        backgroundColor: GOOGLE_LIGHT.fill,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
        alignSelf: 'stretch',
    },
    // The same 40% the design system dims a locked control to (§1.10).
    dimmed: { opacity: 0.4 },
    // The label wraps rather than truncates; it is never `nowrap` (owner rule on control text).
    label: { ...nativeTokens.type.label, color: GOOGLE_LIGHT.text, flexShrink: 1, textAlign: 'center' },
});
