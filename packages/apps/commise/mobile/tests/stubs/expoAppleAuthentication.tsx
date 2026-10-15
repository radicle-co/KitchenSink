/**
 * Vitest stand-in for `expo-apple-authentication` (plan 012). The real `AppleAuthenticationButton` is a native view
 * (`ASAuthorizationAppleIDButton`) with no jsdom runtime. The stub renders a button whose accessible name is the label
 * the system draws for each `buttonType`, and exposes the style props as data attributes so a suite can assert the
 * HIG choices (button type, style per colour scheme, corner radius) without a device.
 */
import { createElement, type JSX } from 'react';

export const AppleAuthenticationButtonType = { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 } as const;
export const AppleAuthenticationButtonStyle = { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 } as const;

const SYSTEM_LABELS: Readonly<Record<number, string>> = {
    0: 'Sign in with Apple',
    1: 'Continue with Apple',
    2: 'Sign up with Apple',
};
const STYLE_NAMES: Readonly<Record<number, string>> = { 0: 'WHITE', 1: 'WHITE_OUTLINE', 2: 'BLACK' };

interface StubProps {
    readonly onPress: () => void;
    readonly buttonType: number;
    readonly buttonStyle: number;
    readonly cornerRadius?: number;
    readonly pointerEvents?: string;
}

export function AppleAuthenticationButton({
    onPress,
    buttonType,
    buttonStyle,
    cornerRadius,
    pointerEvents,
}: StubProps): JSX.Element {
    return createElement(
        'button',
        {
            type: 'button',
            onClick: onPress,
            'data-button-style': STYLE_NAMES[buttonStyle],
            'data-corner-radius': cornerRadius,
            'data-pointer-events': pointerEvents,
        },
        SYSTEM_LABELS[buttonType],
    );
}
