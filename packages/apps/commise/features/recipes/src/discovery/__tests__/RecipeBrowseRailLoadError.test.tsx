// @vitest-environment jsdom
/**
 * Component tests for the web browse-rail LOAD ERROR body — what one rail's read boundary renders when that rail failed
 * with nothing loaded. Moved from the error case of `RecipeBrowseRails.test.tsx`'s "rail states".
 *
 * NEW: a Try again. The rail used to be a plain query whose failure healed on the next focus refetch; behind a read
 * boundary a failure stays until the boundary is reset, so without its own retry a failed rail would be a dead end
 * until the viewer left browse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { utilityContrast } from '@commise/test-utils';
import { semantic } from '@commise/ui';

import { RecipeBrowseRailLoadError } from '../RecipeBrowseRailLoadError.js';

afterEach(cleanup);

describe('RecipeBrowseRailLoadError (web)', () => {
    it('says the rail could not load, and retries it from Try again', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        render(<RecipeBrowseRailLoadError onRetry={onRetry} />);

        // An alert, so a retry that fails again is announced (SC 4.1.3).
        expect(screen.getByRole('alert').textContent).toContain('Couldn’t load this row.');
        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('gives Try again the 44px touch floor and legible text at rest and on hover', () => {
        render(<RecipeBrowseRailLoadError onRetry={() => undefined} />);

        const retry = screen.getByRole('button', { name: 'Try again' });
        expect(retry.className).toContain('min-h-11');
        expect(retry.className).toContain('md:min-h-0');
        expect(utilityContrast(retry.className, { surface: semantic.background })).toBeGreaterThanOrEqual(4.5);
        expect(
            utilityContrast(retry.className, { surface: semantic.background, variant: 'hover' }),
        ).toBeGreaterThanOrEqual(4.5);
    });
});
