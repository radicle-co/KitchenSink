/**
 * The native Data sources error state (design §S16): Try again, which retries the read. The failure's words are the
 * screen's always-mounted live region (`DataSourcesScreen.native.test.tsx`), because a region that mounts with its
 * text is not reliably spoken on Android (`docs/design/readSurfacesEvaluation.md` D3).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { DataSourcesLoadError } from '../DataSourcesLoadError.native.js';

afterEach(cleanup);

describe('DataSourcesLoadError (native)', () => {
    it('holds Try again and no alert of its own: the screen’s region says the failure', () => {
        render(<DataSourcesLoadError onRetry={vi.fn()} retrying={false} />);

        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('retries the read when Try again is pressed', async () => {
        const onRetry = vi.fn();
        render(<DataSourcesLoadError onRetry={onRetry} retrying={false} />);

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    // The pressed control stays, busy: a disabled `Pressable` keeps the reading cursor on device (Button's contract).
    it('keeps Try again in place while the retry runs: busy, and pressing it again does nothing', async () => {
        const onRetry = vi.fn();
        render(<DataSourcesLoadError onRetry={onRetry} retrying />);

        const tryAgain = screen.getByRole('button', { name: 'Try again' });

        expect(tryAgain.getAttribute('aria-busy')).toBe('true');
        fireEvent.click(tryAgain);
        expect(onRetry).not.toHaveBeenCalled();
    });
});
