/**
 * `SocialSignInButtons` — the provider group above the email form on both signed-out screens (plan 012 D9, D10; the
 * staff-ux-engineer SPECIFY of 2026-10-15). Pure: what it draws follows from its props alone.
 *
 * What is pinned, and why each is a real failure rather than taste:
 *
 * - ORDER and PRESENCE: Apple then Google, and NO group and NO "or" divider when the build offers no provider (prod
 *   Android) — a divider over nothing reads as a missing control.
 * - The Apple button is the SYSTEM button (`CONTINUE`, a capsule) whose style follows the scheme: `WHITE_OUTLINE` on
 *   light, `WHITE` on dark — a black Apple pill beside a white Google one breaks Google's "same visual weight".
 * - The Google mark keeps Google's four colours (its branding forbids a recoloured G) and is hidden from screen readers,
 *   so the accessible name is the visible label (SC 2.5.3).
 * - BUSY locks both providers and says so politely; an error sits in the same slot as an alert.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dimmedOpacity } from '@commise/ui/scale';
import { systemScheme } from '@commise/ui/testing/system-color-scheme';

import { SocialSignInButtons } from '../../src/components/auth/SocialSignInButtons.js';
import { mobileMessages } from '../../src/i18n/messages.js';

const { auth } = mobileMessages.en;

// A value no literal in the Google button could match: its dimmed opacity must be READ from the design system.
vi.mock('@commise/ui/scale', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/ui/scale')>()),
    dimmedOpacity: 0.25,
}));

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

const APPLE = 'Continue with Apple';

function renderButtons(overrides: Partial<Parameters<typeof SocialSignInButtons>[0]> = {}) {
    const onPress = vi.fn();
    render(
        <SocialSignInButtons
            providers={['apple', 'google']}
            busyProvider={null}
            error={null}
            locked={false}
            onPress={onPress}
            {...overrides}
        />,
    );

    return onPress;
}

describe('SocialSignInButtons', () => {
    it('draws Apple, then Google, then the "or" divider', () => {
        renderButtons();

        const apple = screen.getByRole('button', { name: APPLE });
        const google = screen.getByRole('button', { name: auth.continueWithGoogle });
        const divider = screen.getByText(auth.orDivider);

        expect(apple.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(google.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('draws Google alone (Android)', () => {
        renderButtons({ providers: ['google'] });

        expect(screen.getByRole('button', { name: auth.continueWithGoogle })).toBeTruthy();
        expect(screen.queryByRole('button', { name: APPLE })).toBeNull();
    });

    it('⛔ draws NOTHING — no group and no divider — when the build offers no provider (prod Android)', () => {
        const { container } = render(
            <SocialSignInButtons providers={[]} busyProvider={null} error={null} locked={false} onPress={vi.fn()} />,
        );

        expect(container.textContent).toBe('');
        expect(screen.queryByText(auth.orDivider)).toBeNull();
    });

    it('presses the provider it names', () => {
        const onPress = renderButtons();

        fireEvent.click(screen.getByRole('button', { name: APPLE }));
        fireEvent.click(screen.getByRole('button', { name: auth.continueWithGoogle }));

        expect(onPress.mock.calls).toEqual([['apple'], ['google']]);
    });

    it('uses the system Apple button: CONTINUE, as a 52 pt capsule (cornerRadius 26)', () => {
        renderButtons();

        expect(screen.getByRole('button', { name: APPLE }).getAttribute('data-corner-radius')).toBe('26');
    });

    it.each([
        ['light', 'WHITE_OUTLINE'],
        ['dark', 'WHITE'],
    ] as const)('styles the Apple button %s → %s, so it never outweighs the white Google button', (scheme, style) => {
        systemScheme.current = scheme;
        renderButtons();

        expect(screen.getByRole('button', { name: APPLE }).getAttribute('data-button-style')).toBe(style);
    });

    it('keeps Google’s four-colour G, hidden from screen readers', () => {
        renderButtons({ providers: ['google'] });

        const mark = screen.getByRole('button', { name: auth.continueWithGoogle }).querySelector('svg');
        const fills = [...(mark?.querySelectorAll('path') ?? [])].map((path) => path.getAttribute('fill'));

        expect(mark?.getAttribute('aria-hidden')).toBe('true');
        expect(new Set(fills)).toEqual(new Set(['#EA4335', '#4285F4', '#FBBC05', '#34A853']));
    });

    it('while a provider is busy: locks BOTH providers and says “Signing you in…” politely', () => {
        const onPress = renderButtons({ busyProvider: 'google', locked: true });

        const status = screen.getByText(auth.socialBusy);
        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(screen.getByRole('button', { name: auth.continueWithGoogle }).getAttribute('aria-disabled')).toBe(
            'true',
        );
        expect(screen.getByRole('button', { name: APPLE }).getAttribute('data-pointer-events')).toBe('none');

        fireEvent.click(screen.getByRole('button', { name: APPLE }));
        fireEvent.click(screen.getByRole('button', { name: auth.continueWithGoogle }));
        expect(onPress).not.toHaveBeenCalled();
    });

    it('⛔ dims a locked Google button to the design system’s own dimmed opacity, not a number of its own', () => {
        renderButtons({ locked: true });

        const google = screen.getByRole('button', { name: auth.continueWithGoogle });

        expect(dimmedOpacity).toBe(0.25);
        expect(getComputedStyle(google).opacity).toBe('0.25');
    });

    it('⛔ dims a locked Apple button to the same design-system opacity, not a number of its own', () => {
        renderButtons({ locked: true });

        const apple = screen.getByRole('button', { name: APPLE });

        expect(getComputedStyle(apple).opacity).toBe(String(dimmedOpacity));
    });

    it('locks both providers while the EMAIL form is busy too, without claiming a provider is signing in', () => {
        const onPress = renderButtons({ locked: true });

        fireEvent.click(screen.getByRole('button', { name: APPLE }));
        expect(onPress).not.toHaveBeenCalled();
        expect(screen.queryByText(auth.socialBusy)).toBeNull();
    });

    it('shows a provider failure as an alert in the same slot', () => {
        renderButtons({ error: auth.googleUnavailable });

        expect(screen.getByRole('alert').textContent).toBe(auth.googleUnavailable);
    });
});
