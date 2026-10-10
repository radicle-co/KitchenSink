import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import {
    isFetchUnavailableError,
    isNotFoundError,
    type CatalogSearchResultView,
} from '@kitchensink/food-service-client';
import { useFoodServiceClient, useFoodServiceSubject } from '@kitchensink/food-service-client/hooks';
import type { FoodServiceClient } from '@kitchensink/food-service-client';

import {
    guardedFoodClient,
    makeQuietFoodClient,
    renderWithFoodClient,
    withFoodClient,
} from '../renderWithFoodClient.js';

afterEach(cleanup);

/** A catalog result the quiet client finds, whatever the text. */
const OLIVE_OIL: CatalogSearchResultView = { id: 'food_olive_oil', name: 'olive oil', score: 0.9 };

/** Shows whether a food client and a cook are mounted above it; `useFoodServiceClient` throws without a provider. */
function Probe({ onClient }: { readonly onClient: (client: FoodServiceClient) => void }) {
    const client = useFoodServiceClient();
    const cook = useFoodServiceSubject();

    onClient(client);

    return <span>cook:{cook ?? 'none'}</span>;
}

describe('makeQuietFoodClient', () => {
    it('answers the progressive search with the catalog it was given, then completes', async () => {
        const frames = [];

        for await (const frame of makeQuietFoodClient([OLIVE_OIL]).searchProgressive('oil')) {
            frames.push(frame);
        }

        expect(frames.map((frame) => frame.type)).toStrictEqual(['database', 'complete']);
        expect(frames[0]).toMatchObject({ catalog: { outcome: 'answered', results: [OLIVE_OIL] } });
    });

    it('lists no sources, and answers any other read as an unknown food', async () => {
        const client = makeQuietFoodClient();

        await expect(client.listSources()).resolves.toStrictEqual({ sources: [] });
        expect(isNotFoundError(await client.getById('food_1').catch((error: unknown) => error))).toBe(true);
    });
});

describe('guardedFoodClient', () => {
    it('refuses every request, so a read a test did not stub fails loudly', async () => {
        expect(
            isFetchUnavailableError(
                await guardedFoodClient()
                    .listSources()
                    .catch((error: unknown) => error),
            ),
        ).toBe(true);
    });
});

describe('withFoodClient and renderWithFoodClient', () => {
    it('withFoodClient mounts the given client for a signed-in cook', () => {
        const client = makeQuietFoodClient();
        let mounted: FoodServiceClient | undefined;

        render(
            withFoodClient(
                <Probe
                    onClient={(seen) => {
                        mounted = seen;
                    }}
                />,
                client,
            ),
        );

        expect(mounted).toBe(client);
        expect(screen.getByText(/^cook:user_/u)).toBeTruthy();
    });

    it('renderWithFoodClient mounts the given client under a query client', () => {
        const client = guardedFoodClient();
        let mounted: FoodServiceClient | undefined;

        renderWithFoodClient(
            <Probe
                onClient={(seen) => {
                    mounted = seen;
                }}
            />,
            client,
        );

        expect(mounted).toBe(client);
    });
});
