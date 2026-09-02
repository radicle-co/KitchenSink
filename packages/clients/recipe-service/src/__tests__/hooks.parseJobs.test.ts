// @vitest-environment jsdom
/**
 * The parse-job HOOKS' contract: the call they drive, the cache they write, and — the part with the worst
 * production failure mode — the cache they must NOT touch.
 *
 * ## ⛔ Write-through, not invalidate (DA3, the `useUpdateRecipe` precedent)
 *
 * All three mutations answer the FULL, freshly-persisted `ParseJobResponse` — the same shape the poll
 * reads. Invalidating `parseJob(id)` instead would throw that response away and force a round-trip for
 * data the client is already holding, and on the create path there is nothing to invalidate at all: the
 * job did not exist a moment ago, so the poll would start from an empty cache and show a spinner over a
 * job whose first view is already in hand.
 *
 * ## ⛔ And they stale NOTHING ELSE — R19 is the reason, not an omission
 *
 * "A parse binds nothing": the reviewed draft goes through the ordinary `POST /api/v1/recipes`, which
 * re-validates every food id. So a parse job creates no recipe, joins no collection, and changes no search
 * row — and a hook that staled `recipes`/`collections`/`recipeSearches` here would refetch a cook's whole
 * library on every keystroke-driven line edit. The seeded probes make over-invalidation fail, not just
 * under-invalidation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, waitFor } from '@testing-library/react';

import type { RecipeServiceClient } from '../client.js';
import { NotFoundError, ParseJobExpiredError } from '../errors.js';
import { recipeServiceKeys, useCreateParseJob, useEditParseJobLine, useParseJob, useRetryParseJob } from '../hooks.js';
import {
    FIXTURE_OTHER_PARSE_JOB_UUID,
    FIXTURE_PARSE_JOB_UUID,
    makeCompleteParseJob,
    makeParseJob,
    makeParseJobLine,
} from '../__fixtures__/parseJobs.js';
import { invalidatedProbes, seedCacheProbes } from './utils/cacheProbes.js';
import { makeGuardedClient, makeTestQueryClient, renderRecipeHook } from './utils/hookHarness.js';

/**
 * Render a hook against a fresh guarded client + a cache seeded with one probe per key region.
 *
 * ⚠️ `prepare` runs BEFORE the render, and for a QUERY hook that ordering is load-bearing: a query fires on
 * mount, so a spy installed after `renderRecipeHook` returns loses the race and the hook resolves against
 * the network guard instead. Mutations do not care (nothing runs until `mutate`), but one helper that is
 * correct for both is better than two that differ by a subtlety.
 */
function renderParseHook<TResult>(
    hook: () => TResult,
    prepare: (client: RecipeServiceClient) => void = () => undefined,
) {
    const client = makeGuardedClient();
    const queryClient = makeTestQueryClient();
    seedCacheProbes(queryClient);
    prepare(client);
    const harness = renderRecipeHook(hook, { client, queryClient });

    return { ...harness, probes: () => invalidatedProbes(queryClient) };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useParseJob', () => {
    it('reads the job through the client and caches it under its own key', async () => {
        const job = makeCompleteParseJob();
        const getParseJob = vi.fn().mockResolvedValue(job);
        const { result, queryClient } = renderParseHook(
            () => useParseJob(FIXTURE_PARSE_JOB_UUID),
            (client) => void vi.spyOn(client, 'getParseJob').mockImplementation(getParseJob),
        );

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(getParseJob).toHaveBeenCalledWith(FIXTURE_PARSE_JOB_UUID);
        expect(queryClient.getQueryData(recipeServiceKeys.parseJob(FIXTURE_PARSE_JOB_UUID))).toEqual(job);
    });

    it('does not fetch for an empty id — there is no job to poll before one is created', async () => {
        const getParseJob = vi.fn();
        const { result } = renderParseHook(
            () => useParseJob(''),
            (client) => void vi.spyOn(client, 'getParseJob').mockImplementation(getParseJob),
        );

        await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));

        expect(getParseJob).not.toHaveBeenCalled();
        expect(result.current.data).toBeUndefined();
    });

    it('honours an explicit enable gate even for a real id', async () => {
        const getParseJob = vi.fn();
        const { result } = renderParseHook(
            () => useParseJob(FIXTURE_PARSE_JOB_UUID, { enabled: false }),
            (client) => void vi.spyOn(client, 'getParseJob').mockImplementation(getParseJob),
        );

        await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));

        expect(getParseJob).not.toHaveBeenCalled();
    });

    it('surfaces a 404 for a stranger or an absent job', async () => {
        const { result } = renderParseHook(
            () => useParseJob(FIXTURE_PARSE_JOB_UUID),
            (client) =>
                void vi
                    .spyOn(client, 'getParseJob')
                    .mockRejectedValue(new NotFoundError('gone', 'PARSE_JOB_NOT_FOUND')),
        );

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBeInstanceOf(NotFoundError);
    });
});

describe('useCreateParseJob', () => {
    it('creates the job through the client and returns the accepted view', async () => {
        const job = makeParseJob();
        const { result, client } = renderParseHook(() => useCreateParseJob());
        const createParseJob = vi.spyOn(client, 'createParseJob').mockResolvedValue(job);

        act(() => result.current.mutate({ text: '2 cups flour' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(createParseJob).toHaveBeenCalledWith({ text: '2 cups flour' });
        expect(result.current.data).toEqual(job);
    });

    it("writes the accepted job through to ITS OWN key, so the poll starts with the server's first view", async () => {
        const job = makeParseJob();
        const { result, client, queryClient } = renderParseHook(() => useCreateParseJob());
        vi.spyOn(client, 'createParseJob').mockResolvedValue(job);

        act(() => result.current.mutate({ text: '2 cups flour' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(queryClient.getQueryData(recipeServiceKeys.parseJob(job.id))).toEqual(job);
        expect(queryClient.getQueryData(recipeServiceKeys.parseJob(FIXTURE_OTHER_PARSE_JOB_UUID))).toBeUndefined();
    });

    it('stales no other cache region — a parse binds nothing (R19)', async () => {
        const { result, client, probes } = renderParseHook(() => useCreateParseJob());
        vi.spyOn(client, 'createParseJob').mockResolvedValue(makeParseJob());

        act(() => result.current.mutate({ text: '2 cups flour' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual([]);
    });
});

describe('useRetryParseJob', () => {
    it('retries through the client and writes the re-driven view through', async () => {
        const rerun = makeParseJob({ status: 'running' });
        const { result, client, queryClient } = renderParseHook(() => useRetryParseJob());
        const retryParseJob = vi.spyOn(client, 'retryParseJob').mockResolvedValue(rerun);

        act(() => result.current.mutate(FIXTURE_PARSE_JOB_UUID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(retryParseJob).toHaveBeenCalledWith(FIXTURE_PARSE_JOB_UUID);
        expect(queryClient.getQueryData(recipeServiceKeys.parseJob(FIXTURE_PARSE_JOB_UUID))).toEqual(rerun);
    });

    it('surfaces the expiry refusal and writes nothing — a job past its TTL cannot be re-driven', async () => {
        const stale = makeParseJob({ status: 'partial' });
        const { result, client, queryClient, probes } = renderParseHook(() => useRetryParseJob());
        queryClient.setQueryData(recipeServiceKeys.parseJob(FIXTURE_PARSE_JOB_UUID), stale);
        vi.spyOn(client, 'retryParseJob').mockRejectedValue(new ParseJobExpiredError());

        act(() => result.current.mutate(FIXTURE_PARSE_JOB_UUID));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBeInstanceOf(ParseJobExpiredError);
        // The failed write must not evict the good view the cook is still looking at.
        expect(queryClient.getQueryData(recipeServiceKeys.parseJob(FIXTURE_PARSE_JOB_UUID))).toEqual(stale);
        expect(probes()).toEqual([]);
    });
});

describe('useEditParseJobLine', () => {
    it('edits through the client with the job id, line index and replacement line, in that order', async () => {
        const edited = makeParseJob({
            lines: [makeParseJobLine({ lineIndex: 2, sourceLine: '1 tsp salt' })],
        });
        const { result, client, queryClient } = renderParseHook(() => useEditParseJobLine());
        const editParseJobLine = vi.spyOn(client, 'editParseJobLine').mockResolvedValue(edited);

        act(() =>
            result.current.mutate({
                id: FIXTURE_PARSE_JOB_UUID,
                lineIndex: 2,
                input: { sourceLine: '1 tsp salt' },
            }),
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(editParseJobLine).toHaveBeenCalledWith(FIXTURE_PARSE_JOB_UUID, 2, { sourceLine: '1 tsp salt' });
        expect(queryClient.getQueryData(recipeServiceKeys.parseJob(FIXTURE_PARSE_JOB_UUID))).toEqual(edited);
    });

    it('stales no other cache region — a line edit changes no recipe, collection or search row', async () => {
        const { result, client, probes } = renderParseHook(() => useEditParseJobLine());
        vi.spyOn(client, 'editParseJobLine').mockResolvedValue(makeParseJob());

        act(() =>
            result.current.mutate({
                id: FIXTURE_PARSE_JOB_UUID,
                lineIndex: 0,
                input: { sourceLine: '1 tsp salt' },
            }),
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(probes()).toEqual([]);
    });
});
