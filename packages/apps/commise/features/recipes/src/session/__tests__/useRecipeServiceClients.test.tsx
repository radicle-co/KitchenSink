/**
 * The recipe and food clients both apps build for the signed-in cook (UI audit 2: `RecipeProviders` and
 * `RecipeServiceGate` each built them; the two disagreed about a missing token).
 *
 * What is pinned, from the policy rather than from either app:
 *
 * - ⛔ A session that yields no token sends NOTHING. An empty `Bearer ` header is a guaranteed `401` (measured in
 *   production 2026-08-07), so "not ready" is a typed error the token proxy wraps in `TokenMintFailedError`, which the
 *   outbox parks as "no credential yet" and the query retry outlasts. Web threw it; mobile used to send the empty
 *   bearer. Each of `null`, `''` and `undefined` is "no token".
 * - A client belongs to the cook it was built for (ADR-0054): the same clients across a re-render, new ones for another
 *   cook, and a request minted only while that cook's session is the live one.
 * - `forceRefresh` reaches the mint on the client's 401 retry, so the replay is not served from a cache.
 *
 * App tests keep their own cases for what stays app-side: the SDK, the template, the origins and the provider order.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    isSessionSubjectChangedError,
    isTokenMintFailedError,
    type TokenMintFailedError,
} from '@commise/features-account';

import { isRecipeAuthNotReadyError } from '../recipeAuthNotReady.js';
import { useRecipeServiceClients } from '../useRecipeServiceClients.js';

const RECIPE_URL = 'https://recipe.test.invalid';
const FOOD_URL = 'https://food.test.invalid';

/** The identity client's live session, which the token proxy reads on every mint. */
const clerk: { session: { readonly user: { readonly id: string } } | null } = { session: null };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    clerk.session = { user: { id: 'user_a' } };
    fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/** Mount the hook for `userId` over `mint`, with the shared identity client. */
function mount(userId: string | undefined, mint: (forceRefresh: boolean) => Promise<string | null | undefined>) {
    return renderHook(
        (props: { userId: string | undefined }) =>
            useRecipeServiceClients({
                userId: props.userId,
                clerk,
                mint,
                recipeBaseUrl: RECIPE_URL,
                foodBaseUrl: FOOD_URL,
            }),
        { initialProps: { userId } },
    );
}

/** The URL and bearer of the Nth API request, leaving out the once-per-origin `/health` contract-skew probe. */
function requestAt(index: number): { readonly url: string; readonly authorization: string | null } {
    const requests = fetchMock.mock.calls
        .map(([input, init]) => ({ input: input as Request | string, init: init as RequestInit | undefined }))
        .map(({ input, init }) =>
            typeof input === 'string'
                ? { url: input, authorization: new Headers(init?.headers).get('authorization') }
                : { url: input.url, authorization: input.headers.get('authorization') },
        )
        .filter((request) => !request.url.endsWith('/health'));

    return requests[index] ?? { url: '(no such request)', authorization: null };
}

describe('useRecipeServiceClients', () => {
    it('sends each client to its own origin with the minted bearer', async () => {
        const { result } = mount('user_a', async () => 'tok');

        await result.current.recipe.listRecipes().catch(() => undefined);
        await result.current.food.getById('food_1').catch(() => undefined);

        expect(requestAt(0).url.startsWith(`${RECIPE_URL}/`)).toBe(true);
        expect(requestAt(0).authorization).toBe('Bearer tok');
        expect(requestAt(1).url).toBe(`${FOOD_URL}/api/v1/foods/food_1`);
        expect(requestAt(1).authorization).toBe('Bearer tok');
    });

    it.each([
        ['null', null],
        ['an empty string', ''],
        ['undefined', undefined],
    ])('⛔ sends nothing, and never an empty bearer, when the mint yields %s', async (_case, minted) => {
        const { result } = mount('user_a', async () => minted);

        const outcomes = await Promise.all([
            result.current.recipe.listRecipes().then(
                () => undefined,
                (error: unknown) => error,
            ),
            result.current.food.getById('food_1').then(
                () => undefined,
                (error: unknown) => error,
            ),
        ]);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(outcomes.every(isTokenMintFailedError)).toBe(true);
        expect(outcomes.every((outcome) => isRecipeAuthNotReadyError((outcome as TokenMintFailedError).cause))).toBe(
            true,
        );
    });

    it('keeps a rejected mint distinguishable from "not ready": the cause is the mint’s own error', async () => {
        const failure = new Error('Network request failed');
        const { result } = mount('user_a', async () => {
            throw failure;
        });

        const outcome = await result.current.recipe.listRecipes().then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isTokenMintFailedError(outcome)).toBe(true);
        expect((outcome as TokenMintFailedError).cause).toBe(failure);
    });

    it('asks the mint to skip its cache on the 401 retry, and not before', async () => {
        const mint = vi.fn(async () => 'tok');
        fetchMock
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'expired' }), { status: 401 }),
            )
            .mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }));
        const { result } = mount('user_a', mint);

        await result.current.food.getById('food_1').catch(() => undefined);

        expect(mint).toHaveBeenNthCalledWith(1, false);
        expect(mint).toHaveBeenNthCalledWith(2, true);
    });

    it('keeps the same clients for the same cook and builds new ones for another', () => {
        const mint = async () => 'tok';
        const { result, rerender } = mount('user_a', mint);
        const first = result.current;

        rerender({ userId: 'user_a' });
        expect(result.current).toBe(first);

        rerender({ userId: 'user_b' });
        expect(result.current.recipe).not.toBe(first.recipe);
        expect(result.current.food).not.toBe(first.food);
    });

    it('refuses cook A’s request once the live session is another cook’s, and sends nothing', async () => {
        const { result } = mount('user_a', async () => 'tok');
        clerk.session = { user: { id: 'user_b' } };

        const outcome = await result.current.recipe.listRecipes().then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isSessionSubjectChangedError(outcome)).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
