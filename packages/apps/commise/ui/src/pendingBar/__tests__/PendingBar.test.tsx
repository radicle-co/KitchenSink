import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PENDING_BAR_DELAY_MS } from '../pendingDelay.js';
import { PendingBar } from '../PendingBar.js';

/**
 * PendingBar (web) — the still teal bar that says results on screen are being replaced. jsdom evaluates neither
 * keyframes nor layout, so the assertions are on the CONTRACT the stylesheet acts on: the reveal utility, the delay
 * that reaches CSS, the absolute placement that takes no layout space, and the bar's absence from the accessibility
 * tree. That the utility compiles to a real 0→1 opacity reveal is asserted against the app's real stylesheet in
 * `@commise/web`'s `tailwindTheme.integration.test.ts`.
 */
afterEach(cleanup);

/** The bar element, or `null` when nothing is rendered. */
const bar = (container: HTMLElement): HTMLElement | null => container.firstElementChild as HTMLElement | null;

describe('PendingBar (web)', () => {
    it('renders nothing while nothing is pending', () => {
        const { container } = render(<PendingBar pending={false} />);

        expect(bar(container)).toBeNull();
    });

    it('reveals the bar only after the shared delay, through CSS — never on the first frame', () => {
        const { container } = render(<PendingBar pending />);

        expect(bar(container)?.className).toContain('animate-pending-bar-reveal');
        // Not behind `motion-safe:` — the reveal is a DELAY, not motion, so reduce-motion viewers get it too.
        expect(bar(container)?.className).not.toContain('motion-safe:');
        expect(bar(container)?.style.animationDelay).toBe(`${PENDING_BAR_DELAY_MS}ms`);
    });

    it('waits 500ms — a response inside a second needs no indicator', () => {
        expect(PENDING_BAR_DELAY_MS).toBe(500);
    });

    it('is a still, 4px seafoam bar that takes no layout space', () => {
        const { container } = render(<PendingBar pending />);
        const className = bar(container)?.className ?? '';

        expect(className).toContain('absolute');
        expect(className).toContain('inset-x-0');
        expect(className).toContain('h-1');
        expect(className).toContain('rounded-full');
        // `seafoam`, not `seafoam-light`: the bar is a graphic that owes 3:1 (SC 1.4.11), and the light tint fails.
        expect(className).toMatch(/\bbg-seafoam\b(?!-)/);
        // Still, not moving: a moving bar beside usable results is not covered by SC 2.2.2's loading exemption.
        expect(className).not.toMatch(/animate-(pulse|spin|ping|bounce)/);
    });

    it('is hidden from assistive tech — the results region carries the busy state', () => {
        const { container } = render(<PendingBar pending />);

        expect(bar(container)?.getAttribute('aria-hidden')).toBe('true');
    });
});
