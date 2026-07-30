// @vitest-environment jsdom
/**
 * Component tests for the shared {@link RouteErrorBoundary} (B18/DA9) — the orchestration every web App
 * Router `error.tsx` boundary delegates to: reports the caught error through the SAME injected
 * `errorReporterToken` seam the Home-widget boundaries use (resolved from `homeContainer`, bound to Sentry in
 * production), then renders the pure `RouteErrorState` with `reset` wired as the retry affordance.
 *
 * `@sentry/nextjs` is mocked (never loaded for real) so importing `homeContainer` here doesn't require a
 * live Sentry client under test — mirrors `HomeWidgetSurface.test.tsx`'s mocking strategy for the same
 * container.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@commise/test-utils';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

const { RouteErrorBoundary } = await import('../RouteErrorBoundary');
const { captureException } = await import('@sentry/nextjs');

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('RouteErrorBoundary', () => {
    it('renders the shared error state and reports the error via the DA9 seam', () => {
        const error = Object.assign(new Error('boom'), { digest: 'abc123' });

        renderWithProviders(<RouteErrorBoundary error={error} reset={vi.fn()} routeName="recipes" />);

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(captureException).toHaveBeenCalledWith(error, { extra: { route: 'recipes' } });
    });

    it('wires the retry affordance to the supplied reset()', async () => {
        const user = userEvent.setup();
        const reset = vi.fn();
        const error = new Error('boom');

        renderWithProviders(<RouteErrorBoundary error={error} reset={reset} routeName="discover" />);

        await user.click(screen.getByRole('button', { name: /try again/i }));

        expect(reset).toHaveBeenCalledTimes(1);
    });

    it('attaches the boundary-specific route name as report context', () => {
        const error = new Error('boom');

        renderWithProviders(<RouteErrorBoundary error={error} reset={vi.fn()} routeName="collections" />);

        expect(captureException).toHaveBeenCalledWith(error, { extra: { route: 'collections' } });
    });
});
