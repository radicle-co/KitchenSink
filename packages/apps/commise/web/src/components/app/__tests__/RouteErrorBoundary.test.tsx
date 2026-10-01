// @vitest-environment jsdom
/**
 * Component tests for the shared {@link RouteErrorBoundary} (B18/DA9) — the orchestration every web App
 * Router `error.tsx` boundary delegates to: reports the caught error through the SAME injected
 * `errorReporterToken` seam the Home-widget boundaries use (resolved from `homeContainer`, bound to Sentry in
 * production), then renders the pure `RouteErrorState` with a retry that REFETCHES: TanStack's query-error reset,
 * then Next's `retry()` (never `reset()`, which re-renders without re-fetching).
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

const resetQueryErrors = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@tanstack/react-query')>()),
    useQueryErrorResetBoundary: () => ({ reset: resetQueryErrors, clearReset: vi.fn(), isReset: () => false }),
}));

const { RouteErrorBoundary } = await import('../RouteErrorBoundary');
const { captureException } = await import('@sentry/nextjs');

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('RouteErrorBoundary', () => {
    it('renders the shared error state and reports the error via the DA9 seam', () => {
        const error = Object.assign(new Error('boom'), { digest: 'abc123' });

        renderWithProviders(<RouteErrorBoundary error={error} retry={vi.fn()} routeName="recipes" />);

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(captureException).toHaveBeenCalledWith(error, { extra: { route: 'recipes' } });
    });

    /**
     * ⛔ A retry that does not refetch is a retry that renders the same failure again. Next's `retry()` re-fetches
     * the segment; a TanStack query that errored keeps `retryOnMount` off until its reset boundary is reset — so
     * both happen, and in that order.
     */
    it('⛔ Try again resets the query errors, THEN asks Next to re-fetch the segment', async () => {
        const user = userEvent.setup();
        const order: string[] = [];
        resetQueryErrors.mockImplementation(() => order.push('queries'));
        const retry = vi.fn(() => order.push('segment'));

        renderWithProviders(<RouteErrorBoundary error={new Error('boom')} retry={retry} routeName="discover" />);

        await user.click(screen.getByRole('button', { name: /try again/i }));

        expect(order).toEqual(['queries', 'segment']);
    });

    it('attaches the boundary-specific route name as report context', () => {
        const error = new Error('boom');

        renderWithProviders(<RouteErrorBoundary error={error} retry={vi.fn()} routeName="collections" />);

        expect(captureException).toHaveBeenCalledWith(error, { extra: { route: 'collections' } });
    });
});
