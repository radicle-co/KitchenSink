/**
 * Tests for {@link usePasteIntoIngredients} — Paste a list in the Ingredients section (blueprint A5, owner decision D10,
 * build spec §7.5.4): the parse job is created, each line reads, and each settled line is looked up by name and appended
 * to the draft, in paste order.
 *
 * The recipe service's hooks are doubles (their own suite drives the client); the projection (`pastedLines.ts`), the
 * draft actions and the line adapters are the real ones.
 */
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { FoodResolutionStatus, type Ingredient } from '@kitchensink/recipe-core';
import { makeIngredient } from '@kitchensink/recipe-core/testing';
import type { ParseJobResponse } from '@kitchensink/schema-recipe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    makeParseJob,
    makeParseJobLine,
    makeParseProposal,
    makeParseProposalFood,
} from '../../__fixtures__/parseJobs.js';
import type { DraftAction } from '../../form/draftAction.js';
import { PASTE_STALL_BOUND_MS } from '../pastedLines.js';

const mocks = vi.hoisted(() => ({
    created: undefined as ((job: ParseJobResponse) => void) | undefined,
    createState: { isPending: false, isError: false },
    mutate: vi.fn(),
    reset: vi.fn(),
    job: undefined as ParseJobResponse | undefined,
    jobError: false,
    polledId: vi.fn(),
    byName: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useCreateParseJob: (options: { onSuccess?: (job: ParseJobResponse) => void }) => {
        mocks.created = options.onSuccess;

        return { mutate: mocks.mutate, reset: mocks.reset, ...mocks.createState };
    },
    useParseJob: (id: string) => {
        mocks.polledId(id);

        return { data: id === '' ? undefined : mocks.job, isError: id !== '' && mocks.jobError };
    },
    useAddIngredientByName: () => ({ mutateAsync: mocks.byName, isPaused: false }),
}));

import { usePasteIntoIngredients, type UsePasteIntoIngredientsOptions } from '../usePasteIntoIngredients.js';

const ingredient = (name: string): Ingredient =>
    makeIngredient({
        id: `00000000-0000-4000-8000-0000000000${name.length.toString().padStart(2, '0')}`,
        name,
        foodResolutionStatus: FoodResolutionStatus.PENDING,
    });

const parsed = (lineIndex: number, sourceLine: string, name: string) =>
    makeParseJobLine({
        lineIndex,
        sourceLine,
        status: 'parsed',
        proposal: makeParseProposal({ foods: [makeParseProposalFood({ name })] }),
    });

function render(over: Partial<UsePasteIntoIngredientsOptions> = {}) {
    const dispatch = vi.fn<(action: DraftAction) => void>();
    // The join is a real TanStack mutation over the doubled lookup.
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const hook = renderHook((props: UsePasteIntoIngredientsOptions) => usePasteIntoIngredients(props), {
        initialProps: { offered: true, keepsSource: true, dispatch, ...over },
        wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });

    return { ...hook, dispatch };
}

/** The job the create answers with, accepted. */
function accept(job: ParseJobResponse): void {
    mocks.job = job;
    act(() => mocks.created?.(job));
}

/** Let every queued lookup settle. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 4; turn += 1) {
        await act(async () => {
            // A mutation notifies on a timer: advance it under fake timers, wait it out under real ones.
            if (vi.isFakeTimers()) {
                await vi.advanceTimersByTimeAsync(0);
            } else {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        });
    }
}

const appended = (dispatch: ReturnType<typeof render>['dispatch']) =>
    dispatch.mock.calls.flatMap(([action]) => (action.kind === 'appendResolvedIngredient' ? [action.line] : []));

/** The fixture job's `createdAt`: its `expiresAt` is a day later, so a real clock past that day expires every job. */
const FIXTURE_NOW = new Date('2026-10-09T10:00:00.000Z');

beforeEach(() => {
    vi.setSystemTime(FIXTURE_NOW);
    mocks.created = undefined;
    mocks.createState = { isPending: false, isError: false };
    mocks.job = undefined;
    mocks.jobError = false;
    mocks.byName.mockImplementation(async (name: string) => ingredient(name));
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

    it('is not offered again while a paste is still reading', () => {
        const { result } = render();

        act(() => result.current.submit('2 cups flour'));
        accept(makeParseJob());

        expect(result.current.available).toBe(false);
    });
});

describe('usePasteIntoIngredients — the job', () => {
    it('creates the job with the pasted text, and each line reads at once with its own text', () => {
        const { result } = render();

        act(() => result.current.submit('2 cups flour\n1 tsp salt'));
        expect(mocks.mutate).toHaveBeenCalledWith({ text: '2 cups flour\n1 tsp salt' });

        accept(
            makeParseJob({
                lines: [
                    makeParseJobLine({ lineIndex: 0, sourceLine: '2 cups flour' }),
                    makeParseJobLine({ lineIndex: 1, sourceLine: '1 tsp salt' }),
                ],
            }),
        );

        expect(result.current.reading.map((row) => [row.sourceLine, row.state])).toEqual([
            ['2 cups flour', 'reading'],
            ['1 tsp salt', 'reading'],
        ]);
        expect(result.current.acceptedCount).toBe(1);
    });

    it('a refused create (offline included) says so and reads nothing', () => {
        mocks.createState = { isPending: false, isError: true };
        const { result } = render();

        expect(result.current.failed).toBe(true);
        expect(result.current.reading).toEqual([]);
    });
});

describe('usePasteIntoIngredients — settled lines join the recipe', () => {
    it('a parsed line is looked up by NAME and appended with its measure and what it was read from (A5)', async () => {
        const { result, rerender, dispatch } = render();
        act(() => result.current.submit('2 cups flour, sifted'));
        accept(makeParseJob());

        mocks.job = makeParseJob({
            status: 'complete',
            lines: [
                makeParseJobLine({
                    sourceLine: '2 cups flour, sifted',
                    status: 'parsed',
                    proposal: makeParseProposal({ foods: [makeParseProposalFood({ name: 'flour', prep: 'sifted' })] }),
                }),
            ],
        });
        rerender({ offered: true, keepsSource: true, dispatch });
        await settle();

        expect(mocks.byName).toHaveBeenCalledWith('flour');
        expect(appended(dispatch)).toEqual([
            expect.objectContaining({
                name: 'flour',
                quantity: 2,
                // The unit as the cook stated it ("2 cups"), never rewritten to the parse's "cup" (F12).
                unit: 'cups',
                preparation: 'sifted',
                sourceLine: '2 cups flour, sifted',
                sourcePhrase: 'flour',
            }),
        ]);
        // R19: the parse bound nothing; the line is whatever the lookup admitted, still resolving.
        expect(appended(dispatch)[0]?.resolutionStatus).toBe(FoodResolutionStatus.PENDING);
    });

    /**
     * REWRITTEN (findings 7 and 8): whether a line keeps its source is the editor's `pasteKeepsSource`, read when the
     * line JOINS — false once the create is submitted, which may be while the paste was still reading.
     */
    it('⛔ a line that joins once the create is submitted lands as an authored line: no source (A5, Q3)', async () => {
        const { result, rerender, dispatch } = render();
        act(() => result.current.submit('2 cups flour'));
        accept(makeParseJob());

        mocks.job = makeParseJob({ status: 'complete', lines: [parsed(0, '2 cups flour', 'flour')] });
        rerender({ offered: true, keepsSource: false, dispatch });
        await settle();

        expect(appended(dispatch)).toHaveLength(1);
        expect(appended(dispatch)[0]).not.toHaveProperty('sourceLine');
        expect(appended(dispatch)[0]).not.toHaveProperty('sourcePhrase');
    });

    it('lines join in paste order: a later line that settles first waits for the one above it', async () => {
        const { result, rerender, dispatch } = render();
        act(() => result.current.submit('2 cups flour\n1 tsp salt'));
        accept(makeParseJob());

        mocks.job = makeParseJob({
            lines: [makeParseJobLine({ lineIndex: 0, sourceLine: '2 cups flour' }), parsed(1, '1 tsp salt', 'salt')],
        });
        rerender({ offered: true, keepsSource: true, dispatch });
        await settle();

        expect(appended(dispatch)).toEqual([]);

        mocks.job = makeParseJob({
            status: 'complete',
            lines: [parsed(0, '2 cups flour', 'flour'), parsed(1, '1 tsp salt', 'salt')],
        });
        rerender({ offered: true, keepsSource: true, dispatch });
        await settle();

        expect(appended(dispatch).map((line) => line.name)).toEqual(['flour', 'salt']);
    });

    it('a heading adds no row and does not hold back the line after it', async () => {
        const { result, rerender, dispatch } = render();
        act(() => result.current.submit('For the dough:\n2 cups flour'));
        accept(makeParseJob());

        mocks.job = makeParseJob({
            status: 'complete',
            lines: [
                makeParseJobLine({
                    lineIndex: 0,
                    sourceLine: 'For the dough:',
                    status: 'parsed',
                    proposal: makeParseProposal({ foods: [] }),
                }),
                parsed(1, '2 cups flour', 'flour'),
            ],
        });
        rerender({ offered: true, keepsSource: true, dispatch });
        await settle();

        expect(appended(dispatch).map((line) => line.name)).toEqual(['flour']);
    });

    it('once every line has joined: nothing reads, the count is said, and paste is offered again', async () => {
        const { result, rerender, dispatch } = render();
        act(() => result.current.submit('2 cups flour\n1 tsp salt'));
        accept(makeParseJob());

        mocks.job = makeParseJob({
            status: 'complete',
            lines: [parsed(0, '2 cups flour', 'flour'), parsed(1, '1 tsp salt', 'salt')],
        });
        rerender({ offered: true, keepsSource: true, dispatch });
        await settle();

        expect(result.current.reading).toEqual([]);
        expect(result.current.added).toEqual({ count: 2, occurrence: 1 });
        expect(result.current.available).toBe(true);
    });
});

describe('usePasteIntoIngredients — a lookup that fails', () => {
    it('marks its row failed and holds the lines after it; Try again asks again and the rest follow', async () => {
        mocks.byName.mockRejectedValueOnce(new Error('down'));
        const { result, rerender, dispatch } = render();
        act(() => result.current.submit('2 cups flour\n1 tsp salt'));
        accept(makeParseJob());

        mocks.job = makeParseJob({
            status: 'complete',
            lines: [parsed(0, '2 cups flour', 'flour'), parsed(1, '1 tsp salt', 'salt')],
        });
        rerender({ offered: true, keepsSource: true, dispatch });
        await settle();

        expect(result.current.reading.map((row) => [row.sourceLine, row.state])).toEqual([
            ['2 cups flour', 'failed'],
            ['1 tsp salt', 'reading'],
        ]);
        expect(appended(dispatch)).toEqual([]);

        act(() => result.current.retry());
        await settle();

        expect(appended(dispatch).map((line) => line.name)).toEqual(['flour', 'salt']);
    });
});

describe('usePasteIntoIngredients — no row reads for good', () => {
    it('⛔ a line still pending past the stall bound joins through the add field’s reader', async () => {
        vi.useFakeTimers({ now: FIXTURE_NOW });
        const { result, rerender, dispatch } = render();
        act(() => result.current.submit('2 tbsp olive oil, for frying'));
        accept(makeParseJob({ lines: [makeParseJobLine({ sourceLine: '2 tbsp olive oil, for frying' })] }));

        act(() => {
            vi.advanceTimersByTime(PASTE_STALL_BOUND_MS + 1);
        });
        rerender({ offered: true, keepsSource: true, dispatch });
        await settle();

        expect(mocks.byName).toHaveBeenCalledWith('olive oil');
        expect(appended(dispatch)).toEqual([
            // The unit as the cook typed it ("tbsp"), the same on every path that settles a line (F12).
            expect.objectContaining({ quantity: 2, unit: 'tbsp', preparation: 'for frying' }),
        ]);
        expect(appended(dispatch)[0]).not.toHaveProperty('sourcePhrase');
    });

    it('a job that cannot be read joins every line through the reader', async () => {
        const { result, rerender, dispatch } = render();
        act(() => result.current.submit('2 cups flour'));
        accept(makeParseJob());

        mocks.jobError = true;
        rerender({ offered: true, keepsSource: true, dispatch });
        await settle();

        expect(appended(dispatch).map((line) => line.name)).toEqual(['flour']);
    });
});

/**
 * Offline (finding 11). The by-name lookups are mutations that PAUSE without a connection and resume on reconnect (the
 * behaviour kept); the rows then say they will finish when the device is back online, rather than reading "Reading…"
 * while Publish waits on them for no reason the cook can see. The state comes from the mutation's own `isPaused`, never
 * from a connectivity read (build spec: screens do not branch on connectivity).
 */
describe('usePasteIntoIngredients — offline', () => {
    afterEach(() => {
        onlineManager.setOnline(true);
    });

    it('a join paused for want of a connection says so on every row still joining, then finishes on reconnect', async () => {
        const { result, rerender, dispatch } = render();
        act(() => result.current.submit('2 cups flour\n1 tsp salt'));
        accept(makeParseJob());

        act(() => {
            onlineManager.setOnline(false);
        });
        mocks.job = makeParseJob({
            status: 'complete',
            lines: [parsed(0, '2 cups flour', 'flour'), parsed(1, '1 tsp salt', 'salt')],
        });
        rerender({ offered: true, keepsSource: true, dispatch });
        await settle();

        expect(appended(dispatch)).toEqual([]);
        expect(result.current.reading.map((row) => row.state)).toEqual(['waiting', 'waiting']);

        act(() => {
            onlineManager.setOnline(true);
        });
        await settle();

        expect(appended(dispatch).map((line) => line.name)).toEqual(['flour', 'salt']);
        expect(result.current.reading).toEqual([]);
    });
});
