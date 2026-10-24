/**
 * Component tests for the web `BoundaryErrorNotice`: what every App Router `error.tsx` shows when a segment threw. The
 * app-specific body copy and the reporting stay with the app, so this file pins only the shared title, the actions and
 * their order.
 */
import { buttonSurfaceClass } from '@commise/ui/button';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoundaryErrorNotice } from '../BoundaryErrorNotice.js';
import { boundaryMessages } from '../messages.js';

afterEach(cleanup);

describe('BoundaryErrorNotice (web)', () => {
    it('renders an alert with the shared title, the app’s body and a retry', () => {
        render(<BoundaryErrorNotice body="We couldn’t load this page. Please try again." onRetry={vi.fn()} />);

        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByRole('heading', { name: boundaryMessages.en.errorTitle })).toBeTruthy();
        expect(screen.getByText('We couldn’t load this page. Please try again.')).toBeTruthy();
        expect(screen.getByRole('button', { name: boundaryMessages.en.retry })).toBeTruthy();
    });

    it('⛔ the retry is a design-system button, not an unstyled control', () => {
        render(<BoundaryErrorNotice body="Body." onRetry={vi.fn()} />);

        // The old web fallback drew a bare `<button>`; the design system’s surface is what makes it a control.
        expect(screen.getByRole('button', { name: boundaryMessages.en.retry }).className).toContain(
            buttonSurfaceClass('secondary'),
        );
    });

    it('invokes onRetry when the retry action is activated', () => {
        const onRetry = vi.fn();
        render(<BoundaryErrorNotice body="Body." onRetry={onRetry} />);

        fireEvent.click(screen.getByRole('button', { name: boundaryMessages.en.retry }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('offers no way home unless the app gives one', () => {
        render(<BoundaryErrorNotice body="Body." onRetry={vi.fn()} />);

        expect(screen.queryByRole('button', { name: boundaryMessages.en.backToHome })).toBeNull();
    });

    it('offers Back to Home when the app gives a way home', () => {
        const onBackToHome = vi.fn();
        render(<BoundaryErrorNotice body="Body." onRetry={vi.fn()} onBackToHome={onBackToHome} />);

        fireEvent.click(screen.getByRole('button', { name: boundaryMessages.en.backToHome }));

        expect(onBackToHome).toHaveBeenCalledTimes(1);
    });
});
