/**
 * Component tests for the WEB {@link VoiceControlToggle} — the control whose press IS the cook's
 * microphone consent (US-006 / D-004, spec.md; NFR-003, NFR-004).
 *
 * Four states, four assertions apiece, because the whole point of this leaf is that a cook can tell —
 * without hearing anything and without perceiving colour — whether the kitchen is listening to them:
 *
 *  - the accessible NAME states the control and its state together, so `getByRole` selection is exact;
 *  - `aria-pressed` carries the on/off fact to assistive tech;
 *  - the state WORD is rendered as text (never colour alone, NFR-004) and the glyph beside it is
 *    `aria-hidden`, so the name cannot drift with the artwork;
 *  - the two unavailable states stay MOUNTED and explained rather than vanishing, and are wired to no
 *    handler at all — a structural no-op, not a runtime `if` a later edit can drop.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoiceControlToggle } from '../VoiceControlToggle';
import type { VoiceControlState } from '../voiceControlModel';

afterEach(() => {
    cleanup();
});

/** Renders the toggle in one state and returns the spy the control reports through. */
const renderToggle = (state: VoiceControlState) => {
    const onToggle = vi.fn();

    render(
        <LocaleProvider locale="en">
            <VoiceControlToggle state={state} onToggle={onToggle} />
        </LocaleProvider>,
    );

    return onToggle;
};

describe('VoiceControlToggle (web) — the four states are distinguishable without colour (NFR-004)', () => {
    it('names itself "Voice control Off" when idle, unpressed, and reports a press', () => {
        const onToggle = renderToggle('idle');
        const control = screen.getByRole('button', { name: 'Voice control Off' });

        expect(control.getAttribute('aria-pressed')).toBe('false');
        expect(control.getAttribute('aria-disabled')).toBeNull();

        fireEvent.click(control);

        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('names itself "Voice control Listening" when listening, PRESSED, and reports a press to stop', () => {
        const onToggle = renderToggle('listening');
        const control = screen.getByRole('button', { name: 'Voice control Listening' });

        expect(control.getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(control);

        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('states a DENIED microphone in words, explains it, and is wired to no handler', () => {
        const onToggle = renderToggle('denied');
        const control = screen.getByRole('button', { name: 'Voice control Microphone blocked' });

        expect(control.getAttribute('aria-disabled')).toBe('true');
        expect(control.getAttribute('aria-pressed')).toBe('false');

        const hintId = control.getAttribute('aria-describedby');

        expect(hintId).not.toBeNull();
        expect(document.getElementById(hintId ?? '')?.textContent).toBe(
            'Cooking mode cannot hear you until microphone access is allowed in your device settings.',
        );

        fireEvent.click(control);

        expect(onToggle).not.toHaveBeenCalled();
    });

    it('renders as UNAVAILABLE rather than vanishing when the platform has no recogniser', () => {
        const onToggle = renderToggle('unsupported');
        const control = screen.getByRole('button', { name: 'Voice control Not available' });

        expect(control.getAttribute('aria-disabled')).toBe('true');

        const hintId = control.getAttribute('aria-describedby');

        expect(document.getElementById(hintId ?? '')?.textContent).toBe(
            'This device cannot listen for voice commands. Use the on-screen controls.',
        );

        fireEvent.click(control);

        expect(onToggle).not.toHaveBeenCalled();
    });

    it('keeps the glyph decorative, so the accessible name is carried by the words alone', () => {
        renderToggle('listening');

        const control = screen.getByRole('button', { name: 'Voice control Listening' });

        expect(control.querySelector('[aria-hidden="true"]')).not.toBeNull();
        expect(control.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });
});
