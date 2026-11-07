/**
 * The Ingredients section's running total (web), failed state: the host's Try again is the design system's quiet Button
 * (`componentFixes.md` §1), described by the failure; with no `onRetry` there is no button at all.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectDesignSystemButton } from '../../__tests__/designSystemButton.js';
import { IngredientsNutritionTotal } from '../IngredientsNutritionTotal.js';

afterEach(cleanup);

const FAILED = 'We couldn’t work out the nutrition.';
const props = {
    view: { kind: 'failed' },
    loadingLabel: 'Loading',
    failedText: FAILED,
    retryLabel: 'Try again',
} as const;

describe('IngredientsNutritionTotal (web) — failed', () => {
    it('draws Try again as the quiet Button, described by the failure, and a press reads again', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();

        render(<IngredientsNutritionTotal {...props} onRetry={onRetry} />);
        const retry = screen.getByRole('button', { name: 'Try again' });

        expectDesignSystemButton(retry, 'quiet', 'refresh-cw');
        expect(document.getElementById(retry.getAttribute('aria-describedby') ?? '')?.textContent).toBe(FAILED);

        await user.click(retry);

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(retry.hasAttribute('disabled')).toBe(false);
        expect(document.activeElement).toBe(retry);
    });

    it('offers no Try again where the host does not', () => {
        render(<IngredientsNutritionTotal {...props} />);

        expect(screen.queryByRole('button')).toBeNull();
    });
});
