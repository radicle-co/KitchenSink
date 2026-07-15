// @vitest-environment jsdom
/**
 * Component tests for the web Home widget-surface HOST logic (US-000 / FR-046): discovery → curation →
 * render, the skip-unknown-id path, gated-widget absence, and the once-per-session nudge. The host's seams
 * (`container`, `renderers`) are injected with fakes so these assert the composition-root behaviour without
 * loading the real widget chunks — the real recipe slot's loading/empty/populated states are covered in
 * `RecipeWidgetSlot.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FC, JSX } from 'react';

import { registerHomeWidget, resolveHomeWidgets, type HomeWidgetDescriptor } from '@commise/features-core';
import { RECIPE_HOME_WIDGET_ID } from '@commise/features-recipes';
import { LocaleProvider } from '@commise/i18n/react';
import { createContainer, type Container } from 'ditox';

// The profile hook hits Clerk + the identity API; stub it to a controllable tier. LogoutButton needs Clerk
// context; stub it out — navigation chrome is not under test here.
const { profileRef } = vi.hoisted(() => ({
    profileRef: { current: { data: { account: { subscriptionTier: 'free' as string | undefined } } } },
}));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => profileRef.current }));
vi.mock('@/components/auth/LogoutButton', () => ({ LogoutButton: (): null => null }));

const { HomeWidgetSurface } = await import('../HomeWidgetSurface');
const { useHomeNudge } = await import('../SubscriptionNudge');
const { homeContainer } = await import('../homeContainer');

afterEach(cleanup);

/** A registrable descriptor with an inert loader (the injected renderer is what actually draws). */
const makeDescriptor = (id: string): HomeWidgetDescriptor => ({
    id,
    load: () => Promise.resolve({ default: (): null => null }),
    defaultWeight: 1,
});

/** A container pre-registered with the given widget ids. */
const containerWith = (...ids: readonly string[]): Container => {
    const container = createContainer();

    for (const id of ids) {
        registerHomeWidget(container, makeDescriptor(id));
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
    it('renders the greeting header and the widget-surface region', () => {
        renderSurface({ container: containerWith(RECIPE_HOME_WIDGET_ID), renderers: { recipes: FakeRecipeWidget } });

        expect(screen.getByText('Welcome back, Chef!')).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Home' })).toBeTruthy();
    });

    it('renders the slot for a curated widget whose id has a registered renderer', async () => {
        renderSurface({ container: containerWith(RECIPE_HOME_WIDGET_ID), renderers: { recipes: FakeRecipeWidget } });

        expect(await screen.findByText('fake-recipe-widget')).toBeTruthy();
    });

    it('SKIPS a curated widget whose id has no renderer instead of crashing (graceful version skew)', async () => {
        // `mystery` is registered (so it survives curation) but absent from `renderers`. A host that did not
        // guard the missing renderer would render `<undefined />` and throw "Element type is invalid".
        renderSurface({
            container: containerWith(RECIPE_HOME_WIDGET_ID, 'mystery'),
            renderers: { recipes: FakeRecipeWidget },
        });

        expect(await screen.findByText('fake-recipe-widget')).toBeTruthy();
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

        renderSurface({ container: containerWith(RECIPE_HOME_WIDGET_ID), renderers: { recipes: GatedWidget } });
        const gate = await screen.findByRole('button', { name: 'gate' });

        // First gated tap → the nudge appears.
        await user.click(gate);
        expect(screen.getByRole('dialog', { name: 'Unlock Commise Pro' })).toBeTruthy();

        // Dismiss it.
        await user.click(screen.getByRole('button', { name: 'Maybe later' }));
        expect(screen.queryByRole('dialog')).toBeNull();

        // A second gated tap in the same session must NOT re-show it (once per session).
        await user.click(gate);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('homeContainer (web) — v1 registration', () => {
    it('registers ONLY the recipe widget (gated widgets 005–009 are absent, not empty tiles)', () => {
        const registeredIds = resolveHomeWidgets(homeContainer).map((descriptor) => descriptor.id);

        expect(registeredIds).toEqual([RECIPE_HOME_WIDGET_ID]);
    });
});
