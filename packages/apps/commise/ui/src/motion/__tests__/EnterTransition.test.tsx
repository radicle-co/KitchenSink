import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { EnterTransition, enterTransitionClassName } from '../EnterTransition.js';

/**
 * EnterTransition (web) — the presentational enter wrapper. jsdom does not evaluate keyframes or the
 * reduced-motion media query, so — as with `PressScale` — we assert the utility CONTRACT: the gesture is
 * emitted only behind `motion-safe:`, the children are rendered unconditionally (never hidden behind JS),
 * and the stagger reaches CSS as an animation delay.
 */
describe('EnterTransition (web)', () => {
    it('renders its children', () => {
        render(
            <EnterTransition>
                <p>Trending now</p>
            </EnterTransition>,
        );

        expect(screen.getByText('Trending now')).toBeTruthy();
    });

    it('applies the section-enter animation utility', () => {
        const { container } = render(
            <EnterTransition>
                <p>Trending now</p>
            </EnterTransition>,
        );

        expect(container.firstElementChild?.className).toContain('animate-section-enter');
    });

    it('suppresses the enter motion under reduce-motion (motion-safe gate, not an override)', () => {
        const { container } = render(
            <EnterTransition>
                <p>Trending now</p>
            </EnterTransition>,
        );

        const className = container.firstElementChild?.className ?? '';
        expect(className).toContain('motion-safe:animate-section-enter');
        // Guard against a regression to an UNGATED `animate-section-enter`, which would animate (and
        // therefore start from a hidden state) for a reduce-motion viewer.
        expect(className).not.toMatch(/(?<!safe:)\banimate-section-enter/);
    });

    it('never hides its content behind JavaScript (no mount-gated visibility class)', () => {
        const { container } = render(
            <EnterTransition>
                <p>Trending now</p>
            </EnterTransition>,
        );

        // The from-state lives in the CSS keyframe, which runs without hydration. A `opacity-0`/`hidden`
        // utility on the wrapper would mean a no-JS (or pre-hydration) viewer sees nothing.
        const className = container.firstElementChild?.className ?? '';
        expect(className).not.toMatch(/\bopacity-0\b/);
        expect(className).not.toMatch(/\bhidden\b/);
        expect(className).not.toMatch(/\binvisible\b/);
    });

    it('exposes the stagger as a CSS animation delay, and sets none when there is no delay', () => {
        const { container: delayed } = render(
            <EnterTransition delayMs={120}>
                <p>New this week</p>
            </EnterTransition>,
        );
        expect((delayed.firstElementChild as HTMLElement).style.animationDelay).toBe('120ms');

        const { container: immediate } = render(
            <EnterTransition>
                <p>Trending now</p>
            </EnterTransition>,
        );
        expect((immediate.firstElementChild as HTMLElement).style.animationDelay).toBe('');
    });

    it('merges caller utilities alongside the enter utility', () => {
        const { container } = render(
            <EnterTransition className="flex flex-col gap-4">
                <p>Trending now</p>
            </EnterTransition>,
        );

        const className = container.firstElementChild?.className ?? '';
        expect(className).toContain(enterTransitionClassName);
        expect(className).toContain('flex flex-col gap-4');
    });
});
