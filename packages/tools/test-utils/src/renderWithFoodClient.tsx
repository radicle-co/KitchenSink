import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

import { FoodServiceClient, type CatalogSearchResultView } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';

import { makeTestQueryClient } from './testQueryClient.js';

/** The cook a test's food client is mounted for: the apps mount one only for a signed-in cook. */
const TEST_COOK = 'user_1';

/** The origin the test food clients name; nothing listens there. */
const TEST_FOOD_ORIGIN = 'https://food.test';

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An NDJSON body of `frames`, one per line, as food streams the progressive search. */
const ndjson = (...frames: readonly unknown[]): Response =>
    new Response(frames.map((frame) => `${JSON.stringify(frame)}\n`).join(''), {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
    });

/**
 * A food client whose progressive search finds `catalog` among the catalog's foods, whatever the text, none of the
 * cook's own, and no remote food; whose source register is empty; and which answers anything else `404`. The search is
 * the progressive one (ADR-0055 point 9), answered in one body: the database frame, then `complete`.
 *
 * @param catalog - The catalog's results; none by default.
 * @returns The client.
 */
export function makeQuietFoodClient(catalog: readonly CatalogSearchResultView[] = []): FoodServiceClient {
    return new FoodServiceClient({
        baseUrl: TEST_FOOD_ORIGIN,
        fetch: (input) => {
            const url = new URL(input instanceof Request ? input.url : String(input));

            if (url.pathname.endsWith('/search/progressive')) {
                return Promise.resolve(
                    ndjson(
                        {
                            type: 'database',
                            authored: { outcome: 'answered', results: [] },
                            catalog: { outcome: 'answered', results: catalog },
                        },
                        { type: 'complete' },
                    ),
                );
            }

            return Promise.resolve(
                url.pathname.endsWith('/foods/sources')
                    ? json({ sources: [] })
                    : json({ code: 'FOOD_NOT_FOUND', message: 'no such food', details: {} }, 404),
            );
        },
    });
}

/**
 * A food client whose network is refused, so a read the test did not stub fails loudly.
 *
 * @returns The client.
 */
export function guardedFoodClient(): FoodServiceClient {
    return new FoodServiceClient({
        baseUrl: TEST_FOOD_ORIGIN,
        fetch: () => Promise.reject(new Error('unstubbed network call')),
    });
}

/**
 * `ui` under a food client, as the apps' providers mount one for the signed-in cook (plan 002 S5). For a test that
 * renders through another helper, such as `renderWithRecipeClient`, which mounts the query client: wrap the element it
 * renders, and its `rerender` element too.
 *
 * @param ui - The element under test.
 * @param client - The food client; one whose searches find nothing by default.
 * @returns The wrapped element.
 */
export function withFoodClient(ui: ReactElement, client: FoodServiceClient = makeQuietFoodClient()): ReactElement {
    return (
        <FoodServiceProvider client={client} subject={TEST_COOK}>
            {ui}
        </FoodServiceProvider>
    );
}

/**
 * Render `element` under a fresh, retry-free query client and `client`, for a screen that reads only food.
 *
 * @param element - The screen.
 * @param client - The food client the screen reads from.
 * @returns RTL's own `render` result.
 * @sideEffect Mounts a React tree in the document.
 */
export function renderWithFoodClient(element: ReactElement, client: FoodServiceClient): RenderResult {
    return render(
        <QueryClientProvider client={makeTestQueryClient()}>{withFoodClient(element, client)}</QueryClientProvider>,
    );
}
