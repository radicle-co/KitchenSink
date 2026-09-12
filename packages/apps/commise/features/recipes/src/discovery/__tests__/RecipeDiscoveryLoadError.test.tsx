// @vitest-environment jsdom
/**
 * Component tests for the web discovery LOAD ERROR body — what the discovery suspense boundary renders when a search
 * failed with nothing loaded for it. Moved from the retired `RecipeDiscoveryList.test.tsx` ("error state", and the
 * retry's touch-floor and contrast cases).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { utilityContrast } from '@commise/test-utils';
import { semantic } from '@commise/ui';

import { RecipeDiscoveryLoadError } from '../RecipeDiscoveryLoadError.js';

afterEach(cleanup);

const noop = () => undefined;

describe('RecipeDiscoveryLoadError (web)', () => {
    it('shows an alert with a retry action that reports upward', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        render(<RecipeDiscoveryLoadError onRetry={onRetry} />);

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load recipes.');

        await user.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders the failure as a styled card surface, not bare unstyled text', () => {
        render(<RecipeDiscoveryLoadError onRetry={noop} />);

        const alert = screen.getByRole('alert');

        for (const surfaceClass of ['rounded-2xl', 'bg-card', 'shadow-sm']) {
            expect(alert.classList.contains(surfaceClass)).toBe(true);
        }
    });

    it('gives the retry real control styling and the 44px touch floor, reset for the mouse at md', () => {
        render(<RecipeDiscoveryLoadError onRetry={noop} />);

        const retry = screen.getByRole('button', { name: 'Try again' });
        expect(retry.classList.contains('rounded-full')).toBe(true);
        expect(retry.classList.contains('font-semibold')).toBe(true);
        expect(retry.className).toContain('min-h-11');
        expect(retry.className).toContain('md:min-h-0');
    });

    it('keeps the retry legible at rest and under its seafoam hover tint (SC 1.4.3)', () => {
        render(<RecipeDiscoveryLoadError onRetry={noop} />);

        const retry = screen.getByRole('button', { name: 'Try again' });
        expect(utilityContrast(retry.className, { surface: semantic.card }), 'at rest').toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(retry.className, { surface: semantic.card, variant: 'hover' }),
            'under hover:bg-seafoam/10',
        ).toBeGreaterThanOrEqual(4.5);
    });
});
