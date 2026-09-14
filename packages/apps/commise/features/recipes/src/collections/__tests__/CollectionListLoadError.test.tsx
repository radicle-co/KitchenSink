// @vitest-environment jsdom
/**
 * Component tests for the web `CollectionListLoadError` — what the collection list's error boundary renders when the
 * read failed with nothing loaded. Moved from the retired `CollectionList.test.tsx` ("error state"); its old "no rows
 * in the error state" case is now structural, because this fallback takes no collections at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CollectionListLoadError } from '../CollectionListLoadError.js';

afterEach(cleanup);

describe('CollectionListLoadError (web)', () => {
    it('shows an alert with a retry action that reports upward', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        render(<CollectionListLoadError onRetry={onRetry} />);

        expect(screen.getByRole('alert')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
