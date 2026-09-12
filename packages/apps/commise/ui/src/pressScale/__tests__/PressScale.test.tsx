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
