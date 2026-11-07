/**
 * Tests for {@link useRecipeNutritionBatches} — the deferred calorie lookup's one read seam (ADR-0079 §6).
 *
 * REWRITTEN for ADR-0079. The hook used to hand each card a PROMISE for a Suspense boundary to `use()`, and these tests
 * pinned that promise's identity. A suspending slot held every deferred update on its screen behind the lookup, so the
 * hook now subscribes with `useQueries` and hands each card a READING — `pending`, `failed` or `settled` — as a value.
 * What these tests pin:
 *
 *  1. **The mapping from query state to reading.** Data present is `settled`, even while a background refetch runs
 *     (no skeleton flashes back over a figure) and even after a later refetch FAILED (a figure is not withdrawn for a
 *     transient blip). An error with no data is `failed`, never a skeleton that waits forever. Anything else is
 *     `pending`.
 *  2. **One request per page, N cards.** A page of N recipes is ONE read; pages are batched SEPARATELY, so a later page
 *     never disturbs an earlier one's reading.
 *  3. **A stable lookup.** Hosts memoize their render prop on the lookup, so an equal set of pages must hand back the
 *     SAME function, or every card re-renders on every host render.
 *  4. **No request that must fail.** The service rejects an empty id list, so no page and an empty page fire nothing.
 *  5. **A failed batch is not an unhandled rejection.**
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FC, ReactElement, ReactNode } from 'react';

import { RecipeServiceProvider, recipeServiceKeys } from '@kitchensink/recipe-service-client/hooks';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { MAX_NUTRITION_RECIPE_IDS, type RecipeNutritionResponse } from '@kitchensink/schema-recipe';

import type { RecipeNutritionBatchReading } from '../../nutrition/model.js';
import {
    toRecipeNutritionPages,
    useRecipeNutritionBatches,
    type RecipeNutritionLookup,
} from '../useRecipeNutritionBatches.js';

const PAGE_ONE = ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'];
const PAGE_TWO = ['00000000-0000-4000-8000-00000000000c'];
const FIRST = PAGE_ONE[0] ?? '';

/** A response carrying a figure for every id asked about. */
const respond = (recipeIds: readonly string[], caloriesPerServing = 420): RecipeNutritionResponse => ({
    nutrition: Object.fromEntries(
        recipeIds.map((id) => [
            id,
            {
                state: 'known',
                caloriesPerServing,
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
): RecipeServiceClient & { getRecipeNutrition: ReturnType<typeof vi.fn> } {
    return { getRecipeNutrition: vi.fn(getRecipeNutrition) } as unknown as RecipeServiceClient & {
        getRecipeNutrition: ReturnType<typeof vi.fn>;
    };
}

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((settle, fail) => {
        resolve = settle;
        reject = fail;
    });

    return { promise, resolve, reject };
}

let queryClient: QueryClient;

beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

/** A host that records the lookup it was handed on every render. */
function recordingHost(): {
    Host: FC<{ readonly pages: readonly (readonly string[])[]; readonly tick?: number }>;
    lookups: RecipeNutritionLookup[];
    latest: () => RecipeNutritionLookup;
} {
    const lookups: RecipeNutritionLookup[] = [];

    const Host: FC<{ readonly pages: readonly (readonly string[])[]; readonly tick?: number }> = ({ pages, tick }) => {
        lookups.push(useRecipeNutritionBatches(pages));

        return <span>{tick ?? 0}</span>;
    };

    return {
        Host,
        lookups,
        latest: () => {
            const last = lookups.at(-1);

            if (last === undefined) {
                throw new Error('the host never rendered');
            }

            return last;
        },
    };
}

/** Let the query cache settle what it is doing, inside `act`. */
async function flush(): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

/** Wait until the page's query reaches `status`, through the read seam's own retry and its backoff. */
async function waitForStatus(page: readonly string[], status: 'success' | 'error'): Promise<void> {
    await vi.waitFor(
        () => {
            expect(queryClient.getQueryState(recipeServiceKeys.recipeNutrition(page))?.status).toBe(status);
        },
        { timeout: 5_000 },
    );
    await flush();
}

describe('useRecipeNutritionBatches — the reading each card is handed', () => {
    it('is PENDING while the batch is in flight', () => {
        const client = makeClient(() => new Promise<RecipeNutritionResponse>(() => undefined));
        const { Host, latest } = recordingHost();

        render(wrap(client, <Host pages={[PAGE_ONE]} />));

        expect(latest()(FIRST)).toEqual({ status: 'pending' } satisfies RecipeNutritionBatchReading);
        expect(client.getRecipeNutrition).toHaveBeenCalledTimes(1);
    });

    it('is SETTLED with the response once the batch answers', async () => {
        const answer = deferred<RecipeNutritionResponse>();
        const client = makeClient(() => answer.promise);
        const { Host, latest } = recordingHost();

        render(wrap(client, <Host pages={[PAGE_ONE]} />));
        await act(async () => {
            answer.resolve(respond(PAGE_ONE));
        });
        await waitForStatus(PAGE_ONE, 'success');

        expect(latest()(FIRST)).toEqual({ status: 'settled', response: respond(PAGE_ONE) });
    });

    // ⛔ THE INVARIANT: a failure is a terminal reading, never a skeleton that waits forever.
    it('is FAILED once the batch has failed with no answer to fall back on', async () => {
        const client = makeClient(async () => {
            throw new Error('food service unavailable');
        });
        const { Host, latest } = recordingHost();

        render(wrap(client, <Host pages={[PAGE_ONE]} />));
        await waitForStatus(PAGE_ONE, 'error');

        expect(latest()(FIRST)).toEqual({ status: 'failed' });
    });

    // ⛔ A figure on screen is not withdrawn for a transient blip: data that landed stays SETTLED after a failed refetch.
    it('stays SETTLED with the last answer when a later refetch FAILS', async () => {
        let fail = false;
        const client = makeClient(async (ids) => {
            if (fail) {
                throw new Error('food service unavailable');
            }

            return respond(ids);
        });
        const { Host, latest } = recordingHost();

        render(wrap(client, <Host pages={[PAGE_ONE]} />));
        await waitForStatus(PAGE_ONE, 'success');
        fail = true;
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeServiceKeys.recipeNutrition(PAGE_ONE) });
        });
        await waitForStatus(PAGE_ONE, 'error');

        expect(latest()(FIRST)).toEqual({ status: 'settled', response: respond(PAGE_ONE) });
    });

    // ⛔ A background refetch must not flash the skeleton back over a figure.
    it('stays SETTLED, not pending, while a BACKGROUND refetch is in flight', async () => {
        const refetch = deferred<RecipeNutritionResponse>();
        let calls = 0;
        const client = makeClient(async (ids) => {
            calls += 1;

            return calls === 1 ? respond(ids) : refetch.promise;
        });
        const { Host, latest } = recordingHost();

        render(wrap(client, <Host pages={[PAGE_ONE]} />));
        await waitForStatus(PAGE_ONE, 'success');
        await act(async () => {
            void queryClient.refetchQueries({ queryKey: recipeServiceKeys.recipeNutrition(PAGE_ONE) });
        });

        expect(queryClient.getQueryState(recipeServiceKeys.recipeNutrition(PAGE_ONE))?.fetchStatus).toBe('fetching');
        expect(latest()(FIRST)).toEqual({ status: 'settled', response: respond(PAGE_ONE) });

        await act(async () => {
            refetch.resolve(respond(PAGE_ONE, 515));
        });
        await flush();

        expect(latest()(FIRST)).toEqual({ status: 'settled', response: respond(PAGE_ONE, 515) });
    });

    it('is `null` for a recipe no page carries — a host renders nothing, never a skeleton with nothing to settle', () => {
        const client = makeClient(async (ids) => respond(ids));
        const { Host, latest } = recordingHost();

        render(wrap(client, <Host pages={[PAGE_ONE]} />));

        expect(latest()('00000000-0000-4000-8000-0000000000ff')).toBeNull();
    });
});

describe('useRecipeNutritionBatches — one read per page', () => {
    it('fires ONE request for a page of N recipes, and every recipe on it reads that batch', async () => {
        const client = makeClient(async (ids) => respond(ids));
        const { Host, latest } = recordingHost();

        render(wrap(client, <Host pages={[PAGE_ONE]} />));
        await waitForStatus(PAGE_ONE, 'success');

        expect(client.getRecipeNutrition).toHaveBeenCalledTimes(1);
        expect(client.getRecipeNutrition).toHaveBeenCalledWith(PAGE_ONE, expect.anything());
        expect(PAGE_ONE.map((id) => latest()(id))).toEqual(
            PAGE_ONE.map(() => ({ status: 'settled', response: respond(PAGE_ONE) })),
        );
    });

    it('batches each page SEPARATELY: one request per page, with only that page’s ids', () => {
        const client = makeClient(async (ids) => respond(ids));
        const { Host } = recordingHost();

        render(wrap(client, <Host pages={[PAGE_ONE, PAGE_TWO]} />));

        expect(client.getRecipeNutrition).toHaveBeenCalledTimes(2);
        expect(client.getRecipeNutrition).toHaveBeenCalledWith(PAGE_ONE, expect.anything());
        expect(client.getRecipeNutrition).toHaveBeenCalledWith(PAGE_TWO, expect.anything());
    });

    it('reads each recipe out of the page that CARRIES it', async () => {
        const client = makeClient(async (ids) => respond(ids, ids.length === 1 ? 615 : 420));
        const { Host, latest } = recordingHost();

        render(wrap(client, <Host pages={[PAGE_ONE, PAGE_TWO]} />));
        await waitForStatus(PAGE_ONE, 'success');
        await waitForStatus(PAGE_TWO, 'success');

        expect(latest()(FIRST)).toEqual({ status: 'settled', response: respond(PAGE_ONE, 420) });
        expect(latest()(PAGE_TWO[0] ?? '')).toEqual({ status: 'settled', response: respond(PAGE_TWO, 615) });
    });

    // ⛔ The whole reason pages are batched separately rather than re-sent as one growing id set.
    it('leaves page one SETTLED and asks nothing again when page two arrives (no chip falls back to its skeleton)', async () => {
        const client = makeClient(async (ids) => respond(ids));
        const { Host, latest } = recordingHost();

        const view = render(wrap(client, <Host pages={[PAGE_ONE]} />));
        await waitForStatus(PAGE_ONE, 'success');
        view.rerender(wrap(client, <Host pages={[PAGE_ONE, PAGE_TWO]} />));

        expect(latest()(FIRST)).toEqual({ status: 'settled', response: respond(PAGE_ONE) });
        expect(client.getRecipeNutrition).toHaveBeenCalledTimes(2);
        expect(client.getRecipeNutrition).toHaveBeenLastCalledWith(PAGE_TWO, expect.anything());
    });

    it('survives a RE-ORDER of the same ids — one logical read, no second request', async () => {
        const client = makeClient(async (ids) => respond(ids));
        const { Host, latest } = recordingHost();

        const view = render(wrap(client, <Host pages={[PAGE_ONE]} />));
        await waitForStatus(PAGE_ONE, 'success');
        // A sort control re-orders the SAME results. `recipeServiceKeys.recipeNutrition` sorts ids into the key.
        view.rerender(wrap(client, <Host pages={[[...PAGE_ONE].reverse()]} />));

        expect(client.getRecipeNutrition).toHaveBeenCalledTimes(1);
        expect(latest()(FIRST)).toEqual({ status: 'settled', response: respond(PAGE_ONE) });
    });

    // ⛔ Hosts memoize their render prop on the lookup. A new function per render re-renders every card every time.
    it('hands back the SAME lookup across re-renders with equal pages, even when the caller rebuilds the array', async () => {
        const client = makeClient(async (ids) => respond(ids));
        const { Host, lookups } = recordingHost();

        const view = render(wrap(client, <Host pages={[PAGE_ONE]} tick={1} />));
        await waitForStatus(PAGE_ONE, 'success');
        const settledLookup = lookups.at(-1);
        view.rerender(wrap(client, <Host pages={[[...PAGE_ONE]]} tick={2} />));
        view.rerender(wrap(client, <Host pages={[[...PAGE_ONE]]} tick={3} />));

        expect(lookups.at(-1)).toBe(settledLookup);
        expect(lookups.at(-2)).toBe(settledLookup);
    });
});

describe('useRecipeNutritionBatches — a host that remounts while the batch is in flight', () => {
    /**
     * A host can unmount and mount again while its batch is still in flight — Discover's frame moves its results to a
     * new parent the moment `<main>` is first measured, which remounts every rail. TanStack cancels a query whose last
     * observer leaves mid-fetch, IF its request read the query's `signal`, and the next mount then asks again. The batch
     * is one shared, cheap-to-keep answer, so it must survive its observers leaving: ONE request, and the remount reads
     * that request's answer.
     */
    it('⛔ asks ONCE across an unmount and a remount mid-flight, and the remount reads that one answer', async () => {
        const answer = deferred<RecipeNutritionResponse>();
        const client = makeClient(() => answer.promise);
        const { Host, latest } = recordingHost();

        const first = render(wrap(client, <Host pages={[PAGE_ONE]} />));
        expect(latest()(FIRST)).toEqual({ status: 'pending' });
        first.unmount();
        render(wrap(client, <Host pages={[PAGE_ONE]} />));
        await act(async () => {
            answer.resolve(respond(PAGE_ONE));
        });
        await waitForStatus(PAGE_ONE, 'success');

        expect(client.getRecipeNutrition).toHaveBeenCalledTimes(1);
        expect(latest()(FIRST)).toEqual({ status: 'settled', response: respond(PAGE_ONE) });
    });
});

describe('useRecipeNutritionBatches — the cases that must NOT fire a request', () => {
    it('asks about nothing when there are no pages (the service REJECTS an empty id list)', () => {
        const client = makeClient(async (ids) => respond(ids));
        const { Host } = recordingHost();

        render(wrap(client, <Host pages={[]} />));

        expect(client.getRecipeNutrition).not.toHaveBeenCalled();
    });

    it('skips an EMPTY page rather than sending it, and reads the pages around it', () => {
        const client = makeClient(async (ids) => respond(ids));
        const { Host, latest } = recordingHost();

        render(wrap(client, <Host pages={[[], PAGE_ONE]} />));

        expect(client.getRecipeNutrition).toHaveBeenCalledTimes(1);
        expect(client.getRecipeNutrition).toHaveBeenCalledWith(PAGE_ONE, expect.anything());
        expect(latest()(FIRST)).toEqual({ status: 'pending' });
    });
});

describe('useRecipeNutritionBatches — failure', () => {
    it('⛔ does not raise an UNHANDLED rejection when the batch fails', async () => {
        const client = makeClient(async () => {
            throw new Error('food service unavailable');
        });
        const unhandled: unknown[] = [];

        const record = (reason: unknown): void => {
            unhandled.push(reason);
        };

        process.on('unhandledRejection', record);
        const { Host } = recordingHost();

        try {
            render(wrap(client, <Host pages={[PAGE_ONE]} />));
            await waitForStatus(PAGE_ONE, 'error');
            // Let Node reach the microtask checkpoint where it decides a rejection went unhandled.
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));
        } finally {
            process.off('unhandledRejection', record);
        }

        expect(unhandled).toEqual([]);
    });

    it('RECOVERS: a failed page reads SETTLED once a refetch answers', async () => {
        let fail = true;
        const client = makeClient(async (ids) => {
            if (fail) {
                throw new Error('food service unavailable');
            }

            return respond(ids);
        });
        const { Host, latest } = recordingHost();

        render(wrap(client, <Host pages={[PAGE_ONE]} />));
        await waitForStatus(PAGE_ONE, 'error');
        expect(latest()(FIRST)).toEqual({ status: 'failed' });

        fail = false;
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: recipeServiceKeys.recipeNutrition(PAGE_ONE) });
        });
        await waitForStatus(PAGE_ONE, 'success');

        expect(latest()(FIRST)).toEqual({ status: 'settled', response: respond(PAGE_ONE) });
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
