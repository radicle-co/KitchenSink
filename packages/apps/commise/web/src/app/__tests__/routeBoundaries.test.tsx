// @vitest-environment jsdom
/**
 * Component tests for every web App Router `error.tsx` / `loading.tsx` / `not-found.tsx` boundary added for
 * the data segments (B18). Each boundary file is a thin wrapper delegating to the shared
 * `RouteErrorBoundary` / `RouteLoadingState` / `RouteNotFoundState` (unit-tested in isolation under
 * `components/app/__tests__/`) — THESE tests prove each segment's actual file wires the shared component
 * correctly (a wrong relative import, a dropped `routeName`, or a missing `'use client'` fails here, not
 * just in a shared-component test), per "Next.js boundary files are components — test them as components."
 *
 * `@sentry/nextjs` is mocked before importing any `error.tsx` (they transitively resolve `homeContainer`,
 * which binds the real Sentry reporter), mirroring `HomeWidgetSurface.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@commise/test-utils';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ locale: 'en', id: 'rec_1' }) }));

const { default: LocaleError } = await import('../[locale]/error');
const { default: RecipesError } = await import('../[locale]/recipes/error');
const { default: RecipeDetailError } = await import('../[locale]/recipes/[id]/error');
const { default: DiscoverError } = await import('../[locale]/discover/error');
const { default: CollectionsError } = await import('../[locale]/collections/error');

const { default: LocaleLoading } = await import('../[locale]/loading');
const { default: RecipesLoading } = await import('../[locale]/recipes/loading');
const { default: RecipeDetailLoading } = await import('../[locale]/recipes/[id]/loading');
const { default: DiscoverLoading } = await import('../[locale]/discover/loading');
const { default: CollectionsLoading } = await import('../[locale]/collections/loading');

const { default: LocaleNotFound } = await import('../[locale]/not-found');
const { default: RecipeDetailNotFound } = await import('../[locale]/recipes/[id]/not-found');

const { captureException } = await import('@sentry/nextjs');

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const ERROR_BOUNDARIES = [
    ['[locale]', LocaleError, 'locale'] as const,
    ['[locale]/recipes', RecipesError, 'recipes'] as const,
    ['[locale]/recipes/[id]', RecipeDetailError, 'recipe-detail'] as const,
    ['[locale]/discover', DiscoverError, 'discover'] as const,
    ['[locale]/collections', CollectionsError, 'collections'] as const,
];

describe.each(ERROR_BOUNDARIES)('%s/error.tsx', (_segment, ErrorBoundary, expectedRoute) => {
    it('renders the shared error state, retries via reset(), and reports via DA9', async () => {
        const user = userEvent.setup();
        const reset = vi.fn();
        const error = Object.assign(new Error('boom'), { digest: 'd1' });

        renderWithProviders(<ErrorBoundary error={error} reset={reset} />);

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(captureException).toHaveBeenCalledWith(error, { extra: { route: expectedRoute } });

        await user.click(screen.getByRole('button', { name: /try again/i }));
        expect(reset).toHaveBeenCalledTimes(1);
    });
});

const LOADING_BOUNDARIES = [
    ['[locale]', LocaleLoading] as const,
    ['[locale]/recipes', RecipesLoading] as const,
    ['[locale]/recipes/[id]', RecipeDetailLoading] as const,
    ['[locale]/discover', DiscoverLoading] as const,
    ['[locale]/collections', CollectionsLoading] as const,
];

describe.each(LOADING_BOUNDARIES)('%s/loading.tsx', (_segment, Loading) => {
    it('renders the shared localized loading status', () => {
        renderWithProviders(<Loading />);

        expect(screen.getByRole('status')).toHaveAccessibleName(/loading/i);
    });
});

const NOT_FOUND_BOUNDARIES = [
    ['[locale]', LocaleNotFound] as const,
    ['[locale]/recipes/[id]', RecipeDetailNotFound] as const,
];

describe.each(NOT_FOUND_BOUNDARIES)('%s/not-found.tsx', (_segment, NotFound) => {
    it('renders the shared not-found state with a way back', () => {
        renderWithProviders(<NotFound />);

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('link')).toHaveAttribute('href', '/en');
    });
});
