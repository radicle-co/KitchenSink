// @vitest-environment jsdom
/**
 * The provider ORDER of the web recipe tree (UI audit 2): the offline queue wraps the service providers, and the
 * recipe client wraps the food client. Mobile's `RecipeServiceGate` asserts the same order in its own test, so the two
 * trees cannot drift apart again.
 *
 * WHY THE QUEUE IS OUTSIDE. A queued write outlives the screen that made it, so its owner sits above every feature
 * (`RecipeProviders`' own comment). The sender reads the client through a closure, not through context, so the queue
 * needs no provider beneath it. Mobile used to mount it inside the food provider.
 *
 * The providers are wrapped in marker elements around the REAL implementations, so the assertion is on DOM nesting and
 * the real providers still run.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs', () => ({
    useAuth: () => ({ getToken: async () => 'tok', userId: 'user_1' }),
    useClerk: () => ({ session: { user: { id: 'user_1' } } }),
}));

vi.mock('@commise/query/sync', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/query/sync')>();

    return {
        ...actual,
        SyncProvider: (props: Parameters<typeof actual.SyncProvider>[0]) => (
            <div data-provider="sync">
                <actual.SyncProvider {...props} />
            </div>
        ),
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

const { RecipeProviders } = await import('../RecipeProviders.js');

afterEach(cleanup);

describe('RecipeProviders (web) — provider order', () => {
    it('mounts the queue outside the recipe client, and the recipe client outside the food client', () => {
        const { container } = render(
            <RecipeProviders>
                <span>child</span>
            </RecipeProviders>,
        );

        expect(
            container.querySelector('[data-provider="sync"] [data-provider="recipe"] [data-provider="food"]'),
        ).not.toBeNull();
        expect(container.querySelector('[data-provider="recipe"] [data-provider="sync"]')).toBeNull();
        expect(container.querySelector('[data-provider="food"] [data-provider="recipe"]')).toBeNull();
    });
});
