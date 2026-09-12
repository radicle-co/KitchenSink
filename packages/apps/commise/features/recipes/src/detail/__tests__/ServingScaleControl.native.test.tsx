/**
 * Native component tests for the serving-count control (react-native-web under jsdom).
 *
 * Mirrors the web leaf state for state — own count, above, below, both ends of the range, and an
 * over-cap recipe — so the two platforms cannot drift on which yields a cook can reach.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_SCALED_SERVINGS, MIN_SCALED_SERVINGS } from '@kitchensink/recipe-core/scaling';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ServingScaleControl } from '../ServingScaleControl.native.js';

afterEach(cleanup);

describe('ServingScaleControl (native)', () => {
    it('shows the serving count it was given', () => {
        render(<ServingScaleControl servings={6} baseServings={4} onServingsChange={vi.fn()} />);

        expect(screen.getByText('6')).toBeTruthy();
    });

    it('adds one serving when the increase control is pressed', async () => {
        const onServingsChange = vi.fn();
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={onServingsChange} />);

        await userEvent.click(screen.getByRole('button', { name: 'More servings' }));

        expect(onServingsChange).toHaveBeenCalledWith(5);
    });

    it('removes one serving when the decrease control is pressed', async () => {
        const onServingsChange = vi.fn();
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={onServingsChange} />);

        await userEvent.click(screen.getByRole('button', { name: 'Fewer servings' }));

        expect(onServingsChange).toHaveBeenCalledWith(3);
    });

    it('does not step below the minimum', () => {
        render(<ServingScaleControl servings={MIN_SCALED_SERVINGS} baseServings={4} onServingsChange={vi.fn()} />);

        // Disabled, not merely a no-op handler: a control that looks pressable and does nothing is worse
        // than one that reads as unavailable. `aria-disabled` is what react-native-web projects into the DOM
        // and what assistive tech announces; it is also why `userEvent` refuses to click it at all.
        expect(screen.getByRole('button', { name: 'Fewer servings' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'More servings' }).getAttribute('aria-disabled')).not.toBe('true');
    });

    it('does not step above the maximum', () => {
        render(<ServingScaleControl servings={MAX_SCALED_SERVINGS} baseServings={4} onServingsChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'More servings' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Fewer servings' }).getAttribute('aria-disabled')).not.toBe('true');
    });

    it('lets a recipe authored beyond the display cap scale down from its own yield', async () => {
        const onServingsChange = vi.fn();
        const huge = MAX_SCALED_SERVINGS + 150;
        render(<ServingScaleControl servings={huge} baseServings={huge} onServingsChange={onServingsChange} />);

        await userEvent.click(screen.getByRole('button', { name: 'Fewer servings' }));

        expect(onServingsChange).toHaveBeenCalledWith(huge - 1);
    });

    it('clears the 44pt touch floor on every control', () => {
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={vi.fn()} />);

        for (const name of ['Fewer servings', 'More servings']) {
            const style = getComputedStyle(screen.getByRole('button', { name }));

            expect(Number.parseFloat(style.minWidth)).toBeGreaterThanOrEqual(44);
            expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(44);
        }
    });
});
