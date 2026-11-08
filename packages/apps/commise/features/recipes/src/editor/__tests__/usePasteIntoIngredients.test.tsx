/**
 * Tests for {@link usePasteIntoIngredients} — Paste a list in the Ingredients section (blueprint A5, A2; owner decision
 * D10, build spec §7.5.4): the parse job is created and polled, each line is projected in paste order, and the cook's
 * way out of a stalled or failed line is theirs (Add as written, Try again).
 *
 * ⛔ REWRITTEN for ADR-0071 (blueprint A2). This hook no longer JOINS lines and no longer looks anything up by name: the
 * by-name join bound a ranked guess (milk crackers for milk), which is why it was removed. It now owns the paste's
 * SESSION — the job, the lines and which of them have joined — and `usePasteMatching` (its own suite) does the joining.
 * Every by-name assertion that stood here (the lookup, the appended rows, a failed lookup, the paused join) was deleted
 * with the code it tested; the coverage moved to `usePasteMatching.test.tsx` and `pasteMatch.integration.test.tsx`. What
 * stayed is what this hook still owns: the job, the cook's choices (no time limit), the session's end, and the daily
 * limit's refusal (004 FR-022), where every line joins as written.
 *
 * The recipe service's hooks are doubles (their own suite drives the client); the projection (`pastedLines.ts`) is real.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { FetchUnavailableError, ImportQuotaExceededError, NotFoundError } from '@kitchensink/recipe-service-client';
import type { ParseJobResponse } from '@kitchensink/schema-recipe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    makeParseJob,
    makeParseJobLine,
    makeParseProposal,
    makeParseProposalFood,
} from '../../__fixtures__/parseJobs.js';

const mocks = vi.hoisted(() => ({
    created: undefined as ((job: ParseJobResponse) => void) | undefined,
    createState: { isPending: false, isError: false, error: null as Error | null },
    mutate: vi.fn(),
    reset: vi.fn(),
    job: undefined as ParseJobResponse | undefined,
    jobError: undefined as Error | undefined,
    pollPaused: false,
    polledId: vi.fn(),
    retryParse: vi.fn(),
    withdraw: vi.fn(),
    retryState: { isError: false },
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useCreateParseJob: (options: { onSuccess?: (job: ParseJobResponse) => void }) => {
        mocks.created = options.onSuccess;

        return { mutate: mocks.mutate, reset: mocks.reset, ...mocks.createState };
    },
    useParseJob: (id: string) => {
        mocks.polledId(id);

        return {
            data: id === '' ? undefined : mocks.job,
            isError: id !== '' && mocks.jobError !== undefined,
            error: id === '' ? null : (mocks.jobError ?? null),
            fetchStatus: mocks.pollPaused ? 'paused' : 'idle',
        };
    },
    useRetryParseJob: () => ({ mutate: mocks.retryParse, ...mocks.retryState }),
    useWithdrawParseJobLines: () => ({ mutate: mocks.withdraw }),
}));

import { usePasteIntoIngredients, type UsePasteIntoIngredientsOptions } from '../usePasteIntoIngredients.js';

const parsed = (lineIndex: number, sourceLine: string, name: string) =>
    makeParseJobLine({
        lineIndex,
        sourceLine,
        status: 'parsed',
        proposal: makeParseProposal({ foods: [makeParseProposalFood({ name })] }),
    });

function render(over: Partial<UsePasteIntoIngredientsOptions> = {}) {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const hook = renderHook((props: UsePasteIntoIngredientsOptions) => usePasteIntoIngredients(props), {
        initialProps: { offered: true, ...over },
        wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });

    return hook;
}

/** The job the create answers with, accepted. */
function accept(job: ParseJobResponse): void {
    mocks.job = job;
    act(() => mocks.created?.(job));
}

/** Let every queued update settle. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 4; turn += 1) {
        await act(async () => {
            if (vi.isFakeTimers()) {
                await vi.advanceTimersByTimeAsync(0);
            } else {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        });
    }
}

/** What a settled line adds, by name. */
const rowNamesOf = (line: ReturnType<typeof render>['result']['current']['lines'][number] | undefined) =>
    line?.kind === 'settled' ? line.rows.map((row) => row.name) : undefined;

/** The fixture job's `createdAt`: its `expiresAt` is a day later, so a real clock past that day expires every job. */
const FIXTURE_NOW = new Date('2026-10-09T10:00:00.000Z');

beforeEach(() => {
    vi.setSystemTime(FIXTURE_NOW);
    mocks.created = undefined;
    mocks.createState = { isPending: false, isError: false, error: null };
    mocks.job = undefined;
    mocks.jobError = undefined;
    mocks.pollPaused = false;
    mocks.retryState = { isError: false };
    mocks.retryParse.mockReset();
    mocks.withdraw.mockReset();
});

afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
});

describe('usePasteIntoIngredients — where it is offered (D10)', () => {
    /** REWRITTEN (owner D10, 2026-10-09): the editor decides when paste is offered (`pasteOffered`, until the first publish). */
    it('is offered while the editor offers it, and not otherwise', () => {
        expect(render().result.current.available).toBe(true);
        expect(render({ offered: false }).result.current.available).toBe(false);
    });

    it('is not offered again while a paste is still joining', () => {
        const { result } = render();

        act(() => result.current.submit('2 cups flour'));
        accept(makeParseJob());

        expect(result.current.available).toBe(false);
    });
});

describe('usePasteIntoIngredients — the job', () => {
    it('creates the job with the pasted text, and every line is projected at once with its own text', () => {
        const { result } = render();

        act(() => result.current.submit('2 cups flour\n1 tsp salt'));
        expect(mocks.mutate).toHaveBeenCalledWith({ text: '2 cups flour\n1 tsp salt' }, expect.any(Object));

        accept(
            makeParseJob({
                lines: [
                    makeParseJobLine({ lineIndex: 0, sourceLine: '2 cups flour' }),
                    makeParseJobLine({ lineIndex: 1, sourceLine: '1 tsp salt' }),
                ],
            }),
        );

        expect(result.current.lines.map((line) => [line.kind, line.sourceLine])).toEqual([
            ['reading', '2 cups flour'],
            ['reading', '1 tsp salt'],
        ]);
        expect(result.current.acceptedCount).toBe(1);
        expect(result.current.jobId).toBe(makeParseJob().id);
        expect(result.current.joined.size).toBe(0);
    });

    it('a refused create (offline included) says so and reads nothing', () => {
        mocks.createState = { isPending: false, isError: true, error: new FetchUnavailableError() };
        const { result } = render();

        expect(result.current.failed).toBe(true);
        expect(result.current.lines).toEqual([]);
    });

    it('⛔ keeps polling the job after every line has joined: a food still being checked needs the next read', () => {
        const { result } = render();
        act(() => result.current.submit('2 cups flour'));
        accept(makeParseJob({ lines: [parsed(0, '2 cups flour', 'flour')] }));
        mocks.polledId.mockClear();

        act(() => result.current.markJoined(result.current.sessionKey ?? '', 0, 1));

        expect(result.current.lines).toEqual([]);
        expect(result.current.available).toBe(true);
        expect(mocks.polledId).toHaveBeenLastCalledWith(makeParseJob().id);
        expect(result.current.job).toBeDefined();
    });
});

describe('usePasteIntoIngredients — lines join, and the session ends with the last one', () => {
    it('records each joined line; the session ends and says the count only when the last has joined', () => {
        const { result } = render();
        act(() => result.current.submit('2 cups flour\n1 tsp salt'));
        accept(makeParseJob({ lines: [parsed(0, '2 cups flour', 'flour'), parsed(1, '1 tsp salt', 'salt')] }));
        const key = result.current.sessionKey ?? '';

        act(() => result.current.markJoined(key, 0, 1));

        expect([...result.current.joined]).toEqual([0]);
        expect(result.current.added).toBeUndefined();
        expect(result.current.available).toBe(false);

        act(() => result.current.markJoined(key, 1, 2));

        expect(result.current.added).toEqual({ count: 3, occurrence: 1 });
        expect(result.current.available).toBe(true);
    });

    it('a heading adds no row: its line joins with a count of 0', () => {
        const { result } = render();
        act(() => result.current.submit('For the sauce:'));
        accept(
            makeParseJob({
                lines: [
                    makeParseJobLine({
                        sourceLine: 'For the sauce:',
                        status: 'parsed',
                        proposal: makeParseProposal({ foods: [] }),
                    }),
                ],
            }),
        );

        act(() => result.current.markJoined(result.current.sessionKey ?? '', 0, 0));

        expect(result.current.added).toEqual({ count: 0, occurrence: 1 });
    });

    it('⛔ a join that answers for a paste that was replaced does not touch the newer paste', () => {
        const { result } = render();
        act(() => result.current.submit('2 cups flour'));
        accept(makeParseJob({ id: 'job-a', lines: [parsed(0, '2 cups flour', 'flour')] }));
        const staleKey = result.current.sessionKey ?? '';
        act(() => result.current.markJoined(staleKey, 0, 1));
        act(() => result.current.submit('1 tsp salt'));
        accept(makeParseJob({ id: 'job-b', lines: [parsed(0, '1 tsp salt', 'salt')] }));

        act(() => result.current.markJoined(staleKey, 0, 1));

        expect(result.current.sessionKey).toBe('job-b');
        expect(result.current.joined.size).toBe(0);
        expect(result.current.added).toEqual({ count: 1, occurrence: 1 });
    });

    it('a join that fails holds its line (and the lines after it) until Try again', () => {
        const { result } = render();
        act(() => result.current.submit('2 cups flour'));
        accept(makeParseJob({ lines: [parsed(0, '2 cups flour', 'flour')] }));
        const key = result.current.sessionKey ?? '';

        act(() => result.current.markJoinFailed(key, 0));
        expect(result.current.failedAt).toBe(0);

        act(() => result.current.retryLookup());
        expect(result.current.failedAt).toBeUndefined();
    });

    it('⛔ a failure that arrives for a line the session has already joined is ignored', () => {
        const { result } = render();
        act(() => result.current.submit('2 cups flour\n1 tsp salt'));
        accept(makeParseJob({ lines: [parsed(0, '2 cups flour', 'flour'), parsed(1, '1 tsp salt', 'salt')] }));
        const key = result.current.sessionKey ?? '';
        act(() => result.current.markJoined(key, 0, 1));

        act(() => result.current.markJoinFailed(key, 0));

        expect(result.current.failedAt).toBeUndefined();
    });
});

/**
 * 004 FR-022 (ADR-0071 phase 0): past the daily allowance the create is refused with `IMPORT_QUOTA_EXCEEDED`, and there
 * is no job. The cook pasted a list, so it still lands: every line joins AS WRITTEN, nothing is matched, and the host says
 * when matching starts again.
 */
describe('usePasteIntoIngredients — the daily limit (004 FR-022)', () => {
    const RESETS_AT = '2026-10-10T08:00:00.000Z';
    const quotaError = () => new ImportQuotaExceededError(RESETS_AT);

    /** Submit, and let the create answer with the refusal. */
    function refused(text: string) {
        const hook = render();

        mocks.createState = { isPending: false, isError: true, error: quotaError() };
        act(() => hook.result.current.submit(text));
        const [, options] = mocks.mutate.mock.calls.at(-1) as [unknown, { onError: (error: Error) => void }];

        act(() => options.onError(quotaError()));

        return hook;
    }

    it('⛔ is not a failure: the sheet keeps no error, closes, and the cook is told the limit instead', () => {
        const { result } = refused('2 cups flour\n1 tsp salt');

        expect(result.current.failed).toBe(false);
        expect(result.current.acceptedCount).toBe(1);
        expect(result.current.quota).toEqual({ resetsAt: RESETS_AT });
    });

    /**
     * Designer condition on "Added 6 ingredients.": N counts the INGREDIENTS added (the rows each joined line brought), not
     * the pasted lines. A heading brings none and a blank line is never a line (the splitter drops it).
     */
    it('⛔ counts the ingredients added, not the lines: six foods, a heading and a blank line say 6', () => {
        const text = [
            'For the dough:',
            '1 cup flour',
            '',
            '2 eggs',
            '1 tsp salt',
            '3 tbsp oil',
            '1 cup milk',
            '2 tsp yeast',
        ].join('\n');
        const { result } = refused(text);
        const key = result.current.sessionKey ?? '';

        // Seven lines (the blank is gone), each joining with the rows it settled into, as the Mediator reports them.
        expect(result.current.lines).toHaveLength(7);
        act(() => {
            for (const line of result.current.lines) {
                result.current.markJoined(key, line.lineIndex, line.kind === 'settled' ? line.rows.length : 0);
            }
        });

        expect(result.current.added).toEqual({ count: 6, occurrence: 1 });
    });

    it('⛔ every line joins as written, through the reader, in paste order, and none is parsed', () => {
        const { result } = refused('2 tbsp olive oil, for frying\n1 tsp salt');

        expect(result.current.jobId).toBeUndefined();
        expect(mocks.polledId).not.toHaveBeenCalledWith(expect.stringMatching(/./));
        expect(result.current.lines.map(rowNamesOf)).toEqual([['olive oil'], ['salt']]);
        expect(result.current.matchesGone).toBe(true);
        expect(result.current.available).toBe(false);
    });

    it('the notice outlives the session, and the next paste clears it', () => {
        const { result } = refused('1 tsp salt');
        const key = result.current.sessionKey ?? '';

        act(() => result.current.markJoined(key, 0, 1));

        expect(result.current.lines).toEqual([]);
        expect(result.current.quota).toEqual({ resetsAt: RESETS_AT });

        act(() => result.current.submit('2 cups flour'));

        expect(result.current.quota).toBeUndefined();
    });

    it('a different refusal is still a failure the sheet shows', () => {
        mocks.createState = { isPending: false, isError: true, error: new FetchUnavailableError() };
        const { result } = render();

        expect(result.current.failed).toBe(true);
        expect(result.current.quota).toBeUndefined();
    });
});

/** Whether the job can still match: an expired or unreadable job answers no match, ever. */
describe('usePasteIntoIngredients — when matches can no longer come', () => {
    it('is false for a live job, and for a read that failed for now', () => {
        const { result, rerender } = render();
        act(() => result.current.submit('2 cups flour'));
        accept(makeParseJob());

        expect(result.current.matchesGone).toBe(false);

        mocks.jobError = new FetchUnavailableError();
        rerender({ offered: true });

        expect(result.current.matchesGone).toBe(false);
    });

    it('is true for a job the service says is gone', () => {
        const { result, rerender } = render();
        act(() => result.current.submit('2 cups flour'));
        accept(makeParseJob());

        mocks.jobError = new NotFoundError('gone', 'PARSE_JOB_NOT_FOUND');
        rerender({ offered: true });

        expect(result.current.matchesGone).toBe(true);
    });

    it('is true once the job expires, at its deadline', async () => {
        vi.useFakeTimers({ now: FIXTURE_NOW });
        const { result, rerender } = render();
        act(() => result.current.submit('2 cups flour'));
        accept(makeParseJob());

        act(() => {
            vi.advanceTimersByTime(24 * 60 * 60 * 1_000 + 1);
        });
        rerender({ offered: true });
        await settle();

        expect(result.current.matchesGone).toBe(true);
    });
});

describe('usePasteIntoIngredients — no time limit; the cook decides', () => {
    const OLIVE = '2 tbsp olive oil, for frying';

    it('⛔ a pending line waits however long the parse takes: no clock settles it', async () => {
        vi.useFakeTimers({ now: FIXTURE_NOW });
        const { result, rerender } = render();
        act(() => result.current.submit(OLIVE));
        accept(makeParseJob({ lines: [makeParseJobLine({ sourceLine: OLIVE, progress: { phase: 'reading' } })] }));

        act(() => {
            vi.advanceTimersByTime(60 * 60 * 1_000);
        });
        rerender({ offered: true });
        await settle();

        expect(result.current.lines.map((line) => line.kind)).toEqual(['reading']);
    });

    it('a stalled line waits on the cook, and Add as written settles it through the reader', async () => {
        const { result } = render();
        act(() => result.current.submit(OLIVE));
        accept(makeParseJob({ lines: [makeParseJobLine({ sourceLine: OLIVE, progress: { phase: 'stalled' } })] }));
        await settle();

        expect(result.current.lines.map((line) => line.kind)).toEqual(['awaitingCook']);

        const signal = result.current.focusSignal;
        act(() => result.current.addAsWritten(0));

        const [line] = result.current.lines;

        expect(line?.kind).toBe('settled');
        // The unit as the cook typed it ("tbsp"), the same on every path that settles a line (F12).
        expect(line?.kind === 'settled' ? line.rows : []).toEqual([
            expect.objectContaining({ name: 'olive oil', measure: expect.objectContaining({ unit: 'tbsp' }) }),
        ]);
        expect(line?.kind === 'settled' ? line.rows[0] : undefined).not.toHaveProperty('sourcePhrase');
        expect(line?.kind === 'settled' ? line.rows[0] : undefined).not.toHaveProperty('foodIndex');
        expect(result.current.focusSignal).toBe(signal + 1);
    });

    it('a retryable line waits on the cook; Try again re-drives the whole paste', async () => {
        const { result } = render();
        act(() => result.current.submit('2 cups flour\n1 tsp salt'));
        accept(
            makeParseJob({
                status: 'partial',
                lines: [
                    makeParseJobLine({ lineIndex: 0, sourceLine: '2 cups flour', status: 'failed_retryable' }),
                    makeParseJobLine({ lineIndex: 1, sourceLine: '1 tsp salt', status: 'failed_retryable' }),
                ],
            }),
        );
        await settle();

        expect(result.current.lines.map((line) => line.kind)).toEqual(['awaitingCook', 'awaitingCook']);

        act(() => result.current.retryParse());

        expect(mocks.retryParse).toHaveBeenCalledWith(makeParseJob().id, { onError: expect.any(Function) });
    });

    /**
     * Plan 2026-10-15-011, open question 8: Add as written must also take the line out of the parse on the server, or
     * the worker still pays an engine for an answer this client discards.
     */
    it('⛔ Add as written withdraws that line from the parse job on the server', async () => {
        const { result } = render();
        act(() => result.current.submit('x'));
        accept(
            makeParseJob({
                lines: [
                    makeParseJobLine({ lineIndex: 0, sourceLine: '1 tsp salt', progress: { phase: 'stalled' } }),
                    makeParseJobLine({ lineIndex: 1, sourceLine: OLIVE, progress: { phase: 'stalled' } }),
                ],
            }),
        );
        await settle();

        act(() => result.current.addAsWritten(1));

        expect(mocks.withdraw).toHaveBeenCalledTimes(1);
        expect(mocks.withdraw).toHaveBeenCalledWith({ id: makeParseJob().id, lineIndexes: [1] });
    });

    it('⛔ Add the rest as written withdraws exactly the stalled and retryable lines, not the ones being read', async () => {
        const { result } = render();
        act(() => result.current.submit('x'));
        accept(
            makeParseJob({
                lines: [
                    makeParseJobLine({ lineIndex: 0, sourceLine: '2 cups flour', progress: { phase: 'reading' } }),
                    makeParseJobLine({ lineIndex: 1, sourceLine: '1 tsp salt', progress: { phase: 'stalled' } }),
                    makeParseJobLine({ lineIndex: 2, sourceLine: OLIVE, status: 'failed_retryable' }),
                ],
            }),
        );
        await settle();

        act(() => result.current.addRestAsWritten());

        expect(mocks.withdraw).toHaveBeenCalledWith({ id: makeParseJob().id, lineIndexes: [1, 2] });
    });

    it('a refused withdrawal never holds the line back: it still settles as written', async () => {
        mocks.withdraw.mockImplementation((_variables: unknown, options?: { onError?: (error: Error) => void }) =>
            options?.onError?.(new Error('refused')),
        );
        const { result } = render();
        act(() => result.current.submit(OLIVE));
        accept(makeParseJob({ lines: [makeParseJobLine({ sourceLine: OLIVE, progress: { phase: 'stalled' } })] }));
        await settle();

        act(() => result.current.addAsWritten(0));

        expect(result.current.lines.map(rowNamesOf)).toEqual([['olive oil']]);
    });

    /** Plan open question 4: a refused Try again used to show nothing at all. */
    it('⛔ says so when Try again is refused, and moves focus back to the block that says it', async () => {
        const { result } = render();
        act(() => result.current.submit('x'));
        accept(
            makeParseJob({
                status: 'partial',
                lines: [makeParseJobLine({ lineIndex: 0, sourceLine: '2 cups flour', status: 'failed_retryable' })],
            }),
        );
        await settle();

        expect(result.current.retryFailed).toBe(false);

        mocks.retryParse.mockImplementation((_id: string, options?: { onError?: (error: Error) => void }) =>
            options?.onError?.(new Error('409')),
        );
        const signal = result.current.focusSignal;
        act(() => result.current.retryParse());

        // The press moves focus to the block (its control may go away); the refusal moves it again, to the failure.
        expect(result.current.focusSignal).toBe(signal + 2);
    });

    it('reports a refused Try again from the mutation’s own error state', () => {
        mocks.retryState = { isError: true };
        const { result } = render();

        expect(result.current.retryFailed).toBe(true);
    });

    /** Plan open question 5: the UX spec prefers the NEXT WAITING ROW's action to the progress block. */
    it('⛔ after Add as written, focus goes to the next waiting row, not the block', async () => {
        const { result } = render();
        act(() => result.current.submit('x'));
        accept(
            makeParseJob({
                lines: [
                    makeParseJobLine({ lineIndex: 0, sourceLine: '2 cups flour', progress: { phase: 'stalled' } }),
                    makeParseJobLine({ lineIndex: 1, sourceLine: '1 tsp salt', progress: { phase: 'stalled' } }),
                    makeParseJobLine({ lineIndex: 2, sourceLine: OLIVE, progress: { phase: 'stalled' } }),
                ],
            }),
        );
        await settle();

        const signal = result.current.focusSignal;
        act(() => result.current.addAsWritten(0));

        expect(result.current.focusRow).toBe(1);
        expect(result.current.focusSignal).toBe(signal);

        act(() => result.current.onRowFocusHandled());

        expect(result.current.focusRow).toBeUndefined();
    });

    it('falls back to the earlier waiting row when none follows, and to the block when none waits', async () => {
        const { result } = render();
        act(() => result.current.submit('x'));
        accept(
            makeParseJob({
                lines: [
                    makeParseJobLine({ lineIndex: 0, sourceLine: '2 cups flour', progress: { phase: 'stalled' } }),
                    makeParseJobLine({ lineIndex: 1, sourceLine: '1 tsp salt', progress: { phase: 'stalled' } }),
                ],
            }),
        );
        await settle();

        act(() => result.current.addAsWritten(1));

        expect(result.current.focusRow).toBe(0);

        const signal = result.current.focusSignal;
        act(() => result.current.addAsWritten(0));

        expect(result.current.focusRow).toBeUndefined();
        expect(result.current.focusSignal).toBe(signal + 1);
    });

    it('never aims focus at a row that is only being read: Add the rest as written falls back to the block', async () => {
        const { result } = render();
        act(() => result.current.submit('x'));
        accept(
            makeParseJob({
                lines: [
                    makeParseJobLine({ lineIndex: 0, sourceLine: '2 cups flour', progress: { phase: 'reading' } }),
                    makeParseJobLine({ lineIndex: 1, sourceLine: '1 tsp salt', progress: { phase: 'stalled' } }),
                ],
            }),
        );
        await settle();

        const signal = result.current.focusSignal;
        act(() => result.current.addAsWritten(1));

        expect(result.current.focusRow).toBeUndefined();
        expect(result.current.focusSignal).toBe(signal + 1);
    });

    it('Add the rest as written settles every line waiting on the cook, and leaves read lines their parse', async () => {
        const { result } = render();
        act(() => result.current.submit('x'));
        accept(
            makeParseJob({
                lines: [
                    parsed(0, '2 cups flour', 'flour'),
                    makeParseJobLine({ lineIndex: 1, sourceLine: '1 tsp salt', progress: { phase: 'stalled' } }),
                    makeParseJobLine({ lineIndex: 2, sourceLine: OLIVE, status: 'failed_retryable' }),
                ],
            }),
        );
        await settle();

        act(() => result.current.addRestAsWritten());

        expect(result.current.lines.map(rowNamesOf)).toEqual([['flour'], ['salt'], ['olive oil']]);
        // The parsed line keeps its parse: it names its food index, so it can find its match.
        expect(result.current.lines[0]?.kind === 'settled' ? result.current.lines[0].rows[0]?.foodIndex : -1).toBe(0);
    });

    it('a job the service says is gone settles every line through the reader', async () => {
        const { result, rerender } = render();
        act(() => result.current.submit('2 cups flour'));
        accept(makeParseJob());

        mocks.jobError = new NotFoundError('gone', 'PARSE_JOB_NOT_FOUND');
        rerender({ offered: true });
        await settle();

        expect(result.current.lines.map(rowNamesOf)).toEqual([['flour']]);
    });

    /**
     * ⛔ A READ THAT MAY WORK AGAIN IS NOT A GIVE-UP (owner ruling 2026-10-13: no time limit). An outage of the recipe
     * service — the sandbox's midnight stop included — fails the poll's refetch; settling every unread line as written
     * then would be the cook's choice made for them. Only a failure the client's own retry policy calls terminal stops
     * the paste.
     */
    it('⛔ a read that failed for now keeps the lines waiting rather than adding them as written', async () => {
        const { result, rerender } = render();
        act(() => result.current.submit('2 cups flour'));
        accept(makeParseJob({ lines: [makeParseJobLine({ progress: { phase: 'reading' } })] }));

        mocks.jobError = new FetchUnavailableError();
        rerender({ offered: true });
        await settle();

        expect(result.current.lines.map((line) => line.kind)).toEqual(['reading']);
    });
});

describe('usePasteIntoIngredients — an unreachable connection', () => {
    it('says the poll is paused, from the query’s own state, never from a connectivity read', () => {
        mocks.pollPaused = true;
        const { result } = render();
        act(() => result.current.submit('2 cups flour'));
        accept(makeParseJob());

        expect(result.current.pollPaused).toBe(true);
    });
});
