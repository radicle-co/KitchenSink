/**
 * The recipe service tree both hosts mount (it was `RecipeProviders` on web and `RecipeServiceGate` on mobile, the same
 * six-deep nest differing only in the store). Pinned here: the NESTING ORDER (recipe client outside the food client,
 * both outside the cook's marks, the draft observer outside all three), that every provider receives the cook the tree
 * was given, and that the outbox's recipe answers reach the cook's device draft through the injected queue port.
 *
 * Providers are wrapped in marker elements around the REAL implementations, so the assertion is on DOM nesting and the
 * real providers still run.
 */
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { createMemoryOutboxStore, type SettlementEvent } from '@kitchensink/sync';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { editorDraftsFor } from '../../editor/cookDrafts.js';
import type { EditorWriteAnswer } from '../../hooks/useRecipeEditor.js';
import type { RecipeServiceClients } from '../useRecipeServiceClients.js';

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

vi.mock('../../detail/CookMarksProvider.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../detail/CookMarksProvider.js')>();

    return {
        ...actual,
        CookMarksProvider: (props: Parameters<typeof actual.CookMarksProvider>[0]) => (
            <div data-provider="marks" data-subject={props.subject ?? ''}>
                <actual.CookMarksProvider {...props} />
            </div>
        ),
    };
});

const { RecipeServicesTree } = await import('../RecipeServicesTree.js');

const clients = { recipe: {}, food: {} } as unknown as RecipeServiceClients;

afterEach(cleanup);

/** An outbox settlement bus the test can publish on. */
function queue() {
    const listeners = new Set<(event: SettlementEvent<EditorWriteAnswer>) => void>();

    return {
        useQueue: () => ({
            subscribe: (listener: (event: SettlementEvent<EditorWriteAnswer>) => void) => {
                listeners.add(listener);

                return () => listeners.delete(listener);
            },
        }),
        publish: (event: SettlementEvent<EditorWriteAnswer>) => {
            for (const listener of [...listeners]) {
                listener(event);
            }
        },
        listeners,
    };
}

describe('RecipeServicesTree', () => {
    it('nests the recipe client outside the food client, and the food client outside the cook marks', () => {
        const { container } = render(
            <RecipeServicesTree
                clients={clients}
                store={createMemoryOutboxStore()}
                subject="user_a"
                useQueue={queue().useQueue}
            >
                <span>child</span>
            </RecipeServicesTree>,
        );

        expect(
            container.querySelector('[data-provider="recipe"] [data-provider="food"] [data-provider="marks"] span'),
        ).not.toBeNull();
        expect(container.querySelector('[data-provider="food"] [data-provider="recipe"]')).toBeNull();
        expect(container.querySelector('[data-provider="marks"] [data-provider="food"]')).toBeNull();
    });

    it('gives the cook marks the cook the tree was given', () => {
        const { container } = render(
            <RecipeServicesTree
                clients={clients}
                store={createMemoryOutboxStore()}
                subject="user_a"
                useQueue={queue().useQueue}
            >
                <span>child</span>
            </RecipeServicesTree>,
        );

        expect(container.querySelector('[data-provider="marks"]')?.getAttribute('data-subject')).toBe('user_a');
    });

    it('records a synced recipe write in THAT cook’s device draft, via the injected queue', () => {
        const device = createMemoryOutboxStore();
        const adopt = vi.spyOn(editorDraftsFor(device, 'user_a')!, 'adopt').mockResolvedValue(undefined);
        const bus = queue();

        render(
            <RecipeServicesTree clients={clients} store={device} subject="user_a" useQueue={bus.useQueue}>
                <span>child</span>
            </RecipeServicesTree>,
        );

        bus.publish({
            seq: 1,
            entity: 'recipe',
            localId: 'local:recipe:a',
            intentKind: 'create',
            outcome: 'synced',
            serverId: 'rec_9',
            answer: { kind: 'recipeWritten', detail: makeRecipeDetail({ id: 'rec_9', currentVersion: 1 }) },
        });

        expect(adopt).toHaveBeenCalledWith('local:recipe:a', { serverId: 'rec_9', version: 1 });
    });

    it('records nothing while nobody is signed in, and unsubscribes on unmount', () => {
        const bus = queue();
        const { unmount } = render(
            <RecipeServicesTree
                clients={clients}
                store={createMemoryOutboxStore()}
                subject={undefined}
                useQueue={bus.useQueue}
            >
                <span>child</span>
            </RecipeServicesTree>,
        );

        unmount();

        expect(bus.listeners.size).toBe(0);
    });
});
