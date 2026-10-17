/**
 * Component tests for the native `BoundaryErrorNotice` (react-native-web under jsdom): what a routed screen shows when it
 * crashed. `AppRoot.native.test.tsx` drives the whole boundary; this file pins the notice alone.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoundaryErrorNotice } from '../BoundaryErrorNotice.js';
import { boundaryMessages } from '../messages.js';

afterEach(cleanup);

describe('BoundaryErrorNotice (native)', () => {
    it('⛔ announces the shared title assertively and shows the app’s body', () => {
        render(<BoundaryErrorNotice body="We hit a snag loading this screen." onRetry={vi.fn()} />);

        expect(screen.getByText(boundaryMessages.en.errorTitle).closest('[aria-live="assertive"]')).not.toBeNull();
        expect(screen.getByText('We hit a snag loading this screen.')).toBeTruthy();
    });

    it('retries from the primary action', () => {
        const onRetry = vi.fn();
        render(<BoundaryErrorNotice body="Body." onRetry={onRetry} />);

        fireEvent.click(screen.getByRole('button', { name: boundaryMessages.en.retry }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('offers no way home when Home itself crashed (the app gives none)', () => {
        render(<BoundaryErrorNotice body="Body." onRetry={vi.fn()} />);

        expect(screen.queryByRole('button', { name: boundaryMessages.en.backToHome })).toBeNull();
    });

    it('goes home from the secondary action when the app gives a way home', () => {
        const onBackToHome = vi.fn();
        render(<BoundaryErrorNotice body="Body." onRetry={vi.fn()} onBackToHome={onBackToHome} />);

        fireEvent.click(screen.getByRole('button', { name: boundaryMessages.en.backToHome }));

        expect(onBackToHome).toHaveBeenCalledTimes(1);
    });
});
