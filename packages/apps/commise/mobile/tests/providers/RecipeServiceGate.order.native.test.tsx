/**
 * The provider ORDER of the native recipe tree (UI audit 2): the offline queue wraps the service providers, and the
 * recipe client wraps the food client. The web's `RecipeProviders` asserts the same order in its own test, so the two
 * trees cannot drift apart again.
 *
 * WHY THE QUEUE IS OUTSIDE. A queued write outlives the screen that made it, so its owner sits above every feature
 * (the web tree's own comment). The sender reads the client through a closure, not through context, so the queue needs
 * no provider beneath it. This gate used to mount it inside the food provider.
 *
 * The providers are wrapped in marker elements around the REAL implementations, so the assertion is on nesting and the
 * real providers still run.
 */
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Text } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/expo', () => ({
    useAuth: () => ({ userId: 'user_1' }),
    useClerk: () => ({ session: { user: { id: 'user_1' }, getToken: async () => 'tok' } }),
}));

vi.mock('../../src/config/env.js', () => ({
    env: {
        EXPO_PUBLIC_RECIPE_API_URL: 'https://recipe.test.invalid',
        EXPO_PUBLIC_FOOD_API_URL: 'https://food.test.invalid',
    },
}));

vi.mock('../../src/storage/outboxStore.js', async () => ({
    createNativeOutboxStore: (await vi.importActual<typeof import('@kitchensink/sync')>('@kitchensink/sync'))
        .createMemoryOutboxStore,
}));

// The reporter reaches the Sentry SDK, which needs the native runtime; the wiring is what this suite asserts.
vi.mock('../../src/observability/sentryErrorReporter.js', () => ({ reportErrorToSentry: vi.fn() }));

/** The `onFault` each mounted queue was handed. */
const syncProps = vi.hoisted(() => ({ onFault: [] as unknown[] }));

vi.mock('@commise/query/sync', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/query/sync')>();

    return {
        ...actual,
        SyncProvider: (props: Parameters<typeof actual.SyncProvider>[0]) => {
            syncProps.onFault.push(props.onFault);

            return (
                <div data-provider="sync">
                    <actual.SyncProvider {...props} />
                </div>
            );
        },
    };
});

vi.mock('@kitchensink/recipe-service-client/hooks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/recipe-service-client/hooks')>();

    return {
        ...actual,
        RecipeServiceProvider: (props: Parameters<typeof actual.RecipeServiceProvider>[0]) => (
            <div data-provider="recipe">
                <actual.RecipeServiceProvider {...props} />
            </div>
        ),
    };
});

vi.mock('@kitchensink/food-service-client/hooks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/food-service-client/hooks')>();

    return {
        ...actual,
        FoodServiceProvider: (props: Parameters<typeof actual.FoodServiceProvider>[0]) => (
            <div data-provider="food">
                <actual.FoodServiceProvider {...props} />
            </div>
        ),
    };
});

const { RecipeServiceGate } = await import('../../src/providers/RecipeServiceGate.js');

afterEach(cleanup);

describe('RecipeServiceGate — provider order', () => {
    it('mounts the queue outside the recipe client, and the recipe client outside the food client', () => {
        const { container } = render(
            <QueryClientProvider client={new QueryClient()}>
                <RecipeServiceGate>
                    <Text>child</Text>
                </RecipeServiceGate>
            </QueryClientProvider>,
        );

        expect(
            container.querySelector('[data-provider="sync"] [data-provider="recipe"] [data-provider="food"]'),
        ).not.toBeNull();
        expect(container.querySelector('[data-provider="recipe"] [data-provider="sync"]')).toBeNull();
        expect(container.querySelector('[data-provider="food"] [data-provider="recipe"]')).toBeNull();
    });

    it('⛔ hands the queue the app’s Sentry reporter, so an isolated sync failure is reported', async () => {
        const { reportErrorToSentry } = await import('../../src/observability/sentryErrorReporter.js');

        syncProps.onFault.length = 0;
        render(
            <QueryClientProvider client={new QueryClient()}>
                <RecipeServiceGate>
                    <Text>child</Text>
                </RecipeServiceGate>
            </QueryClientProvider>,
        );

        expect(syncProps.onFault.length).toBeGreaterThan(0);
        expect(new Set(syncProps.onFault)).toStrictEqual(new Set([reportErrorToSentry]));
    });
});
