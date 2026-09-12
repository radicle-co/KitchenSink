import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PressScale } from '../PressScale.js';

/**
 * PressScale (web) — the presentational press-feedback wrapper. jsdom does not evaluate `:active` or the
 * reduced-motion media query, so — as with the Button variant tests — we assert the utility CONTRACT: the
 * wrapper renders its child and carries the design-system press-scale utility, gated behind `motion-safe:`
 * so reduce-motion users get no press motion at all.
 */
describe('PressScale (web)', () => {
    it('renders its child (the interactive element it wraps)', () => {
        render(
            <PressScale>
                <button type="button">Wrapped action</button>
            </PressScale>,
        );

        expect(screen.getByRole('button', { name: 'Wrapped action' })).toBeTruthy();
    });

    it("applies a pressed-scale transform via the wrapped child's :active state", () => {
        const { container } = render(
            <PressScale>
                <button type="button">Wrapped action</button>
            </PressScale>,
        );

        const wrapper = container.querySelector('span');
        expect(wrapper).not.toBeNull();
        // The ancestor span scales when its child button is :active — the design-system press scale.
        expect(wrapper?.className).toContain('active:scale-[0.98]');
        expect(wrapper?.className).toContain('transition-transform');
    });

    it('suppresses the press motion under reduce-motion (motion-safe gate, not an override)', () => {
        const { container } = render(
            <PressScale>
                <button type="button">Wrapped action</button>
            </PressScale>,
        );

        const tokens = (container.querySelector('span')?.className ?? '').split(' ');
        // The scale + transition apply ONLY when motion is safe, so `prefers-reduced-motion: reduce`
        // yields no press motion. Guard against a regression to an ungated scale.
        expect(tokens).toContain('motion-safe:transition-transform');
        expect(tokens.filter((token) => token.endsWith('scale-[0.98]'))).toEqual([
            'motion-safe:not-has-aria-disabled:active:scale-[0.98]',
        ]);
    });

    /**
     * A natively `disabled` child never matches `:active`, but a busy or refused child is `aria-disabled` and
     * still does — so without this gate a press the child refuses would still shrink it, reading as accepted.
     */
    it('does not scale while its child is aria-disabled (a refused press is not feedback)', () => {
        const { container } = render(
            <PressScale>
                <button type="button" aria-disabled="true">
                    Busy action
                </button>
            </PressScale>,
        );

        const tokens = (container.querySelector('span')?.className ?? '').split(' ');
        expect(tokens).toContain('motion-safe:not-has-aria-disabled:active:scale-[0.98]');
        expect(tokens).not.toContain('motion-safe:active:scale-[0.98]');
    });
});

/**
 * `width` (R9, `docs/design/rowEditorOpenDecisions.md`). PressScale also wraps cards and the FAB, so `auto` is pinned
 * byte for byte; `fill` must make the wrapper a block-level box that stretches, or a `w-full`
 * child resolves against a span that has shrunk to it.
 */
describe('PressScale (web) — width', () => {
    const AUTO_WRAPPER =
        'inline-flex motion-safe:transition-transform motion-safe:duration-100 motion-safe:not-has-aria-disabled:active:scale-[0.98]';

    it('keeps the inline-flex wrapper, byte for byte, when no width is given', () => {
        const { container } = render(
            <PressScale>
                <button type="button">Wrapped action</button>
            </PressScale>,
        );

        expect(container.querySelector('span')?.className).toBe(AUTO_WRAPPER);
    });

    it('renders the same wrapper for an explicit auto as for no width', () => {
        const { container } = render(
            <PressScale width="auto">
                <button type="button">Wrapped action</button>
            </PressScale>,
        );

        expect(container.querySelector('span')?.className).toBe(AUTO_WRAPPER);
    });

    it('makes the wrapper a stretching block-level flex box under fill, and keeps the press motion', () => {
        const { container } = render(
            <PressScale width="fill">
                <button type="button">Wrapped action</button>
            </PressScale>,
        );

        const tokens = (container.querySelector('span')?.className ?? '').split(/\s+/u);
        expect(tokens).toEqual(
            expect.arrayContaining(['flex', 'self-stretch', 'motion-safe:not-has-aria-disabled:active:scale-[0.98]']),
        );
        expect(tokens).not.toContain('inline-flex');
    });
});
