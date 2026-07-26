/**
 * Component test for the branded welcome / auth-entry hero (U8, web). Proves the hero renders the brand
 * region, wordmark, tagline, and the three feature pills; that the gradient "Get started" CTA is a link
 * into sign-up; and that the "Sign in" link targets sign-in — all from localized props (no hard-coded copy).
 */
import { render, screen } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import { WelcomeContent } from '../WelcomeContent';

const messages = {
    regionLabel: 'Welcome to Commise',
    logoAlt: 'Commise',
    title: 'Commise',
    tagline: 'Cook with confidence. Plan with ease.',
    features: { saveRecipes: 'Save recipes', planMeals: 'Plan meals', shopSmarter: 'Shop smarter' },
    getStarted: 'Get started',
    signIn: 'Already have an account? Sign in',
} as const;

function renderWelcome() {
    return render(
        // Cast to the typed-routes `Route` as the real page does — a bare string literal is not assignable
        // to Next's `Route` under `typedRoutes` unless the route manifest has been regenerated.
        <WelcomeContent messages={messages} signUpHref={'/en/sign-up' as Route} signInHref={'/en/sign-in' as Route} />,
    );
}

describe('WelcomeContent (web)', () => {
    it('renders the branded hero region', () => {
        renderWelcome();

        expect(screen.getByRole('group', { name: 'Welcome to Commise' })).toBeInTheDocument();
    });

    it('renders the wordmark and tagline', () => {
        renderWelcome();

        expect(screen.getByRole('heading', { name: 'Commise' })).toBeInTheDocument();
        expect(screen.getByText('Cook with confidence. Plan with ease.')).toBeInTheDocument();
    });

    it('renders the three brand feature pills', () => {
        renderWelcome();

        for (const label of ['Save recipes', 'Plan meals', 'Shop smarter']) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
    });

    it('makes "Get started" the primary CTA linking into sign-up', () => {
        renderWelcome();
        const cta = screen.getByRole('link', { name: 'Get started' });

        expect(cta).toHaveAttribute('href', '/en/sign-up');
    });

    it('offers a "Sign in" link into sign-in for returning users', () => {
        renderWelcome();
        const signIn = screen.getByRole('link', { name: 'Already have an account? Sign in' });

        expect(signIn).toHaveAttribute('href', '/en/sign-in');
    });
});
