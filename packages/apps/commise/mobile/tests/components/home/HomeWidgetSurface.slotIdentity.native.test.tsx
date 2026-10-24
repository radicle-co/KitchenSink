/**
 * The default recipe slot keeps its identity across renders (plan 2026-10-16, GATE round 26) — mobile half.
 *
 * The host once built the slot's component TYPE inside `useMemo` keyed on the resolved error reporter and the
 * navigation intents, so any unstable one remounted the slot: its local state and in-flight read reset. This pins
 * that the slot survives a new reporter, and that the slot still reports through the NEW one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useEffect, useMemo, useState, type JSX } from 'react';

import {
    errorReporterToken,
    registerHomeWidget,
    type ErrorReporter,
    type HomeWidgetDescriptor,
} from '@commise/features-core';
import { RECIPE_HOME_WIDGET_ID } from '@commise/features-recipes';
import { renderWithProviders } from '@commise/test-utils';
import { createContainer, type Container } from 'ditox';
import { Pressable, Text } from 'react-native';

vi.mock('../../../src/hooks/useUserProfile.js', () => ({
    useUserProfile: () => ({ data: { account: { paidFeatures: 'hidden' }, user: { displayName: 'Jane' } } }),
}));
vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));
vi.mock('react-native-safe-area-context', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
}));

const mounts = vi.hoisted(() => ({ count: 0, lastOnWidgetError: undefined as ((error: unknown) => void) | undefined }));

// A slot with LOCAL state and a mount counter: a remount resets the state and bumps the counter.
vi.mock('../../../src/components/home/RecipeWidgetSlot.js', () => ({
    RecipeWidgetSlot: ({ onWidgetError }: { readonly onWidgetError?: (error: unknown) => void }): JSX.Element => {
        const [taps, setTaps] = useState(0);

        mounts.lastOnWidgetError = onWidgetError;
        useEffect(() => {
            mounts.count += 1;
        }, []);

        return (
            <Pressable accessibilityRole="button" onPress={() => setTaps((n) => n + 1)}>
                <Text>{`taps:${taps}`}</Text>
            </Pressable>
        );
    },
}));

const { HomeWidgetSurface } = await import('../../../src/components/home/HomeWidgetSurface.js');

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

describe('HomeWidgetSurface (mobile) — recipe slot identity', () => {
    it('does not remount the recipe slot when the error reporter changes, and reports through the NEW one', async () => {
        const first: ErrorReporter = vi.fn();
        const second: ErrorReporter = vi.fn();

        // Swapping the reporter hands the surface a NEW container each time: a new resolved reporter, same tree.
        const Harness = (): JSX.Element => {
            const [reporter, setReporter] = useState<ErrorReporter>(() => first);
            const container = useMemo(() => containerWith(reporter), [reporter]);

            return (
                <>
                    <Pressable accessibilityRole="button" onPress={() => setReporter(() => second)}>
                        <Text>swap reporter</Text>
                    </Pressable>
                    <HomeWidgetSurface onSeeAllRecipes={vi.fn()} onSelectRecipe={vi.fn()} container={container} />
                </>
            );
        };

        renderWithProviders(<Harness />);

        await screen.findByText('taps:0');
        fireEvent.click(screen.getByRole('button', { name: 'taps:0' }));
        expect(screen.getByText('taps:1')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'swap reporter' }));

        expect(screen.getByText('taps:1')).toBeTruthy();
        expect(mounts.count).toBe(1);

        mounts.lastOnWidgetError?.(new Error('boom'));
        expect(second).toHaveBeenCalledWith(expect.any(Error), { widget: RECIPE_HOME_WIDGET_ID });
        expect(first).not.toHaveBeenCalled();
    });
});
