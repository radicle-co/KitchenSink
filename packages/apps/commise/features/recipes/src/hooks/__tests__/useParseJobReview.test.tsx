// @vitest-environment jsdom
/**
 * The parse-review ORCHESTRATION hook — the three things it owns that the pure model does not.
 *
 *  1. **It folds the query into the model's one state.** Asserted through the real hook against a real
 *     `RecipeServiceClient` with its transport stubbed, so the query key, the enable gate and the parse of
 *     the response are all exercised rather than mocked away.
 *  2. **It tells an EXPIRY refusal apart from a transient failure**, for both mutations. The remedies
 *     differ — "paste it again" vs "try again in a moment" — so a single sentence would send a cook to
 *     retry a job the server will never accept.
 *  3. **It names the BUSY LINE**, not a boolean, so two rows cannot both look like they are saving.
 *
 * The stall bound itself is asserted in `parse/__tests__/model.test.ts`, where time is a parameter; there
 * is nothing to gain from re-asserting it through a hook that only supplies `Date.now()`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

import { NotFoundError, ParseJobExpiredError, RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { ParseJobResponse } from '@kitchensink/recipe-service-client';

import { recipeParseMessages } from '../../parse/messages.js';
import { PARSE_JOB_STALL_BOUND_MS } from '../../parse/model.js';
import { useParseJobReview } from '../useParseJobReview.js';

const messages = recipeParseMessages.en;
const JOB_ID = '00000000-0000-4000-8000-00000000d001';

afterEach(cleanup);

function job(overrides: Partial<ParseJobResponse> = {}): ParseJobResponse {
    return {
        id: JOB_ID,
        status: 'complete',
        createdAt: '2026-09-02T11:59:00.000Z',
        // Far ahead, so `expiresAt` never decides a test that is not about it.
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        lines: [{ lineIndex: 0, sourceLine: '2 cups flour', status: 'parsed', proposal: null }],
        ...overrides,
    };
}

/** Render the hook over a guarded client whose methods `prepare` stubs BEFORE the query can fire. */
function renderReview(prepare: (client: RecipeServiceClient) => void, jobId = JOB_ID) {
    const client = createFakeRecipeServiceClient();
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    prepare(client);

    const wrapper = ({ children }: { readonly children: ReactNode }) =>
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(RecipeServiceProvider, { client, children }),
        );

    return { ...renderHook(() => useParseJobReview(jobId), { wrapper }), client };
}

describe('useParseJobReview — folding the query into one state', () => {
    it('reports a settled job as ready, with its progress', async () => {
        const { result } = renderReview((client) => {
            vi.spyOn(client, 'getParseJob').mockResolvedValue(job());
        });

        await waitFor(() => expect(result.current.state.kind).toBe('ready'));
        expect(result.current.state.kind === 'ready' && result.current.state.progress.settled).toBe(1);
    });

    it('reports a 404 as missing — a stranger and an absent job are ONE answer', async () => {
        const { result } = renderReview((client) => {
            vi.spyOn(client, 'getParseJob').mockRejectedValue(new NotFoundError('gone', 'PARSE_JOB_NOT_FOUND'));
        });

        await waitFor(() => expect(result.current.state.kind).toBe('missing'));
    });

    it('⛔ reports a job past its deadline as expired, even while the wire status says running', async () => {
        // The sweep rides a 15-minute tick while mutations refuse on the timestamp. A status-only reading
        // would offer controls the server has already stopped honouring.
        const { result } = renderReview((client) => {
            vi.spyOn(client, 'getParseJob').mockResolvedValue(
                job({ status: 'running', expiresAt: new Date(Date.now() - 1000).toISOString() }),
            );
        });

        await waitFor(() => expect(result.current.state.kind).toBe('expired'));
    });

    it('stays loading and issues no request for an empty job id', async () => {
        const getParseJob = vi.fn();
        const { result } = renderReview((client) => {
            vi.spyOn(client, 'getParseJob').mockImplementation(getParseJob);
        }, '');

        await waitFor(() => expect(result.current.state.kind).toBe('loading'));
        expect(getParseJob).not.toHaveBeenCalled();
    });
});

describe('useParseJobReview — the retry command', () => {
    it('re-drives the job and reports no notice on success', async () => {
        const { result, client } = renderReview((c) => {
            vi.spyOn(c, 'getParseJob').mockResolvedValue(job({ status: 'partial' }));
        });
        const retryParseJob = vi.spyOn(client, 'retryParseJob').mockResolvedValue(job({ status: 'running' }));

        await waitFor(() => expect(result.current.state.kind).toBe('settling'));
        act(() => result.current.retry.run());

        await waitFor(() => expect(retryParseJob).toHaveBeenCalledWith(JOB_ID));
        await waitFor(() => expect(result.current.retry.notice).toBeUndefined());
    });

    it('⛔ says "paste it again" for an EXPIRY refusal, not "try again in a moment"', async () => {
        const { result, client } = renderReview((c) => {
            vi.spyOn(c, 'getParseJob').mockResolvedValue(job({ status: 'partial' }));
        });
        vi.spyOn(client, 'retryParseJob').mockRejectedValue(new ParseJobExpiredError());

        await waitFor(() => expect(result.current.state.kind).toBe('settling'));
        act(() => result.current.retry.run());

        await waitFor(() => expect(result.current.retry.notice).toBe(messages.retryExpired));
    });

    it('says "try again in a moment" for any other failure', async () => {
        const { result, client } = renderReview((c) => {
            vi.spyOn(c, 'getParseJob').mockResolvedValue(job({ status: 'partial' }));
        });
        vi.spyOn(client, 'retryParseJob').mockRejectedValue(new Error('boom'));

        await waitFor(() => expect(result.current.state.kind).toBe('settling'));
        act(() => result.current.retry.run());

        await waitFor(() => expect(result.current.retry.notice).toBe(messages.retryFailed));
    });
});

describe('useParseJobReview — the stall clock is RESET by a mutation', () => {
    // ⛔ DELETABLE WITH EVERY OTHER TEST GREEN before this existed. The hook's own module docstring calls
    // the reset load-bearing — "would report a job as stalled the instant a cook retried an old one" — and
    // the suite's stated reason for not testing it (that the bound is asserted in `model.test.ts`, where
    // time is a parameter) covers the BOUND, not the RESET, which is the hook's own rule.
    //
    // Fake timers, because the reset is only observable across the three-minute boundary.
    it('leaves the stalled state after a retry re-opens the work', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });

        try {
            const { result, client } = renderReview((c) => {
                vi.spyOn(c, 'getParseJob').mockResolvedValue(job({ status: 'running' }));
            });
            vi.spyOn(client, 'retryParseJob').mockResolvedValue(job({ status: 'running' }));

            await waitFor(() => expect(result.current.state.kind).toBe('running'));

            // Past the bound with no mutation: the surface tells the cook it is stuck.
            await act(async () => {
                vi.advanceTimersByTime(PARSE_JOB_STALL_BOUND_MS + 1_000);
                await Promise.resolve();
            });
            await waitFor(() => expect(result.current.state.kind).toBe('stalled'));

            // A retry re-opens the work, so the wait is measured from NOW — not from the original mount.
            await act(async () => {
                result.current.retry.run();
                await Promise.resolve();
            });

            await waitFor(() => expect(result.current.state.kind).toBe('running'));
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('useParseJobReview — the line-edit command', () => {
    it('sends the job id, the WIRE line index and the replacement text, in that order', async () => {
        const { result, client } = renderReview((c) => {
            vi.spyOn(c, 'getParseJob').mockResolvedValue(job());
        });
        const editParseJobLine = vi.spyOn(client, 'editParseJobLine').mockResolvedValue(job());

        await waitFor(() => expect(result.current.state.kind).toBe('ready'));
        act(() => result.current.edit.submit(3, '2 cups flour'));

        await waitFor(() => expect(editParseJobLine).toHaveBeenCalledWith(JOB_ID, 3, { sourceLine: '2 cups flour' }));
    });

    it('⛔ names the BUSY LINE rather than a boolean — two rows must not both look like they are saving', async () => {
        const { result, client } = renderReview((c) => {
            vi.spyOn(c, 'getParseJob').mockResolvedValue(job());
        });
        // Never settles, so the in-flight state is observable rather than a race.
        vi.spyOn(client, 'editParseJobLine').mockReturnValue(new Promise(() => undefined));

        await waitFor(() => expect(result.current.state.kind).toBe('ready'));
        expect(result.current.edit.busyLineIndex).toBeUndefined();

        act(() => result.current.edit.submit(2, 'fixed'));

        await waitFor(() => expect(result.current.edit.busyLineIndex).toBe(2));
    });

    it('⛔ says "paste it again" for an EXPIRY refusal on an edit too', async () => {
        const { result, client } = renderReview((c) => {
            vi.spyOn(c, 'getParseJob').mockResolvedValue(job());
        });
        vi.spyOn(client, 'editParseJobLine').mockRejectedValue(new ParseJobExpiredError());

        await waitFor(() => expect(result.current.state.kind).toBe('ready'));
        act(() => result.current.edit.submit(0, 'fixed'));

        await waitFor(() => expect(result.current.edit.notice).toBe(messages.lineEditExpired));
    });

    it('says "try again in a moment" for any other edit failure', async () => {
        const { result, client } = renderReview((c) => {
            vi.spyOn(c, 'getParseJob').mockResolvedValue(job());
        });
        vi.spyOn(client, 'editParseJobLine').mockRejectedValue(new Error('boom'));

        await waitFor(() => expect(result.current.state.kind).toBe('ready'));
        act(() => result.current.edit.submit(0, 'fixed'));

        await waitFor(() => expect(result.current.edit.notice).toBe(messages.lineEditFailed));
    });
});
