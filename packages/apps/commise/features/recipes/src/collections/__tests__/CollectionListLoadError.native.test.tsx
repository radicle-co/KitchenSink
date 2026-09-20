/**
 * Native component tests for `CollectionListLoadError` — the list's error-boundary fallback. Moved from the retired
 * `CollectionList.native.test.tsx` ("error state").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { CollectionListLoadError } from '../CollectionListLoadError.native.js';

afterEach(cleanup);

describe('CollectionListLoadError (native)', () => {
    it('shows an alert with a retry action that reports upward', () => {
        const onRetry = vi.fn();
        render(<CollectionListLoadError onRetry={onRetry} />);

        expect(screen.getByRole('alert')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
