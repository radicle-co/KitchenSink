/**
 * @module components/auth/WelcomeContent — the branded auth-entry / welcome hero (U8, web).
 *
 * The signed-out landing (`/welcome`) the mockup defines: a beach-glow gradient hero with the Playfair
 * wordmark, tagline, three brand feature pills, a gradient "Get started" CTA into sign-up, and a "Sign in"
 * link for returning users. Presentational + server-renderable (pure `props → JSX`): it owns no state and
 * takes its copy + destination hrefs as props, so the route composes it with the resolved dictionary and
 * the basePath-aware auth URLs.
 *
 * The brand treatment is threaded from the design system, not re-invented: the hero background is the
 * shared {@link GradientSurface} (`hero` = beach-glow), the CTA carries the SAME `from-seafoam to-ocean-dark`
 * gradient utility the design-system `Button` primary uses (round-2 R7 — one gradient, not a parallel one),
 * and the tactile press-scale is the shared {@link PressScale} primitive (motion-safe).
 */
import { GradientSurface } from '@commise/ui/surface';
import { PressScale } from '@commise/ui/press-scale';
import Link from 'next/link';
import type { Route } from 'next';
import type { FC } from 'react';

import type { WebMessages } from '@/i18n/messages';

/** The localized copy the welcome hero renders. */
type WelcomeMessages = WebMessages['welcome'];

interface WelcomeContentProps {
    /** Resolved localized welcome copy. */
    readonly messages: WelcomeMessages;
    /** Destination of the primary "Get started" CTA (basePath-aware sign-up URL). */
    readonly signUpHref: Route;
    /** Destination of the "Sign in" link (basePath-aware sign-in URL). */
    readonly signInHref: Route;
}

/** One brand feature pill. `tone` picks the mockup's per-pill surface. */
const FeaturePill: FC<{ readonly tone: string; readonly children: string }> = ({ tone, children }) => (
    <li className={`inline-flex items-center justify-center rounded-full px-3 py-1 text-body-sm font-semibold ${tone}`}>
        {children}
    </li>
);

/** The branded welcome / auth-entry hero. */
export const WelcomeContent: FC<WelcomeContentProps> = ({ messages, signUpHref, signInHref }) => (
    <GradientSurface
        gradient="hero"
        accessibilityLabel={messages.regionLabel}
        className="relative flex min-h-screen flex-col items-center justify-between overflow-hidden p-8"
    >
        {/* Decorative brand-tint wash over the beach-glow base (mockup). */}
        <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-seafoam/20 via-sky/20 to-coral/20 opacity-30"
        />

        <div className="z-10 flex w-full max-w-md flex-1 flex-col items-center justify-center">
            {/* The logo mark — the design-system gradient badge (decorative; the wordmark names the brand). */}
            <span
                aria-hidden
                className="mb-8 flex size-16 items-center justify-center rounded-[var(--radius-lg)] bg-gradient-to-br from-seafoam to-ocean-dark font-display text-4xl font-bold text-white shadow-lg"
            >
                C
            </span>
            <h1 className="mb-4 text-center font-display text-display-xl font-bold text-charcoal">{messages.title}</h1>
            <p className="mb-12 text-center text-body-lg text-slate">{messages.tagline}</p>
            <ul className="flex flex-wrap justify-center gap-3" role="list">
                <FeaturePill tone="bg-seafoam text-white">{messages.features.saveRecipes}</FeaturePill>
                <FeaturePill tone="bg-coral text-white">{messages.features.planMeals}</FeaturePill>
                <FeaturePill tone="bg-sky text-charcoal">{messages.features.shopSmarter}</FeaturePill>
            </ul>
        </div>

        <div className="z-10 flex w-full max-w-md flex-col items-center gap-4">
            <PressScale>
                <Link
                    href={signUpHref}
                    className="flex w-full items-center justify-center rounded-full bg-gradient-to-br from-seafoam to-ocean-dark px-8 py-4 text-body-lg font-semibold text-white shadow-md transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam-light"
                >
                    {messages.getStarted}
                </Link>
            </PressScale>
            <Link
                href={signInHref}
                className="w-full text-center text-body-sm font-medium text-slate transition-colors hover:text-charcoal"
            >
                {messages.signIn}
            </Link>
        </div>
    </GradientSurface>
);
