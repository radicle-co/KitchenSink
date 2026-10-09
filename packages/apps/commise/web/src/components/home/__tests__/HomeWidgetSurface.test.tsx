// @vitest-environment jsdom
/**
 * Component tests for the web Home widget-surface HOST logic (US-000 / FR-046): discovery → curation →
 * render, the placeholder-vs-bespoke render split, the skip-unknown-id path, and the once-per-session nudge.
 * The host's seams (`container`, `renderers`) are injected with fakes so these assert the composition-root
 * behaviour without loading the real widget chunks — the real recipe slot's states live in
 * `RecipeWidgetSlot.test.tsx`, the chrome in `chrome/__tests__`, and the greeting in `HomeGreeting.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FC, JSX } from 'react';

import {
    errorReporterToken,
    isPlaceholderHomeWidget,
    registerHomeWidget,
    resolveHomeWidgets,
    ROADMAP_WIDGET_IDS,
    type ErrorReporter,
    type HomeWidgetDescriptor,
} from '@commise/features-core';
import { RECIPE_HOME_WIDGET_ID } from '@commise/features-recipes';
import { renderWithProviders } from '@commise/test-utils';
import { recipeServiceKeys } from '@kitchensink/recipe-service-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContainer, type Container } from 'ditox';

// The profile hook hits Clerk + the identity API; stub it to a controllable tier + display name.
const { profileRef } = vi.hoisted(() => ({
    profileRef: {
        current: {
            data: {
                account: { subscriptionTier: 'free' as string | undefined },
                user: { displayName: 'Jane Doe' as string | undefined },
            },
        },
    },
}));
// The shell's sidebar opens the editor through the router and its tab bar reads the route (slice 3).
vi.mock('next/navigation', async (importOriginal) => ({
    ...(await importOriginal<typeof import('next/navigation')>()),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => '/en',
}));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => profileRef.current }));

// `homeContainer` binds `errorReporterToken` to a real Sentry-backed reporter; mocked (never loaded for real)
// so importing it here doesn't require a live Sentry client under test.
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

const { HomeWidgetSurface } = await import('../HomeWidgetSurface');
const { useHomeNudge } = await import('../homeNudgeContext');
const { homeContainer } = await import('../homeContainer');
const { RECENT_RECIPE_LIMIT } = await import('../RecipeWidgetSlot');

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/** A registrable LIVE descriptor with an inert loader (the injected renderer is what actually draws). */
const makeLiveDescriptor = (id: string): HomeWidgetDescriptor => ({
    id,
    load: () => Promise.resolve({ default: (): null => null }),
    defaultWeight: 1,
});

/** A registrable PLACEHOLDER descriptor whose loader resolves the supplied skeleton component. */
const makePlaceholderDescriptor = (id: string, Skeleton: FC): HomeWidgetDescriptor => ({
    kind: 'placeholder',
    id,
    // Waits on a capability that is NOT live in these tests, so the placeholder stays eligible.
    capability: `${id}-capability`,
    load: () => Promise.resolve({ default: Skeleton }),
    defaultWeight: 1,
});

/** A container pre-registered with the given descriptors. */
const containerWith = (...descriptors: readonly HomeWidgetDescriptor[]): Container => {
    const container = createContainer();

    for (const descriptor of descriptors) {
        registerHomeWidget(container, descriptor);
    }

    return container;
};

const renderSurface = (props: Parameters<typeof HomeWidgetSurface>[0], queryClient = new QueryClient()): void => {
    renderWithProviders(
        <QueryClientProvider client={queryClient}>
            <HomeWidgetSurface {...props} />
        </QueryClientProvider>,
    );
};

/** The floating create button: the one the `nav:` breakpoint hides from 840, where the sidebar holds New recipe. */
const floatingCreate = (): HTMLElement | undefined =>
    screen.queryAllByRole('button', { name: 'New recipe' }).find((button) => button.className.includes('nav:hidden'));

const FakeRecipeWidget: FC = () => <div>fake-recipe-widget</div>;

describe('HomeWidgetSurface (web) — host composition', () => {
    it('renders the greeting as the page’s one H1, the avatar and the create button after it, and the region', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));

        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        // Slice 3 (`buildSpec.md` §4.2): the greeting IS the page's large title, its only H1; the avatar is the header's
        // action and the floating create button comes right after it in DOM order (§3.4).
        const heading = screen.getByRole('heading', { level: 1, name: /^Good afternoon/u });
        const fab = screen
            .getAllByRole('button', { name: 'New recipe' })
            .find((button) => button.className.includes('nav:hidden'));

        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('region', { name: 'Home' })).toBeTruthy();
        // The header's avatar, and the sidebar's profile row (CSS shows one of them at a time).
        expect(screen.getAllByRole('link', { name: /^Profile/u })).toHaveLength(2);
        expect(fab).toBeDefined();
        expect(heading.compareDocumentPosition(fab as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // §3.4: the first run's own start buttons (in the recent-recipes widget) take the floating button's place.
    it('hides the floating create button while the cook has no recipes', async () => {
        const queryClient = new QueryClient();
        queryClient.setQueryData(recipeServiceKeys.recipeList({ pageSize: RECENT_RECIPE_LIMIT }), {
            data: [],
            total: 0,
            page: 1,
            pageSize: RECENT_RECIPE_LIMIT,
            hasMore: false,
        });

        renderSurface(
            {
                container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
                renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
            },
            queryClient,
        );

        await waitFor(() => expect(floatingCreate()).toBeUndefined());
    });

    it('sits the greeting on the page canvas, not inside a gradient card', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));

        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        // "No box in a box" (`docs/design/uiOverhaul/buildSpec.md` §1.6): the greeting card is deleted. The page canvas
        // already carries the beach-glow wash, so the greeting sits on it rather than in a second gradient card.
        let node: HTMLElement | null = screen.getByRole('heading', { level: 1, name: /^Good afternoon/u });

        for (; node !== null; node = node.parentElement) {
            expect(node.style.backgroundImage, 'a gradient surface wraps the greeting').not.toContain(
                'linear-gradient',
            );
        }
    });

    it('renders the bespoke slot for a live widget whose id has a registered renderer', async () => {
        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        expect(await screen.findByText('fake-recipe-widget')).toBeTruthy();
    });

    it('renders a placeholder through its loader seam (skeleton), not through the bespoke renderer map', async () => {
        // A placeholder descriptor has no entry in `renderers`; the host must still draw it, via its `load`.
        const Skeleton: FC = () => <div>fake-skeleton</div>;

        renderSurface({
            container: containerWith(
                makeLiveDescriptor(RECIPE_HOME_WIDGET_ID),
                makePlaceholderDescriptor('meal-plan', Skeleton),
            ),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        expect(await screen.findByText('fake-skeleton')).toBeTruthy();
        expect(await screen.findByText('fake-recipe-widget')).toBeTruthy();
    });

    it('SKIPS a live widget whose id has no renderer instead of crashing (graceful version skew)', async () => {
        // `mystery` is a LIVE descriptor (no `kind`), registered but absent from `renderers` — so it is not
        // a placeholder and has no bespoke slot. A host that did not guard this would render `<undefined />`.
        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID), makeLiveDescriptor('mystery')),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        expect(await screen.findByText('fake-recipe-widget')).toBeTruthy();
        expect(screen.queryByText('mystery')).toBeNull();
    });

    it('reports a widget render failure to the injected error reporter and shows a fallback, not a blank (B23/DA9)', () => {
        // The boundary's `onError` routes to the reporter resolved from the INJECTED `errorReporterToken` —
        // never a hard-coded Sentry import — so this asserts against a fake bound onto the test's own container.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const reportError: ErrorReporter = vi.fn();

        const Boom: FC = () => {
            throw new Error('widget boom');
        };

        const container = containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID));
        container.bindValue(errorReporterToken, reportError);

        renderSurface({
            container,
            renderers: { [RECIPE_HOME_WIDGET_ID]: Boom },
        });

        // The throw is caught → a localized fallback replaces the silent null, and the injected reporter was
        // called with the error plus the widget's id as context.
        expect(screen.queryByText('fake-recipe-widget')).toBeNull();
        expect(screen.getByText('This section couldn’t load.')).toBeTruthy();
        // ANNOUNCED, not merely painted: this fallback appears only after the widget has already failed
        // mid-session, so a plain <p> (what web shipped) told a screen-reader user nothing at all. It is a
        // POLITE `status`, not an assertive `alert` — see `HomeWidgetErrorNotice.test.tsx`. Same failure,
        // same treatment, both platforms (FR-044 / §14).
        // The one status that SAYS something: the app's snackbar host keeps its own, empty, mounted (UI-overhaul slice 2).
        expect(screen.getAllByRole('status').filter((region) => region.textContent !== '')).toHaveLength(1);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(reportError).toHaveBeenCalledWith(expect.any(Error), { widget: RECIPE_HOME_WIDGET_ID });

        consoleError.mockRestore();
    });

    it('leaves a PLACEHOLDER failure silent — there is no widget content to explain the loss of (mobile parity)', async () => {
        // Deliberate asymmetry, matched on both platforms: a roadmap skeleton is ITSELF a stand-in for a
        // feature that has not shipped, so a notice in its place would announce the failure of something the
        // viewer was never promised. Only the REPORTING is mandatory on this arm. Pinning it here means a
        // well-meaning "make the two boundaries consistent" change has to argue with a test — the mirror of
        // the same guard in `mobile/tests/components/home/HomeWidgetSurface.native.test.tsx`.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const reportError: ErrorReporter = vi.fn();

        const Boom: FC = () => {
            throw new Error('placeholder boom');
        };

        const container = containerWith(
            makeLiveDescriptor(RECIPE_HOME_WIDGET_ID),
            makePlaceholderDescriptor('meal-plan', Boom),
        );
        container.bindValue(errorReporterToken, reportError);

        renderSurface({ container, renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget } });

        // The placeholder loads through `next/dynamic`, so its throw lands a tick later — wait for the REPORT
        // (the observable proof the boundary fired) before asserting the notice is absent, or this passes
        // vacuously against a surface that simply had not rendered the failing placeholder yet.
        await waitFor(() => {
            expect(reportError).toHaveBeenCalledWith(expect.any(Error), { widget: 'meal-plan' });
        });

        expect(screen.queryByText('This section couldn’t load.')).toBeNull();
        // The app's snackbar host keeps its own status region mounted; no OTHER status may appear here.
        expect(screen.queryAllByRole('status').filter((region) => region.textContent !== '')).toHaveLength(0);
        expect(screen.queryByRole('alert')).toBeNull();

        consoleError.mockRestore();
    });

    it('shows the subscription nudge at most once per session across repeated gated taps', async () => {
        const user = userEvent.setup();

        const GatedWidget: FC = (): JSX.Element => {
            const { trigger } = useHomeNudge();

            return (
                <button type="button" onClick={trigger}>
                    gate
                </button>
            );
        };

        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: GatedWidget },
        });
        const gate = await screen.findByRole('button', { name: 'gate' });

        await user.click(gate);
        expect(screen.getByRole('dialog', { name: 'Unlock Commise Pro' })).toBeTruthy();

        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Maybe later' }));
        expect(screen.queryByRole('dialog')).toBeNull();

        await user.click(gate);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('homeContainer (web) — v1 registration', () => {
    it('registers the live recipe widget AND the roadmap placeholders (005–009 are skeletons, not absent)', () => {
        const descriptors = resolveHomeWidgets(homeContainer);
        const ids = descriptors.map((descriptor) => descriptor.id);

        // The live recipe widget is present…
        expect(ids).toContain(RECIPE_HOME_WIDGET_ID);

        // …and so is every roadmap placeholder — CR-001 replaced "gated widgets are absent" with skeletons.
        for (const roadmapId of ROADMAP_WIDGET_IDS) {
            expect(ids).toContain(roadmapId);
        }
    });

    it('registers the roadmap ids as placeholder-arm descriptors, and the recipe id as a live one', () => {
        const byId = new Map(resolveHomeWidgets(homeContainer).map((descriptor) => [descriptor.id, descriptor]));

        for (const roadmapId of ROADMAP_WIDGET_IDS) {
            const descriptor = byId.get(roadmapId);
            expect(descriptor && isPlaceholderHomeWidget(descriptor)).toBe(true);
        }

        const recipe = byId.get(RECIPE_HOME_WIDGET_ID);
        expect(recipe && isPlaceholderHomeWidget(recipe)).toBe(false);
    });
});
