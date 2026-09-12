/**
 * KeyboardAvoider (native) — the one keyboard rule for a screen or a modal's content (`docs/design/compactHeightLayout.md`
 * §9.2): the content is padded up by the part of it the keyboard covers, on both platforms. REWRITTEN: Android used to
 * add nothing, on the premise that the window resizes for the keyboard; an edge-to-edge window does not (E2 I6). It was
 * `ModalKeyboardAvoider`, the Sheet's and the centred dialog frame's; the screens use it too now.
 *
 * ⚠️ The real `KeyboardAvoidingView` is wrapped to record its props, and `Platform.OS` is served by the test:
 * react-native-web is neither platform.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { createElement, type ComponentProps } from 'react';
import { Text, type KeyboardAvoidingView as KeyboardAvoidingViewType } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KeyboardAvoider } from '../KeyboardAvoider.native.js';

const state = vi.hoisted(() => ({
    os: 'ios' as 'ios' | 'android',
    avoider: undefined as ComponentProps<typeof KeyboardAvoidingViewType> | undefined,
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return state.os;
            },
        },
        KeyboardAvoidingView: (props: ComponentProps<typeof KeyboardAvoidingViewType>) => {
            state.avoider = props;

            return createElement(actual.KeyboardAvoidingView, props);
        },
    };
});

afterEach(() => {
    cleanup();
    state.avoider = undefined;
});

describe('KeyboardAvoider (native)', () => {
    it('pads the content up by the keyboard on iOS, where the keyboard overlays the window', () => {
        state.os = 'ios';
        render(
            <KeyboardAvoider style={{ flex: 1 }}>
                <Text>Body</Text>
            </KeyboardAvoider>,
        );

        expect(state.avoider?.behavior).toBe('padding');
        expect(state.avoider?.style).toStrictEqual({ flex: 1 });
        expect(screen.getByText('Body')).toBeTruthy();
    });

    it('pads the content up by the keyboard on Android too, whose edge-to-edge window does not resize for it', () => {
        state.os = 'android';
        render(
            <KeyboardAvoider>
                <Text>Body</Text>
            </KeyboardAvoider>,
        );

        expect(state.avoider?.behavior).toBe('padding');
    });
});
