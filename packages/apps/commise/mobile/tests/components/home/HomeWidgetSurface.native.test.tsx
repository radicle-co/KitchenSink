/**
 * Component tests for the mobile Home widget-surface HOST logic (US-000 / FR-046): discovery → curation →
 * render, the skip-unknown-id path, gated-widget absence, and the once-per-session nudge. Rendered via
 * react-native-web under jsdom (see `vitest.native.config.ts`). The host's seams (`container`, `renderers`)
 * are injected with fakes so these assert the composition-root behaviour without loading the real widget
 * chunks — the real recipe slot's loading/empty/populated states are covered in
 * `RecipeWidgetSlot.native.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FC, JSX } from 'react';

import { registerHomeWidget, resolveHomeWidgets, type HomeWidgetDescriptor } from '@commise/features-core';
import { RECIPE_HOME_WIDGET_ID } from '@commise/features-recipes';
import { LocaleProvider } from '@commise/i18n/react';
import { createContainer, type Container } from 'ditox';
import { Pressable, Text } from 'react-native';

import { HomeWidgetSurface } from '../../../src/components/home/HomeWidgetSurface.js';
import { homeContainer } from '../../../src/components/home/homeContainer.js';
import { useHomeNudge } from '../../../src/components/home/SubscriptionNudge.js';

// The profile hook hits Clerk + the identity API; stub it to a controllable tier.
const { profileRef } = vi.hoisted(() => ({
    profileRef: { current: { data: { account: { subscriptionTier: 'free' as string | undefined } } } },
}));
vi.mock('../../../src/hooks/useUserProfile.js', () => ({ useUserProfile: () => profileRef.current }));

afterEach(cleanup);

const noop = (): void => undefined;

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

const renderSurface = (props: Partial<Parameters<typeof HomeWidgetSurface>[0]> = {}): void => {
    render(
        <LocaleProvider locale="en">
            <HomeWidgetSurface onSeeAllRecipes={noop} {...props} />
        </LocaleProvider>,
    );
};

const FakeRecipeWidget: FC = () => <Text>fake-recipe-widget</Text>;

describe('HomeWidgetSurface (mobile) — host composition', () => {
    it('renders the greeting header and the widget-surface region', () => {
        renderSurface({ container: containerWith(RECIPE_HOME_WIDGET_ID), renderers: { recipes: FakeRecipeWidget } });

        expect(screen.getByText('Welcome back, Chef!')).toBeTruthy();
        expect(screen.getByLabelText('Home')).toBeTruthy();
    });

    it('renders the slot for a curated widget whose id has a registered renderer', async () => {
        renderSurface({ container: containerWith(RECIPE_HOME_WIDGET_ID), renderers: { recipes: FakeRecipeWidget } });

        expect(await screen.findByText('fake-recipe-widget')).toBeTruthy();
    });

    it('SKIPS a curated widget whose id has no renderer instead of crashing (graceful version skew)', async () => {
        // `mystery` is registered (so it survives curation) but absent from `renderers`. A host that did not
        // guard the missing renderer would render `<undefined />` and throw "Element type is invalid". That
        // crash would be *swallowed* by the per-widget `ErrorBoundary` (fallback null) — so the recipe widget
        // still paints either way — and the only observable trace of the crash is React logging the caught
        // error to `console.error`. Asserting ZERO error logs is therefore what makes this test load-bearing:
        // remove the skip guard and this fails (React logs the boundary-caught "Element type is invalid").
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderSurface({
            container: containerWith(RECIPE_HOME_WIDGET_ID, 'mystery'),
            renderers: { recipes: FakeRecipeWidget },
        });

        expect(await screen.findByText('fake-recipe-widget')).toBeTruthy();
        expect(errorSpy).not.toHaveBeenCalled();

        errorSpy.mockRestore();
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

        renderSurface({ container: containerWith(RECIPE_HOME_WIDGET_ID), renderers: { recipes: GatedWidget } });
        const gate = await screen.findByRole('button', { name: 'gate' });

        // First gated tap → the nudge appears.
        fireEvent.click(gate);
        expect(screen.getByText('Unlock Commise Pro')).toBeTruthy();

        // Dismiss it.
        fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
        expect(screen.queryByText('Unlock Commise Pro')).toBeNull();

        // A second gated tap in the same session must NOT re-show it (once per session).
        fireEvent.click(gate);
        expect(screen.queryByText('Unlock Commise Pro')).toBeNull();
    });
});

describe('homeContainer (mobile) — v1 registration', () => {
    it('registers ONLY the recipe widget (gated widgets 005–009 are absent, not empty tiles)', () => {
        const registeredIds = resolveHomeWidgets(homeContainer).map((descriptor) => descriptor.id);

        expect(registeredIds).toEqual([RECIPE_HOME_WIDGET_ID]);
    });
});
