// @vitest-environment jsdom
/**
 * Component tests for the shared, PURE {@link RouteErrorState} (B18) — the localized fallback every web App
 * Router `error.tsx` boundary renders. Pure `props → JSX`: no reporting, no framework wiring, just the
 * localized copy + retry affordance. The reporting/orchestration side is covered by `RouteErrorBoundary.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@commise/test-utils';

import { RouteErrorState } from '../RouteErrorState';

afterEach(() => {
    cleanup();
});

describe('RouteErrorState', () => {
    it('renders an alert with localized copy and a retry affordance', () => {
        renderWithProviders(<RouteErrorState onRetry={vi.fn()} />);

        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('invokes onRetry when the retry action is activated', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        renderWithProviders(<RouteErrorState onRetry={onRetry} />);

        await user.click(screen.getByRole('button', { name: /try again/i }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
