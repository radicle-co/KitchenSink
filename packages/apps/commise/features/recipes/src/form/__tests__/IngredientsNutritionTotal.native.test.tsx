/**
 * The Ingredients section's running total (native), failed state: the host's Try again is the design system's quiet
 * Button (`componentFixes.md` §1); with no `onRetry` there is no button at all.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectNativeDesignSystemButton } from '../../__tests__/nativeDesignSystemButton.js';
import { IngredientsNutritionTotal } from '../IngredientsNutritionTotal.native.js';
import { render } from '@commise/ui/testing/tamagui';

afterEach(cleanup);

const props = {
    view: { kind: 'failed' },
    loadingLabel: 'Loading',
    failedText: 'We couldn’t work out the nutrition.',
    retryLabel: 'Try again',
} as const;

describe('IngredientsNutritionTotal (native) — failed', () => {
    it('draws Try again as the quiet Button, and a press reads again', () => {
        const onRetry = vi.fn();

        render(<IngredientsNutritionTotal {...props} onRetry={onRetry} />);
        const retry = screen.getByRole('button', { name: 'Try again' });

        expectNativeDesignSystemButton(retry, 'quiet', 'refresh-cw');
        fireEvent.click(retry);

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(retry.getAttribute('aria-disabled')).not.toBe('true');
    });

    it('offers no Try again where the host does not', () => {
        render(<IngredientsNutritionTotal {...props} />);

        expect(screen.queryByRole('button')).toBeNull();
    });
});
