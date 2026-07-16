// @vitest-environment jsdom
/**
 * Component tests for the web Home widget-surface HOST logic (US-000 / FR-046): discovery → curation →
 * render, the placeholder-vs-bespoke render split, the skip-unknown-id path, and the once-per-session nudge.
 * The host's seams (`container`, `renderers`) are injected with fakes so these assert the composition-root
 * behaviour without loading the real widget chunks — the real recipe slot's states live in
 * `RecipeWidgetSlot.test.tsx`, the chrome in `chrome/__tests__`, and the greeting in `HomeGreeting.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FC, JSX } from 'react';

import {
    isPlaceholderHomeWidget,
    registerHomeWidget,
    resolveHomeWidgets,
    ROADMAP_WIDGET_IDS,
    type HomeWidgetDescriptor,
} from '@commise/features-core';
import { RECIPE_HOME_WIDGET_ID } from '@commise/features-recipes';
import { LocaleProvider } from '@commise/i18n/react';
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
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => profileRef.current }));

const { HomeWidgetSurface } = await import('../HomeWidgetSurface');
const { useHomeNudge } = await import('../SubscriptionNudge');
const { homeContainer } = await import('../homeContainer');

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

const renderSurface = (props: Parameters<typeof HomeWidgetSurface>[0]): void => {
    render(
        <LocaleProvider locale="en">
            <HomeWidgetSurface {...props} />
        </LocaleProvider>,
    );
};

const FakeRecipeWidget: FC = () => <div>fake-recipe-widget</div>;

describe('HomeWidgetSurface (web) — host composition', () => {
    it('renders the time-of-day greeting header and the widget-surface region', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));

        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        expect(screen.getByRole('heading', { name: 'Good afternoon, Chef!' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Home' })).toBeTruthy();
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
