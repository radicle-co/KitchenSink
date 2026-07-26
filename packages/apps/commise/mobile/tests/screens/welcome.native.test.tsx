/**
 * Component tests for the branded welcome / auth-entry screen (U8, mobile). Rendered via react-native-web
 * under jsdom (see `vitest.native.config.ts`, which stubs `expo-linear-gradient`/`expo-blur`). Proves the
 * hero renders the brand region, wordmark, tagline, and feature pills from `mobileMessages` (no hard-coded
 * English); that the gradient "Get started" DS Button routes into sign-up; and that "Sign in" routes into
 * sign-in. Real gradient rendering is emulator-only (Maestro).
 */
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { WelcomeScreen } from '../../src/screens/welcome.js';
import { mobileMessages } from '../../src/i18n/messages.js';
import { gradient, toNativeGradient } from '@commise/ui';

const { welcome } = mobileMessages.en;

// The real safe-area module does not parse under jsdom (see the login suite) — a passthrough sentinel.
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
    SafeAreaView: ({ children }: { readonly children?: unknown }) =>
        createElement('div', { 'aria-label': 'safe-area-root' }, children as never),
}));

afterEach(cleanup);

describe('WelcomeScreen (mobile)', () => {
    it('renders the branded hero: wordmark, tagline, and the three feature pills', () => {
        render(<WelcomeScreen onGetStarted={vi.fn()} onSignIn={vi.fn()} />);

        expect(screen.getByLabelText(welcome.regionLabel)).toBeTruthy();
        expect(screen.getByText(welcome.title)).toBeTruthy();
        expect(screen.getByText(welcome.tagline)).toBeTruthy();
        for (const label of [welcome.features.saveRecipes, welcome.features.planMeals, welcome.features.shopSmarter]) {
            expect(screen.getByText(label)).toBeTruthy();
        }
    });

    it('paints the "Get started" CTA with the brand gradient (converges with the web CTA)', () => {
        render(<WelcomeScreen onGetStarted={vi.fn()} onSignIn={vi.fn()} />);

        const cta = screen.getByRole('button', { name: welcome.getStarted });
        const surface = cta.querySelector('[data-commise-stub="linear-gradient"]');
        expect(surface).not.toBeNull();
        expect(surface?.getAttribute('data-colors')).toBe(toNativeGradient(gradient.brand).colors.join('|'));
    });

    it('routes "Get started" into sign-up', () => {
        const onGetStarted = vi.fn();
        render(<WelcomeScreen onGetStarted={onGetStarted} onSignIn={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: welcome.getStarted }));
        expect(onGetStarted).toHaveBeenCalledTimes(1);
    });

    it('routes "Sign in" into sign-in for returning users', () => {
        const onSignIn = vi.fn();
        render(<WelcomeScreen onGetStarted={vi.fn()} onSignIn={onSignIn} />);

        fireEvent.click(screen.getByRole('button', { name: welcome.signIn }));
        expect(onSignIn).toHaveBeenCalledTimes(1);
    });
});
