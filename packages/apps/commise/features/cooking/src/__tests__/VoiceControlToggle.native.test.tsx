/**
 * Component tests for the NATIVE {@link VoiceControlToggle}, rendered through react-native-web under
 * jsdom (US-006 / D-004; NFR-003, NFR-004).
 *
 * Mirrors the web suite state-for-state, because the cross-platform rule is that an accessibility fix on
 * one platform cannot silently miss the other. Two native-specific properties are asserted here and
 * nowhere else:
 *
 *  - the device trait AND its web projection are BOTH present — `accessibilityState` reaches no DOM
 *    attribute on react-native-web, so a control carrying only the object would be announced on device
 *    and silent on the web build (the repo's `accessibilityStateNeedsAriaSibling` lint rule exists for
 *    exactly this), and
 *  - the unavailable states are wired to no `onPress`, so the boundary is structural on both platforms.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Explicit `.native` specifier — tsc and the native config's resolver both land on the native leaf.
import { VoiceControlToggle } from '../VoiceControlToggle.native';
import type { VoiceControlState } from '../voiceControlModel';

afterEach(() => {
    cleanup();
});

/** Renders the native toggle in one state and returns the spy the control reports through. */
const renderToggle = (state: VoiceControlState) => {
    const onToggle = vi.fn();

    render(
        <LocaleProvider locale="en">
            <VoiceControlToggle state={state} onToggle={onToggle} />
        </LocaleProvider>,
    );

    return onToggle;
};

describe('VoiceControlToggle (native) — the four states are distinguishable without colour (NFR-004)', () => {
    it('names itself "Voice control Off" when idle, unpressed, and reports a press', () => {
        const onToggle = renderToggle('idle');
        const control = screen.getByRole('button', { name: 'Voice control Off' });

        expect(control.getAttribute('aria-pressed')).toBe('false');

        fireEvent.click(control);

        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('names itself "Voice control Listening" when listening, and projects the PRESSED trait to the web build', () => {
        const onToggle = renderToggle('listening');
        const control = screen.getByRole('button', { name: 'Voice control Listening' });

        expect(control.getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(control);

        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('states a DENIED microphone in words, explains it, and refuses the press', () => {
        const onToggle = renderToggle('denied');
        const control = screen.getByRole('button', { name: 'Voice control Microphone blocked' });

        expect(control.getAttribute('aria-disabled')).toBe('true');
        expect(
            screen.getByText(
                'Cooking mode cannot hear you until microphone access is allowed in your device settings.',
            ),
        ).toBeTruthy();

        fireEvent.click(control);

        expect(onToggle).not.toHaveBeenCalled();
    });

    it('renders as UNAVAILABLE rather than vanishing when the platform has no recogniser', () => {
        const onToggle = renderToggle('unsupported');
        const control = screen.getByRole('button', { name: 'Voice control Not available' });

        expect(control.getAttribute('aria-disabled')).toBe('true');
        expect(
            screen.getByText('This device cannot listen for voice commands. Use the on-screen controls.'),
        ).toBeTruthy();

        fireEvent.click(control);

        expect(onToggle).not.toHaveBeenCalled();
    });
});
