/**
 * Native component tests for the discovery LOAD ERROR body (react-native-web under jsdom). Mirrors
 * `RecipeDiscoveryLoadError.test.tsx`; moved from the retired `RecipeDiscoveryList.native.test.tsx` ("error state").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDiscoveryLoadError } from '../RecipeDiscoveryLoadError.native.js';

afterEach(cleanup);

describe('RecipeDiscoveryLoadError (native)', () => {
    it('shows an alert with a retry action that reports upward', () => {
        const onRetry = vi.fn();
        render(<RecipeDiscoveryLoadError onRetry={onRetry} />);

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load recipes.');
        // Spoken assertively through `LiveRegion`: `accessibilityRole="alert"` alone is silent on iOS (SC 4.1.3).
        expect(screen.getByText('We couldn’t load recipes.').getAttribute('aria-live')).toBe('assertive');

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('clears the 44pt touch floor on the retry action', () => {
        render(<RecipeDiscoveryLoadError onRetry={() => undefined} />);

        // Every other control on the surface carries `minHeight: 44`; the retry was once a bare `Pressable` around a
        // `Text` — a ~20pt target.
        const retry = screen.getByRole('button', { name: 'Try again' });
        const surface = [retry, ...Array.from(retry.querySelectorAll<HTMLElement>('*'))].find(
            (node) => window.getComputedStyle(node).minHeight === '44px',
        );

        expect(surface, 'the retry action does not reach a 44pt target').toBeDefined();
    });
});
