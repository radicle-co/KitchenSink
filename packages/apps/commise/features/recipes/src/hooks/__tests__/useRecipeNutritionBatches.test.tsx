/**
 * Tests for {@link useRecipeNutritionBatches} — the RENDER-AS-YOU-FETCH seam for the deferred calorie
 * lookup (ADR-0021 §6). Written test-first, against a hook that did not exist.
 *
 * The hook's whole job is timing and IDENTITY, so that is what these tests pin:
 *
 *  1. **The request is in flight BEFORE the cards render.** ADR-0021 §6 says mobile "calls `ensureQueryData`
 *     the moment the ids are known … so render finds an in-flight query". The assertion is therefore made
 *     from INSIDE a child's render pass, reading the query cache's `fetchStatus`. An effect-based
 *     implementation (`useEffect(() => { void ensureQueryData(...) })`) fails it, because effects run after
 *     the render pass — which is exactly the fetch-on-render shape this phase exists to avoid.
 *  2. **One promise, N boundaries.** N cards over one page must cost ONE request.
 *  3. **The promise IDENTITY is stable across re-renders.** This is not tidiness: `queryClient.ensureQueryData`
 *     returns `Promise.resolve(cachedData)` — a BRAND NEW promise — on every call once the data is cached
 *     (query-core `queryClient.js`). Handing `use()` a new promise every render re-suspends the card forever,
 *     so the memo is the mechanism, not an optimization.
 *  4. **A later page does not disturb an earlier one.** Pages are batched SEPARATELY (see the hook's
 *     docblock): an infinite list that re-batched every accumulated id would mint a new promise on every
 *     "load more", and every already-resolved chip on screen would fall back to its skeleton.
 *  5. **An empty group fires nothing.** The service REJECTS an empty id list, and `ensureQueryData` does not
 *     honour the factory's `enabled` gate (that is a hook-level option), so the skip has to live here.
 *  6. **A failed batch does not surface as an unhandled rejection.** The error boundary owns the failure; a
 *     promise nobody has attached to yet must not take the process down first.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FC, ReactElement, ReactNode } from 'react';

import { RecipeServiceProvider, recipeServiceKeys } from '@kitchensink/recipe-service-client/hooks';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { MAX_NUTRITION_RECIPE_IDS, type RecipeNutritionResponse } from '@kitchensink/schema-recipe';

import { toRecipeNutritionPages, useRecipeNutritionBatches } from '../useRecipeNutritionBatches.js';

const PAGE_ONE = ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'];
const PAGE_TWO = ['00000000-0000-4000-8000-00000000000c'];

/** A response carrying a figure for every id asked about. */
const respond = (recipeIds: readonly string[]): RecipeNutritionResponse => ({
    nutrition: Object.fromEntries(
        recipeIds.map((id) => [
            id,
            {
                state: 'known',
                caloriesPerServing: 420,
                proteinG: 1,
                carbsG: 2,
                fatG: 3,
                isComplete: true,
                freshness: 'fresh',
            },
        ]),
    ),
});

/** A client double narrowed to the ONE method this seam calls. */
function makeClient(
    getRecipeNutrition: (recipeIds: readonly string[]) => Promise<RecipeNutritionResponse>,
): RecipeServiceClient {
    return { getRecipeNutrition: vi.fn(getRecipeNutrition) } as unknown as RecipeServiceClient;
}

let queryClient: QueryClient;

beforeEach(() => {
    queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
});

afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
});

const wrap = (client: RecipeServiceClient, ui: ReactNode): ReactElement => (
    <QueryClientProvider client={queryClient}>
        <RecipeServiceProvider client={client}>{ui}</RecipeServiceProvider>
    </QueryClientProvider>
);

describe('useRecipeNutritionBatches — render-as-you-fetch', () => {
    it('⛔ has the request IN FLIGHT while the first card renders — not after an effect', () => {
        const client = makeClient(async (ids) => respond(ids));
        // Recorded from inside the CHILD's render pass. An effect-based implementation records `undefined`
        // (no query built yet), which is the fetch-on-render failure this phase exists to remove.
        let statusDuringChildRender: string | undefined;

        const Card: FC = () => {
            statusDuringChildRender = queryClient.getQueryState(
                recipeServiceKeys.recipeNutrition(PAGE_ONE),
            )?.fetchStatus;

            return <span>card</span>;
        };

        const Host: FC = () => {
            useRecipeNutritionBatches([PAGE_ONE]);

            return <Card />;
        };

        render(wrap(client, <Host />));

        expect(screen.getByText('card')).toBeTruthy();
        expect(statusDuringChildRender).toBe('fetching');
    });

    it('fires ONE request for a page of N recipes', () => {
        const client = makeClient(async (ids) => respond(ids));

        const Host: FC = () => {
            const lookup = useRecipeNutritionBatches([PAGE_ONE]);

            return (
                <>
                    {PAGE_ONE.map((id) => (
                        <span key={id}>{lookup(id) === null ? 'none' : 'promised'}</span>
                    ))}
                </>
            );
        };

        render(wrap(client, <Host />));

        expect(client.getRecipeNutrition).toHaveBeenCalledTimes(1);
        expect(client.getRecipeNutrition).toHaveBeenCalledWith(PAGE_ONE, expect.anything());
        expect(screen.getAllByText('promised')).toHaveLength(PAGE_ONE.length);
    });

    it('hands every recipe on the page the SAME promise object (one lookup, N boundaries)', () => {
        const client = makeClient(async (ids) => respond(ids));
        const seen: (Promise<RecipeNutritionResponse> | null)[] = [];

        const Host: FC = () => {
            const lookup = useRecipeNutritionBatches([PAGE_ONE]);
            seen.push(...PAGE_ONE.map((id) => lookup(id)));

            return <span>host</span>;
        };

        render(wrap(client, <Host />));

        expect(seen[0]).not.toBeNull();
        expect(seen[1]).toBe(seen[0]);
    });

    it('⛔ keeps the promise IDENTITY stable across re-renders (a new one re-suspends the card forever)', async () => {
        const client = makeClient(async (ids) => respond(ids));
        const seen: (Promise<RecipeNutritionResponse> | null)[] = [];

        const Host: FC<{ readonly tick: number }> = ({ tick }) => {
            seen.push(useRecipeNutritionBatches([PAGE_ONE])(PAGE_ONE[0] ?? ''));

            return <span>{tick}</span>;
        };

        const view = render(wrap(client, <Host tick={1} />));
        // Let the fetch settle: past this point `ensureQueryData` answers from cache with a FRESH
        // `Promise.resolve(...)` every call, which is precisely when an unmemoized hook starts churning.
        await seen[0];
        view.rerender(wrap(client, <Host tick={2} />));

        expect(seen).toHaveLength(2);
        expect(seen[1]).toBe(seen[0]);
    });

    it('⛔ does not re-enter the query cache on a re-render (a stale query would re-fetch on every one)', async () => {
        const client = makeClient(async (ids) => respond(ids));
        const ensureQueryData = vi.spyOn(queryClient, 'ensureQueryData');

        const Host: FC<{ readonly tick: number }> = ({ tick }) => {
            useRecipeNutritionBatches([PAGE_ONE]);

            return <span>{tick}</span>;
        };

        const view = render(wrap(client, <Host tick={1} />));
        await queryClient.getQueryCache().find({ queryKey: recipeServiceKeys.recipeNutrition(PAGE_ONE) })?.promise;
        view.rerender(wrap(client, <Host tick={2} />));
        view.rerender(wrap(client, <Host tick={3} />));

        // Identity survives an unmemoized call (it comes from `Query.promise`), so this is the OTHER half of
        // the memo's job: `ensureQueryData` re-fetches a query it finds stale, so calling it once per render
        // turns every render past the 2-minute staleTime into a fresh request — and each response re-renders.
        expect(ensureQueryData).toHaveBeenCalledTimes(1);
    });

    it('⛔ survives a RE-ORDER of the same ids — the read is one logical read, so the promise must not churn', () => {
        const client = makeClient(async (ids) => respond(ids));
        const seen: (Promise<RecipeNutritionResponse> | null)[] = [];

        const Host: FC<{ readonly ids: readonly string[] }> = ({ ids }) => {
            seen.push(useRecipeNutritionBatches([ids])(PAGE_ONE[0] ?? ''));

            return <span>host</span>;
        };

        const view = render(wrap(client, <Host ids={PAGE_ONE} />));
        // The discovery sort control re-orders the SAME results. `recipeServiceKeys.recipeNutrition` sorts
        // ids into the key, so this is the same query — and a hook that keyed on raw order would mint a new
        // promise here and blink every chip back to its skeleton for a re-sort that fetched nothing.
        view.rerender(wrap(client, <Host ids={[...PAGE_ONE].reverse()} />));

        expect(seen[1]).toBe(seen[0]);
        expect(client.getRecipeNutrition).toHaveBeenCalledTimes(1);
    });

    it('mints a NEW promise when the page of ids changes (the retry / new-data signal)', () => {
        const client = makeClient(async (ids) => respond(ids));
        const seen: (Promise<RecipeNutritionResponse> | null)[] = [];

        const Host: FC<{ readonly ids: readonly string[] }> = ({ ids }) => {
            seen.push(useRecipeNutritionBatches([ids])(ids[0] ?? ''));

            return <span>host</span>;
        };

        const view = render(wrap(client, <Host ids={PAGE_ONE} />));
        view.rerender(wrap(client, <Host ids={[...PAGE_ONE, ...PAGE_TWO]} />));

        expect(seen[1]).not.toBe(seen[0]);
        expect(client.getRecipeNutrition).toHaveBeenCalledTimes(2);
    });
});

describe('useRecipeNutritionBatches — paging', () => {
    it('batches each page SEPARATELY: one request per page, with only that page’s ids', () => {
        const client = makeClient(async (ids) => respond(ids));

        const Host: FC = () => {
            useRecipeNutritionBatches([PAGE_ONE, PAGE_TWO]);

            return <span>host</span>;
        };

        render(wrap(client, <Host />));

        expect(client.getRecipeNutrition).toHaveBeenCalledTimes(2);
        expect(client.getRecipeNutrition).toHaveBeenNthCalledWith(1, PAGE_ONE, expect.anything());
        expect(client.getRecipeNutrition).toHaveBeenNthCalledWith(2, PAGE_TWO, expect.anything());
    });

    it('⛔ leaves page one’s promise UNTOUCHED when page two arrives (no chip falls back to its skeleton)', () => {
        const client = makeClient(async (ids) => respond(ids));
        const seen: (Promise<RecipeNutritionResponse> | null)[] = [];

        const Host: FC<{ readonly pages: readonly (readonly string[])[] }> = ({ pages }) => {
            seen.push(useRecipeNutritionBatches(pages)(PAGE_ONE[0] ?? ''));

            return <span>host</span>;
        };

        const view = render(wrap(client, <Host pages={[PAGE_ONE]} />));
        view.rerender(wrap(client, <Host pages={[PAGE_ONE, PAGE_TWO]} />));

        // The whole reason pages are batched separately rather than re-sent as one growing id set.
        expect(seen[1]).toBe(seen[0]);
    });

    it('resolves a recipe to the promise of the page that CARRIES it', () => {
        const client = makeClient(async (ids) => respond(ids));
        const seen: (Promise<RecipeNutritionResponse> | null)[] = [];

        const Host: FC = () => {
            const lookup = useRecipeNutritionBatches([PAGE_ONE, PAGE_TWO]);
            seen.push(lookup(PAGE_ONE[0] ?? ''), lookup(PAGE_TWO[0] ?? ''));

            return <span>host</span>;
        };

        render(wrap(client, <Host />));

        expect(seen[0]).not.toBeNull();
        expect(seen[1]).not.toBeNull();
        expect(seen[1]).not.toBe(seen[0]);
    });
});

describe('useRecipeNutritionBatches — the cases that must NOT fire a request', () => {
    it('asks about nothing when there are no pages (the service REJECTS an empty id list)', () => {
        const client = makeClient(async (ids) => respond(ids));

        const Host: FC = () => {
            useRecipeNutritionBatches([]);

            return <span>host</span>;
        };

        render(wrap(client, <Host />));

        expect(client.getRecipeNutrition).not.toHaveBeenCalled();
    });

    it('skips an EMPTY page rather than sending it (`enabled` is a hook option; ensureQueryData ignores it)', () => {
        const client = makeClient(async (ids) => respond(ids));

        const Host: FC = () => {
            useRecipeNutritionBatches([[], PAGE_ONE]);

            return <span>host</span>;
        };

        render(wrap(client, <Host />));

        expect(client.getRecipeNutrition).toHaveBeenCalledTimes(1);
        expect(client.getRecipeNutrition).toHaveBeenCalledWith(PAGE_ONE, expect.anything());
    });

    it('returns `null` for a recipe no page carries — a host must branch, never suspend on nothing', () => {
        const client = makeClient(async (ids) => respond(ids));
        let lookedUp: Promise<RecipeNutritionResponse> | null = null;

        const Host: FC = () => {
            lookedUp = useRecipeNutritionBatches([PAGE_ONE])('00000000-0000-4000-8000-0000000000ff');

            return <span>host</span>;
        };

        render(wrap(client, <Host />));

        expect(lookedUp).toBeNull();
    });
});

describe('useRecipeNutritionBatches — failure', () => {
    it('⛔ does not raise an UNHANDLED rejection when the batch fails (the boundary owns the failure)', async () => {
        const client = makeClient(async () => {
            throw new Error('food service unavailable');
        });
        const unhandled: unknown[] = [];

        const record = (reason: unknown): void => {
            unhandled.push(reason);
        };

        process.on('unhandledRejection', record);

        const Host: FC = () => {
            useRecipeNutritionBatches([PAGE_ONE]);

            return <span>host</span>;
        };

        try {
            render(wrap(client, <Host />));
            // Wait for the query to actually FAIL — through the read seam's one retry and its backoff, which
            // is why a couple of macrotasks is not enough (an earlier draft of this test asserted against a
            // promise that had not rejected yet, and passed for that reason). Observed through the CACHE, not
            // by awaiting the promise: awaiting it would attach the very handler whose absence is under test.
            await vi.waitFor(
                () => {
                    expect(queryClient.getQueryState(recipeServiceKeys.recipeNutrition(PAGE_ONE))?.status).toBe(
                        'error',
                    );
                },
                { timeout: 5_000 },
            );
            // Then let Node reach the microtask checkpoint where it decides a rejection went unhandled.
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));
        } finally {
            process.off('unhandledRejection', record);
        }

        expect(unhandled).toEqual([]);
    });

    it('still hands the card a promise when the batch fails — the boundary turns it into a blank slot', async () => {
        const client = makeClient(async () => {
            throw new Error('food service unavailable');
        });
        let promise: Promise<RecipeNutritionResponse> | null = null;

        const Host: FC = () => {
            promise = useRecipeNutritionBatches([PAGE_ONE])(PAGE_ONE[0] ?? '');

            return <span>host</span>;
        };

        render(wrap(client, <Host />));

        expect(promise).not.toBeNull();
        await expect(promise).rejects.toThrow('food service unavailable');
    });
});

/**
 * `toRecipeNutritionPages` — the entry point for a surface whose recipes did NOT arrive in pages (a
 * collection's member list). The published cap is the caller's problem: over it the request schema refuses
 * the call before the round trip, so an un-chunked 501-member collection would render EVERY member's figure
 * blank rather than the 501st's.
 */
describe('toRecipeNutritionPages', () => {
    it('asks about nothing for an empty list', () => {
        expect(toRecipeNutritionPages([])).toEqual([]);
    });

    it('keeps a list inside the cap as ONE page (one request, one promise, one settle)', () => {
        expect(toRecipeNutritionPages(PAGE_ONE)).toEqual([PAGE_ONE]);
    });

    it('⛔ CHUNKS at the published cap rather than truncating — a long collection loses no figures', () => {
        const ids = Array.from({ length: MAX_NUTRITION_RECIPE_IDS + 1 }, (_unused, index) => `recipe-${index}`);

        const pages = toRecipeNutritionPages(ids);

        expect(pages).toHaveLength(2);
        expect(pages[0]).toHaveLength(MAX_NUTRITION_RECIPE_IDS);
        expect(pages[1]).toHaveLength(1);
        // The whole point: every id the caller asked about is still in there, in order.
        expect(pages.flat()).toEqual(ids);
    });
});
