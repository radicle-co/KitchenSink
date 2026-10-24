// @vitest-environment jsdom
/**
 * Component tests for the web serving-count control — the configurable yield the recipe scales to.
 *
 * REWRITTEN for F8 (`evaluateFinal.md`): the control is the design system's `Stepper` (`[−] value [+]`, the value in
 * Inter tabular digits, `buildSpec.md` §1.11), not a hand-built twin with a Playfair number field. The Stepper has no
 * typed field, so the two typed-count tests are deleted: stepping is the spec's only input, and the range clamp they
 * guarded now lives in `servingsRange` + `stepFrom`, which the step tests below still exercise at both ends.
 *
 * Every state: at the recipe's own count, above it, below it, at both ends of the range (where the
 * corresponding control must be unavailable rather than silently no-op), and a recipe authored with more
 * servings than the display cap.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_SCALED_SERVINGS, MIN_SCALED_SERVINGS } from '@kitchensink/recipe-core/scaling';

import { ServingScaleControl } from '../ServingScaleControl.js';

afterEach(cleanup);

/** What the control's polite live region says now (the Stepper's `LiveRegion` may hold more than one node). */
const spoken = (): string =>
    screen
        .getAllByRole('status')
        .map((node) => node.textContent)
        .join('');

describe('ServingScaleControl (web)', () => {
    it('shows the serving count it was given', () => {
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={vi.fn()} />);

        expect(within(screen.getByRole('group', { name: 'Servings' })).getByText('4')).toBeTruthy();
    });

    // F8: Playfair never sets a number (`buildSpec.md` §1.5); the count is Inter `figure` with tabular digits.
    it('sets the count in tabular digits, never the display face', () => {
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={vi.fn()} />);

        const count = within(screen.getByRole('group', { name: 'Servings' })).getByText('4');

        expect(count.className).toContain('tabular-nums');
        expect(count.className).not.toContain('font-display');
    });

    it('adds one serving when the increase control is used', async () => {
        const onServingsChange = vi.fn();
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={onServingsChange} />);

        await userEvent.click(screen.getByRole('button', { name: 'More servings' }));

        expect(onServingsChange).toHaveBeenCalledWith(5);
    });

    it('removes one serving when the decrease control is used', async () => {
        const onServingsChange = vi.fn();
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={onServingsChange} />);

        await userEvent.click(screen.getByRole('button', { name: 'Fewer servings' }));

        expect(onServingsChange).toHaveBeenCalledWith(3);
    });

    /**
     * REWRITTEN from native `disabled` (staff-ux-engineer ruling): pressing a step button TO the limit makes the
     * button just pressed unavailable, and native `disabled` would drop the keyboard user's focus to <body> (WCAG
     * 2.2 SC 2.4.3). The component cannot tell "at the limit on load" from "just pressed to it", so both ends are
     * `aria-disabled` with the press refused — asserted on the callback, not the attribute alone.
     */
    it('makes the decrease control unavailable at the minimum — focusable, and refusing the press', async () => {
        const onServingsChange = vi.fn();
        render(
            <ServingScaleControl servings={MIN_SCALED_SERVINGS} baseServings={4} onServingsChange={onServingsChange} />,
        );

        const fewer = screen.getByRole('button', { name: 'Fewer servings' });
        expect(fewer).toHaveProperty('disabled', false);
        expect(fewer.getAttribute('aria-disabled')).toBe('true');
        expect(fewer.hasAttribute('aria-busy')).toBe(false);
        expect(screen.getByRole('button', { name: 'More servings' }).hasAttribute('aria-disabled')).toBe(false);

        await userEvent.click(fewer);
        expect(onServingsChange).not.toHaveBeenCalled();
    });

    it('makes the increase control unavailable at the maximum — focusable, and refusing the press', async () => {
        const onServingsChange = vi.fn();
        render(
            <ServingScaleControl servings={MAX_SCALED_SERVINGS} baseServings={4} onServingsChange={onServingsChange} />,
        );

        const more = screen.getByRole('button', { name: 'More servings' });
        expect(more).toHaveProperty('disabled', false);
        expect(more.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Fewer servings' }).hasAttribute('aria-disabled')).toBe(false);

        await userEvent.click(more);
        expect(onServingsChange).not.toHaveBeenCalled();
    });

    it('lets a recipe authored beyond the display cap sit at — and return to — its own yield', async () => {
        const onServingsChange = vi.fn();
        const huge = MAX_SCALED_SERVINGS + 150;
        render(<ServingScaleControl servings={huge} baseServings={huge} onServingsChange={onServingsChange} />);

        // At its own (over-cap) yield the increase control is the one that must be unavailable…
        expect(screen.getByRole('button', { name: 'More servings' }).getAttribute('aria-disabled')).toBe('true');
        // …and scaling DOWN must still work, or the cook could never get back up to the recipe's own yield.
        await userEvent.click(screen.getByRole('button', { name: 'Fewer servings' }));
        expect(onServingsChange).toHaveBeenCalledWith(huge - 1);
    });

    /**
     * ⛔ Pressing + or − changes a number nobody is focused on, so a screen reader says nothing (staff-ux-engineer).
     * An always-mounted status region speaks the count — EMPTY until the cook first steps or commits an edit, so
     * opening a recipe is not read out as "4 servings" — and names the limit at the ends.
     */
    it('⛔ is silent on open, then announces the count after a step', async () => {
        const { rerender } = render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={vi.fn()} />);
        expect(spoken()).toBe('');

        await userEvent.click(screen.getByRole('button', { name: 'More servings' }));
        rerender(<ServingScaleControl servings={5} baseServings={4} onServingsChange={vi.fn()} />);

        expect(spoken()).toBe('5 servings');
    });

    it('names the limit when a step reaches the end of the range', async () => {
        const { rerender } = render(
            <ServingScaleControl servings={MAX_SCALED_SERVINGS - 1} baseServings={4} onServingsChange={vi.fn()} />,
        );

        await userEvent.click(screen.getByRole('button', { name: 'More servings' }));
        rerender(<ServingScaleControl servings={MAX_SCALED_SERVINGS} baseServings={4} onServingsChange={vi.fn()} />);

        expect(spoken()).toBe(`${MAX_SCALED_SERVINGS} servings, maximum`);
    });

    it('says nothing for a refused press at the limit', async () => {
        render(<ServingScaleControl servings={MAX_SCALED_SERVINGS} baseServings={4} onServingsChange={vi.fn()} />);

        await userEvent.click(screen.getByRole('button', { name: 'More servings' }));

        expect(spoken()).toBe('');
    });

    it('clears the 44px touch floor on every control', () => {
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={vi.fn()} />);

        for (const name of ['Fewer servings', 'More servings']) {
            expect(screen.getByRole('button', { name }).className.split(' ')).toContain('size-11');
        }
    });
});
