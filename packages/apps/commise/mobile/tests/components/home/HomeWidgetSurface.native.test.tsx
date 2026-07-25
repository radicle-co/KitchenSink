/**
 * Component tests for the mobile Home widget-surface HOST logic (US-000 / FR-046): discovery → curation →
 * render, the placeholder-vs-bespoke render split, the skip-unknown-id path, and the once-per-session nudge.
 * Rendered via react-native-web under jsdom (see `vitest.native.config.ts`). The host's seams (`container`,
 * `renderers`) are injected with fakes so these assert the composition-root behaviour without loading the
 * real widget chunks — the real recipe slot's states are covered in `RecipeWidgetSlot.native.test.tsx`, and
 * the chrome pieces in their own tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
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
import { createContainer, type Container } from 'ditox';
import { Pressable, Text } from 'react-native';

import { HomeWidgetSurface } from '../../../src/components/home/HomeWidgetSurface.js';
import { homeContainer } from '../../../src/components/home/homeContainer.js';
import { useHomeNudge } from '../../../src/components/home/SubscriptionNudge.js';

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
vi.mock('../../../src/hooks/useUserProfile.js', () => ({ useUserProfile: () => profileRef.current }));

// `homeContainer` binds `errorReporterToken` to a real Sentry-backed reporter; mocked (never loaded for real)
// so importing it here doesn't drag in `@sentry/react-native`'s native module graph under jsdom, mirroring
// how the web host's equivalent test mocks `@sentry/nextjs`.
vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));

// The Home surface reads the bottom safe-area inset for the tab bar; a zero-inset stub renders it faithfully.
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
}));

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const noop = (): void => undefined;

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

const renderSurface = (props: Partial<Parameters<typeof HomeWidgetSurface>[0]> = {}): void => {
    renderWithProviders(<HomeWidgetSurface onSeeAllRecipes={noop} onOpenAccount={noop} {...props} />);
};

const FakeRecipeWidget: FC = () => <Text>fake-recipe-widget</Text>;

describe('HomeWidgetSurface (mobile) — host composition', () => {
    it('renders the time-of-day greeting header and the navigation chrome', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));

        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        expect(screen.getByText('Good afternoon, Chef!')).toBeTruthy();
        // The chrome rendered: the bottom tab-bar landmark ("Main") is unambiguous (unlike the region/tab
        // "Home" labels, which intentionally repeat the destination name).
        expect(screen.getByLabelText('Main')).toBeTruthy();
    });

    it('renders the bespoke slot for a live widget whose id has a registered renderer', async () => {
        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        expect(await screen.findByText('fake-recipe-widget')).toBeTruthy();
    });

    it('renders a placeholder through its loader seam (skeleton), not the bespoke renderer map', async () => {
        const Skeleton: FC = () => <Text>fake-skeleton</Text>;

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
        // `mystery` is a LIVE descriptor registered but absent from `renderers`, so it has no bespoke slot and
        // is not a placeholder. A host that did not guard this would render `<undefined />`; that crash would
        // be swallowed by the per-widget ErrorBoundary, and the only trace is React's console.error. Asserting
        // ZERO error logs is what makes this load-bearing — remove the skip guard and this fails.
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID), makeLiveDescriptor('mystery')),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        expect(await screen.findByText('fake-recipe-widget')).toBeTruthy();
        expect(errorSpy).not.toHaveBeenCalled();

        errorSpy.mockRestore();
    });

    it('reports a widget render failure to the injected error reporter and shows the fallback, not a crash (DA9)', () => {
        // A widget throw must never crash the surface, AND must never be silent (B23/DA9) — the boundary's
        // `onError` routes to the reporter resolved from the INJECTED `errorReporterToken`, not a hard-coded
        // Sentry import, so this asserts against a fake bound onto the test's own container.
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

        // The throw is caught → no crash, the fallback is null (no user-facing text lost) — and the injected
        // reporter was called with the error plus the widget's id as context.
        expect(screen.queryByText('fake-recipe-widget')).toBeNull();
        expect(reportError).toHaveBeenCalledWith(expect.any(Error), { widget: RECIPE_HOME_WIDGET_ID });

        consoleError.mockRestore();
    });

    it('shows the subscription nudge at most once per session across repeated gated taps', async () => {
        const GatedWidget: FC = (): JSX.Element => {
            const { trigger } = useHomeNudge();

            return (
                <Pressable accessibilityRole="button" accessibilityLabel="gate" onPress={trigger}>
                    <Text>gate</Text>
                </Pressable>
            );
        };

        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: GatedWidget },
        });
        const gate = await screen.findByRole('button', { name: 'gate' });

        fireEvent.click(gate);
        expect(screen.getByText('Unlock Commise Pro')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
        expect(screen.queryByText('Unlock Commise Pro')).toBeNull();

        fireEvent.click(gate);
        expect(screen.queryByText('Unlock Commise Pro')).toBeNull();
    });
});

describe('homeContainer (mobile) — v1 registration', () => {
    it('registers the live recipe widget AND the roadmap placeholders (005–009 are skeletons, not absent)', () => {
        const ids = resolveHomeWidgets(homeContainer).map((descriptor) => descriptor.id);

        expect(ids).toContain(RECIPE_HOME_WIDGET_ID);

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
