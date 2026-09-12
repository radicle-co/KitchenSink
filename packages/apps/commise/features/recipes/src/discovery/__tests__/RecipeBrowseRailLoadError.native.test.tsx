/**
 * Native component tests for the browse-rail LOAD ERROR body (react-native-web under jsdom). Mirrors
 * `RecipeBrowseRailLoadError.test.tsx`, including its NEW Try again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { computedContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeBrowseRailLoadError } from '../RecipeBrowseRailLoadError.native.js';

afterEach(cleanup);

describe('RecipeBrowseRailLoadError (native)', () => {
    it('says the rail could not load, and retries it from Try again', () => {
        const onRetry = vi.fn();
        render(<RecipeBrowseRailLoadError onRetry={onRetry} />);

        expect(screen.getByText('Couldn’t load this row.')).toBeTruthy();
        // Spoken assertively through `LiveRegion`: `accessibilityRole="alert"` alone is silent on iOS (SC 4.1.3).
        expect(screen.getByText('Couldn’t load this row.').getAttribute('aria-live')).toBe('assertive');
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('gives Try again the 44pt touch floor and a legible label on the screen background', () => {
        render(<RecipeBrowseRailLoadError onRetry={() => undefined} />);

        const retry = screen.getByRole('button', { name: 'Try again' });
        const surface = [retry, ...Array.from(retry.querySelectorAll<HTMLElement>('*'))].find(
            (node) => window.getComputedStyle(node).minHeight === '44px',
        );
        expect(surface, 'Try again does not reach a 44pt target').toBeDefined();
        expect(
            computedContrast(within(retry).getByText('Try again'), { surface: palette.sand }),
        ).toBeGreaterThanOrEqual(4.5);
    });
});
