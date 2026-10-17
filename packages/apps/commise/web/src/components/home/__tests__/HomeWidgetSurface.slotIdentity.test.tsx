// @vitest-environment jsdom
/**
 * The default recipe slot keeps its identity across renders (plan 2026-10-16, GATE round 26).
 *
 * The host once built the slot's component TYPE inside `useMemo` keyed on the resolved error reporter, so any
 * unstable reporter (a re-bound token, a new container) gave React a new type and REMOUNTED the slot: its local
 * state, its in-flight read and its retry counter all reset. This pins that the slot survives a new reporter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState, type JSX } from 'react';

import {
    errorReporterToken,
    registerHomeWidget,
    type ErrorReporter,
    type HomeWidgetDescriptor,
} from '@commise/features-core';
import { RECIPE_HOME_WIDGET_ID } from '@commise/features-recipes';
import { renderWithProviders } from '@commise/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContainer, type Container } from 'ditox';

vi.mock('next/navigation', async (importOriginal) => ({
    ...(await importOriginal<typeof import('next/navigation')>()),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => '/en',
}));
vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: () => ({ data: { account: { paidFeatures: 'hidden' }, user: { displayName: 'Jane' } } }),
}));
vi.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ data: { searchShortcut: true } }) }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

const mounts = vi.hoisted(() => ({ count: 0, lastOnWidgetError: undefined as ((error: unknown) => void) | undefined }));

// A slot with LOCAL state and a mount counter: a remount resets the state and bumps the counter.
vi.mock('../RecipeWidgetSlot', async () => {
    const { useEffect } = await import('react');

    return {
        RecipeWidgetSlot: ({ onWidgetError }: { readonly onWidgetError?: (error: unknown) => void }): JSX.Element => {
            const [taps, setTaps] = useState(0);

            mounts.lastOnWidgetError = onWidgetError;
            useEffect(() => {
                mounts.count += 1;
            }, []);

            return (
                <button type="button" onClick={() => setTaps((n) => n + 1)}>
                    {`taps:${taps}`}
                </button>
            );
        },
    };
});

const { HomeWidgetSurface } = await import('../HomeWidgetSurface');

afterEach(() => {
    cleanup();
    mounts.count = 0;
    mounts.lastOnWidgetError = undefined;
});

const descriptor: HomeWidgetDescriptor = {
    id: RECIPE_HOME_WIDGET_ID,
    load: () => Promise.resolve({ default: (): null => null }),
    defaultWeight: 1,
};

/** A container holding the recipe descriptor and the given reporter. */
const containerWith = (reporter: ErrorReporter): Container => {
    const container = createContainer();

    registerHomeWidget(container, descriptor);
    container.bindValue(errorReporterToken, reporter);

    return container;
};

describe('HomeWidgetSurface (web) — recipe slot identity', () => {
    it('does not remount the recipe slot when the error reporter changes, and reports through the NEW one', async () => {
        const user = userEvent.setup();
        const first: ErrorReporter = vi.fn();
        const second: ErrorReporter = vi.fn();
        const queryClient = new QueryClient();

        // Swapping the reporter hands the surface a NEW container each time: a new resolved reporter, same tree.
        const Harness = (): JSX.Element => {
            const [reporter, setReporter] = useState<ErrorReporter>(() => first);
            const container = useMemo(() => containerWith(reporter), [reporter]);

            return (
                <QueryClientProvider client={queryClient}>
                    <button type="button" onClick={() => setReporter(() => second)}>
                        swap reporter
                    </button>
                    <HomeWidgetSurface container={container} />
                </QueryClientProvider>
            );
        };

        renderWithProviders(<Harness />);

        await user.click(await screen.findByRole('button', { name: 'taps:0' }));
        expect(screen.getByRole('button', { name: 'taps:1' })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'swap reporter' }));

        expect(screen.getByRole('button', { name: 'taps:1' })).toBeTruthy();
        expect(mounts.count).toBe(1);

        mounts.lastOnWidgetError?.(new Error('boom'));
        expect(second).toHaveBeenCalledWith(expect.any(Error), { widget: RECIPE_HOME_WIDGET_ID });
        expect(first).not.toHaveBeenCalled();
    });
});
