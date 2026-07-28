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
import { cleanup, render, screen } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';

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

/** Mirrors production composition: the host wraps every bespoke slot in a per-widget `ErrorBoundary`. */
const HostBoundary = ({ children }: { readonly children: ReactNode }): JSX.Element => (
    <ErrorBoundary fallback={<p>widget unavailable</p>}>{children}</ErrorBoundary>
);

const renderSlot = (): void => {
    const client = createFakeRecipeServiceClient();

    // Stub the read even though the widget body is mocked to throw. The fake client's un-stubbed methods
    // reject on purpose ("unstubbed method reached the network"), and the slot still issues this query — so
    // leaving it un-stubbed leaks an UNHANDLED REJECTION. Vitest then fails the whole file on unhandled
    // errors even while both assertions pass, and whether the rejection lands before the run ends depends
    // on machine load — which is exactly how it turned `turbo run test` nondeterministic.
    vi.spyOn(client, 'listRecipes').mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 0 });

    render(
        <RecipeServiceProvider client={client}>
            <HostBoundary>
                <RecipeWidgetSlot />
            </HostBoundary>
        </RecipeServiceProvider>,
    );
};

describe('RecipeWidgetSlot (web) — the widget body fails to render', () => {
    it('keeps the "see all recipes" link when the widget throws', () => {
        renderSlot();

        expect(screen.getByRole('link', { name: 'See all recipes' })).toBeTruthy();
    });

    it('does not escalate the widget failure to the host boundary', () => {
        renderSlot();

        // The host fallback firing means the whole slot — navigation included — was replaced.
        expect(screen.queryByText('widget unavailable')).toBeNull();
    });
});
