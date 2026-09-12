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

/**
 * The two segments whose settled body is a recipe-card GRID owe a card-grid skeleton, not a line of text: a
 * paragraph followed by a grid is a full-page reflow on every navigation, and "skeleton loaders for recipes"
 * is unmet at the route level while the route boundary paints nothing card-shaped.
 *
 * ⚠️ Deliberately NOT the other two. `/collections`' settled body is a THREE-column grid of collection cards
 * (`CollectionList.tsx`), so the recipe skeleton's four-column rhythm would reflow rather than reserve — the
 * very invariant `RecipeCardGridSkeleton` documents. `/recipes/[id]` is a DETAIL route: eight card
 * placeholders where one recipe is about to render is the same defect with more paint. Both keep
 * `RouteLoadingState`; a `CollectionCardGridSkeleton` is a follow-up, not this change.
 */
const CARD_GRID_LOADING_BOUNDARIES = [
    ['[locale]/recipes', RecipesLoading] as const,
    ['[locale]/discover', DiscoverLoading] as const,
];

describe.each(CARD_GRID_LOADING_BOUNDARIES)('%s/loading.tsx — the card-grid skeleton', (_segment, Loading) => {
    it('paints placeholder CARDS, not a bare status line', () => {
        const { container } = renderWithProviders(<Loading />);

        // The shimmer cards are decorative (`aria-hidden`), so they are reachable only through the DOM — the
        // live region above them is what a screen reader is given, and it is asserted separately below.
        const grid = container.querySelector('[aria-hidden="true"]');

        expect(grid, 'a recipe route must reserve the grid it is about to render').not.toBeNull();
        expect(grid?.children.length ?? 0).toBeGreaterThan(1);
    });

    it('keeps the live region captioned by its localized label as CONTENT', () => {
        renderWithProviders(<Loading />);
        const status = screen.getByRole('status');

        // The invariant `RouteLoadingState` and `RecipeCardGridSkeleton` both hold: an empty `role="status"`
        // is zero-height AND silent, because a live region announces its CONTENT, not its label.
        expect(status).toHaveAccessibleName(/loading/i);
        expect(status.textContent).toMatch(/loading/i);
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
