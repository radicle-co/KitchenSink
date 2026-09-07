// @vitest-environment jsdom
/**
 * Component tests for the web serving-count control — the configurable yield the recipe scales to.
 *
 * Every state: at the recipe's own count, above it, below it, at both ends of the range (where the
 * corresponding control must be unavailable rather than silently no-op), and a recipe authored with more
 * servings than the display cap.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_SCALED_SERVINGS, MIN_SCALED_SERVINGS } from '@kitchensink/recipe-core/scaling';
import { useState, type FC } from 'react';

import { ServingScaleControl } from '../ServingScaleControl.js';

afterEach(cleanup);

describe('ServingScaleControl (web)', () => {
    it('shows the serving count it was given', () => {
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={vi.fn()} />);

        expect(screen.getByLabelText('Servings')).toHaveProperty('value', '4');
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

    it('reports a typed serving count', async () => {
        // Driven through a real controlled owner, because a keystroke on a controlled input is only
        // meaningful if the value actually moves — asserting against a frozen `servings` prop would be
        // testing the harness, not the control.
        const reported: number[] = [];

        const Harness: FC = () => {
            const [servings, setServings] = useState(4);

            return (
                <ServingScaleControl
                    servings={servings}
                    baseServings={4}
                    onServingsChange={(next) => {
                        reported.push(next);
                        setServings(next);
                    }}
                />
            );
        };

        render(<Harness />);
        const input = screen.getByLabelText('Servings');
        await userEvent.clear(input);
        await userEvent.type(input, '8');

        expect(screen.getByLabelText('Servings')).toHaveProperty('value', '8');

        // Clearing the field is a real intermediate state (the parsed value is NaN). Every value that
        // leaves this control must still be a usable serving count, or NaN reaches the scaling arithmetic,
        // which throws on it.
        for (const value of reported) {
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(MIN_SCALED_SERVINGS);
            expect(value).toBeLessThanOrEqual(MAX_SCALED_SERVINGS);
        }
    });

    it('makes the decrease control unavailable at the minimum', () => {
        render(<ServingScaleControl servings={MIN_SCALED_SERVINGS} baseServings={4} onServingsChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Fewer servings' })).toHaveProperty('disabled', true);
        expect(screen.getByRole('button', { name: 'More servings' })).toHaveProperty('disabled', false);
    });

    it('makes the increase control unavailable at the maximum', () => {
        render(<ServingScaleControl servings={MAX_SCALED_SERVINGS} baseServings={4} onServingsChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'More servings' })).toHaveProperty('disabled', true);
        expect(screen.getByRole('button', { name: 'Fewer servings' })).toHaveProperty('disabled', false);
    });

    it('lets a recipe authored beyond the display cap sit at — and return to — its own yield', async () => {
        const onServingsChange = vi.fn();
        const huge = MAX_SCALED_SERVINGS + 150;
        render(<ServingScaleControl servings={huge} baseServings={huge} onServingsChange={onServingsChange} />);

        // At its own (over-cap) yield the increase control is the one that must be unavailable…
        expect(screen.getByRole('button', { name: 'More servings' })).toHaveProperty('disabled', true);
        // …and scaling DOWN must still work, or the cook could never get back up to the recipe's own yield.
        await userEvent.click(screen.getByRole('button', { name: 'Fewer servings' }));
        expect(onServingsChange).toHaveBeenCalledWith(huge - 1);
    });

    it('clears the 44px touch floor on every control', () => {
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={vi.fn()} />);

        for (const name of ['Fewer servings', 'More servings']) {
            expect(screen.getByRole('button', { name }).className).toContain('min-h-11');
        }
    });
});
