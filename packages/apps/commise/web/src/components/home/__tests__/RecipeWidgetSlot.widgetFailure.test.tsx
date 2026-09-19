// @vitest-environment jsdom
/**
 * The recipe Home-widget slot must not let a WIDGET-BODY failure take the "see all recipes" NAVIGATION link
 * with it — the web mirror of `mobile/tests/components/home/RecipeWidgetSlot.widgetFailure.native.test.tsx`
 * (FR-044 platform parity: the two hosts compose the widget identically, so they must degrade identically).
 *
 * `HomeWidgetSurface` draws each bespoke slot inside a per-widget `ErrorBoundary`. That boundary is the right
 * last resort for the widget's CONTENT, but it wraps the WHOLE slot — so before the inner boundary added here,
 * a throw anywhere in the widget body replaced the navigation link with the widget-error text, stranding the
 * viewer on Home with no route to their recipes. Losing the content is acceptable; losing the route is not.
 *
 * The widget is substituted for a throwing component (the same `next/dynamic` seam the happy-path spec
 * replaces for determinism), which is what a failed chunk or a bad recipe record does in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { renderWithRecipeClient } from '@commise/test-utils';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

// The code-split widget throws on render — the production shape of a failed chunk / bad record.
vi.mock('next/dynamic', () => ({
    default: () => () => {
        throw new Error('widget body failed');
    },
}));

const { RecipeWidgetSlot } = await import('../RecipeWidgetSlot');

afterEach(cleanup);

beforeEach(() => {
    pushMock.mockReset();
    // React logs the caught boundary error; silence it so a PASSING run has clean output.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

/**
 * Its fallback is a DISTINCT sentinel rather than the real host copy on purpose: both boundaries render the
 * SAME localized notice, so a shared string could not tell "the inner boundary CONTAINED the failure" apart
 * from "the failure ESCAPED and erased the navigation with it" — the very regression this file exists for.
 */
const HOST_BOUNDARY_SENTINEL = 'host-boundary-fired';

/** Mirrors production composition: the host wraps every bespoke slot in a per-widget `ErrorBoundary`. */
const HostBoundary = ({ children }: { readonly children: ReactNode }): JSX.Element => (
    <ErrorBoundary fallback={<p>{HOST_BOUNDARY_SENTINEL}</p>}>{children}</ErrorBoundary>
);

/**
 * ⚠️ ASYNC, and the `await act` is load-bearing. The slot resolves its recipes in an inner container (it needs
 * the ids to start the deferred calorie batch) BEFORE the widget mounts, so a synchronous render only ever
 * reaches the loading card and the throwing widget never runs — every assertion below would then pass or fail
 * for reasons that have nothing to do with the boundary. Flushing that resolution is what actually puts the
 * failing widget on screen.
 *
 * `renderWithRecipeClient` supplies the production provider pair (`QueryClientProvider` +
 * `RecipeServiceProvider`, as `RecipeProviders` mounts them), since the slot now reads the query cache.
 */
const renderSlot = async (): Promise<void> => {
    const client = createFakeRecipeServiceClient();

    // Stub the read even though the widget body is mocked to throw. The fake client's un-stubbed methods
    // reject on purpose ("unstubbed method reached the network"), and the slot still issues this query — so
    // leaving it un-stubbed leaks an UNHANDLED REJECTION. Vitest then fails the whole file on unhandled
    // errors even while both assertions pass, and whether the rejection lands before the run ends depends
    // on machine load — which is exactly how it turned `turbo run test` nondeterministic.
    vi.spyOn(client, 'listRecipes').mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 0,
        hasMore: false,
    });

    await act(async () => {
        renderWithRecipeClient(
            <HostBoundary>
                <RecipeWidgetSlot />
            </HostBoundary>,
            client,
        );
    });
};

describe('RecipeWidgetSlot (web) — the widget body fails to render', () => {
    it('keeps the "see all recipes" link when the widget throws', async () => {
        await renderSlot();

        expect(screen.getByRole('link', { name: 'See all recipes' })).toBeTruthy();
    });

    it('does not escalate the widget failure to the host boundary', async () => {
        await renderSlot();

        // The host fallback firing means the whole slot — navigation included — was replaced.
        expect(screen.queryByText(HOST_BOUNDARY_SENTINEL)).toBeNull();
    });

    it('explains the loss with the localized notice, in the same words mobile uses', async () => {
        await renderSlot();

        // The inner boundary's own copy was previously unasserted on BOTH platforms: mobile had drifted to a
        // silent `null` here, and nothing on web would have failed if this fallback had been deleted too. The
        // literal is asserted (not `webMessages.en...`) and is character-identical to the mobile catalog's
        // `home.widgetError`, so the two surfaces cannot drift apart again without one of these tests going red.
        expect(screen.getByText('This section couldn’t load.')).toBeTruthy();
    });

    it('announces the loss POLITELY instead of leaving it silent to assistive tech', async () => {
        await renderSlot();

        // Announced (the original drift was a plain <p>, silent to a screen reader) but POLITE, not
        // assertive — see `HomeWidgetErrorNotice`'s own suite for why `status` is the right register here,
        // and mobile's mirror of this test for the matching native decision.
        expect(screen.getByRole('status').textContent).toBe('This section couldn’t load.');
        expect(screen.queryByRole('alert')).toBeNull();

        // …and it must be the INNER boundary's notice. Were the throw escaping to the host, the sentinel would
        // be showing and the navigation gone — a regression a bare "is the message on screen?" check passes.
        expect(screen.queryByText(HOST_BOUNDARY_SENTINEL)).toBeNull();
        expect(screen.getByRole('link', { name: 'See all recipes' })).toBeTruthy();
    });

    it('does not offer a retry affordance it cannot honour (React.lazy caches the rejection)', async () => {
        await renderSlot();

        // Deliberate, and matched by mobile: the ONLY control left in the failed slot is the route out of
        // Home. React's `lazyInitializer` (react 19.2.7, `cjs/react.development.js`) invokes the loader only
        // while `_status === -1`; a rejection parks the payload at `_status = 2` and every later render bare-
        // throws the cached `_result`. So a "try again" that merely called `resetErrorBoundary()` would
        // re-render the same module-scope lazy object, re-throw synchronously, and read as a dead button.
        expect(screen.queryAllByRole('button')).toHaveLength(0);

        const controls = screen.getAllByRole('link');

        expect(controls).toHaveLength(1);
        expect(controls[0]?.textContent).toBe('See all recipes');
    });
});
