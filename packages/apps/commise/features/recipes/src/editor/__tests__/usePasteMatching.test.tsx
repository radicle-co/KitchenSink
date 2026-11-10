/**
 * Tests for {@link usePasteMatching} — the Mediator between the paste's session, recipe-service's matches and the draft
 * (blueprint A2; ADR-0071; owner rulings 2026-10-25). Written from the blueprint and the rulings, seen red first.
 *
 * What is pinned (each is a ruling or a failure mode, not a path through the code):
 * - `POST /matches` is asked for once per GROWTH of the unmatched set, never on every poll, and a food a call left unmade
 *   is asked for again at most three calls (a down service must not be a storm);
 * - a line joins in paste order and only after its match arrived; ONLY a confident match binds, by the food it names; a
 *   default, a doubtful or an unmatched line joins AS WRITTEN and is never selected for the cook;
 * - a checking line that later reads confident, with no cook binding, binds to the food the review confirmed — and a late
 *   verdict NEVER replaces a pick the cook made;
 * - a cook's pick goes through the one commit port by the food's kind, raises its pending send inside the press, shows
 *   its failure, and Try again REPEATS the attempt that failed;
 * - a line the cook deletes is never joined again.
 *
 * The recipe service's hooks and the commit port are doubles; the specifications (`pasteJoin`, `matchRequests`, the
 * session reducer, the adapter) are the real ones.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import type { ParseJobResponse } from '@kitchensink/schema-recipe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    makeParseCandidate,
    makeParseJob,
    makeParseJobLine,
    makeParseMatch,
    makeParseProposal,
    makeParseProposalFood,
} from '../../__fixtures__/parseJobs.js';
import type { DraftAction } from '../../form/draftAction.js';
import { mintLineKey } from '../../form/mintLineKey.js';
import type { LineCommitOutcome, IngredientPick } from '../../hooks/lineCommit.js';
import { MAX_MATCH_ATTEMPTS } from '../matchRequests.js';
import { pastedLinesOf } from '../pastedLines.js';

const mocks = vi.hoisted(() => ({
    propose: vi.fn(),
    byFood: vi.fn(),
    byVariant: vi.fn(),
    create: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useProposeParseJobMatches: () => ({ mutate: mocks.propose, isPaused: false }),
    useAddIngredientByFood: () => ({ mutateAsync: mocks.byFood, isPaused: false }),
    useAddIngredientByFoodVariant: () => ({ mutateAsync: mocks.byVariant, isPaused: false }),
    useCreateIngredient: () => ({ mutateAsync: mocks.create, isPaused: false }),
}));

import { usePasteMatching, type UsePasteMatchingOptions } from '../usePasteMatching.js';

const JOB_ID = makeParseJob().id;
const OAT = makeParseCandidate({ id: 'oat', name: 'Oat milk' });

const ingredientOf = (id: string, name: string) => ({
    id,
    name,
    foodId: `food_${id}`,
    foodResolutionStatus: 'RESOLVED',
    isUserEntered: false,
    createdAt: '2026-10-09T10:00:01.000Z',
});

const milkLine = (match: ReturnType<typeof makeParseMatch> | null | undefined, lineIndex = 0) =>
    makeParseJobLine({
        lineIndex,
        sourceLine: '2 cups milk',
        status: 'parsed',
        proposal: makeParseProposal({
            raw: '2 cups milk',
            foods: [makeParseProposalFood({ name: 'milk', ...(match === undefined ? {} : { match }) })],
        }),
    });

const jobOf = (...lines: ReturnType<typeof milkLine>[]) => makeParseJob({ status: 'complete', lines });

interface Harness {
    readonly paste: { current: UsePasteMatchingOptions['paste'] };
    readonly dispatch: ReturnType<typeof vi.fn<(action: DraftAction) => void>>;
    readonly markJoined: ReturnType<typeof vi.fn>;
    readonly pickOnLine: ReturnType<typeof vi.fn<(key: string, pick: IngredientPick) => Promise<LineCommitOutcome>>>;
}

function setup(job: ParseJobResponse, over: Partial<UsePasteMatchingOptions> = {}, strict = false) {
    const markJoined = vi.fn();
    const dispatch = vi.fn<(action: DraftAction) => void>();
    const pickOnLine = vi.fn<(key: string, pick: IngredientPick) => Promise<LineCommitOutcome>>();
    const state = {
        job,
        joined: new Set<number>(),
        failedAt: undefined as number | undefined,
        lineKeys: [] as string[],
        // The paste's session ends with its last line; the job, and the cook's sends on it, go on.
        sessionEnded: false,
        matchesGone: false,
        settled: undefined as UsePasteMatchingOptions['settled'],
    };

    pickOnLine.mockResolvedValue({
        kind: 'committed',
        key: 'x' as never,
        binding: { ingredientId: 'i', isUserEntered: false },
    });

    const optionsOf = (): UsePasteMatchingOptions => ({
        paste: {
            jobId: state.job.id,
            job: state.job,
            sessionKey: state.sessionEnded ? undefined : state.job.id,
            lines: pastedLinesOf({ job: state.job, jobFailed: false, now: 0, typedByCook: new Set() }).filter(
                (line) => !state.joined.has(line.lineIndex),
            ),
            joined: state.joined,
            failedAt: state.failedAt,
            matchesGone: state.matchesGone,
            markJoined: (key, lineIndex, rows) => {
                markJoined(key, lineIndex, rows);
                state.joined = new Set([...state.joined, lineIndex]);
            },
            markJoinFailed: vi.fn(),
        },
        keepsSource: true,
        dispatch: (action) => {
            dispatch(action);

            if (action.kind === 'appendResolvedIngredient') {
                state.lineKeys = [...state.lineKeys, action.key];
            }
        },
        pickOnLine,
        lineKeys: state.lineKeys,
        autoBind: true,
        searching: new Set(),
        settled: state.settled,
        beginSearch: vi.fn(),
        reviewReasonOf: (reason) => `because ${reason}`,
        ...over,
    });
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const hook = renderHook(() => usePasteMatching(optionsOf()), {
        wrapper: ({ children }) => {
            const provided = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

            return strict ? <StrictMode>{provided}</StrictMode> : provided;
        },
    });

    return {
        ...hook,
        state,
        dispatch,
        markJoined,
        pickOnLine,
        /** A new read of the job, as the poll delivers it. */
        read: (next: ParseJobResponse) => {
            state.job = next;
            hook.rerender();
        },
        /** The cook deletes a draft line. */
        remove: (key: string) => {
            state.lineKeys = state.lineKeys.filter((each) => each !== key);
            hook.rerender();
        },
    };
}

/** Let every queued mutation settle. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 4; turn += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
}

const appended = (dispatch: Harness['dispatch']) =>
    dispatch.mock.calls.flatMap(([action]) => (action.kind === 'appendResolvedIngredient' ? [action] : []));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.byFood.mockImplementation(async (id: string) => ingredientOf(id, id));
    mocks.byVariant.mockImplementation(async (id: string) => ingredientOf(id, id));
    mocks.create.mockImplementation(async (name: string) => ingredientOf(`free_${name}`, name));
});

describe('usePasteMatching — asking for matches (ADR-0071 section 4, 6)', () => {
    it('⛔ asks once for a food with no match, and not again while the call is in flight', async () => {
        const { rerender, read } = setup(jobOf(milkLine(undefined)));
        await settle();

        expect(mocks.propose).toHaveBeenCalledTimes(1);
        expect(mocks.propose).toHaveBeenCalledWith(JOB_ID, expect.any(Object));

        read(jobOf(milkLine(undefined)));
        rerender();
        await settle();

        expect(mocks.propose).toHaveBeenCalledTimes(1);
    });

    it('does not ask for a food that already has a match, even a checking one: the poll refreshes it', async () => {
        setup(jobOf(milkLine(makeParseMatch({ state: 'checking' }))));
        await settle();

        expect(mocks.propose).not.toHaveBeenCalled();
    });

    it('asks again for a food the call left unmade, up to three calls, then leaves it to Try again', async () => {
        const hook = setup(jobOf(milkLine(undefined)));

        for (let call = 1; call <= 4; call += 1) {
            await settle();
            const [, options] = (mocks.propose.mock.calls.at(-1) ?? []) as [
                string,
                { onSuccess?: (job: ParseJobResponse) => void },
            ];

            act(() => options?.onSuccess?.(jobOf(milkLine(undefined))));
            hook.rerender();
        }

        await settle();

        expect(mocks.propose).toHaveBeenCalledTimes(3);
        // Out of attempts, the food is a failed request: its line joins as written and offers Try again.
        expect(hook.result.current.lines.map((line) => line.state)).toEqual(['optionsFailed']);
    });

    it('⛔ a call that fails turns the food’s line into one whose options failed, joined as written; Try again asks again', async () => {
        mocks.propose.mockImplementation((_id: string, options: { onError?: (error: Error) => void }) =>
            options.onError?.(new Error('503')),
        );
        const hook = setup(jobOf(milkLine(undefined)));
        await settle();
        hook.rerender();
        await settle();

        expect(hook.result.current.lines.map((line) => line.state)).toEqual(['optionsFailed']);
        expect(mocks.create).toHaveBeenCalledWith('milk');
        expect(mocks.propose).toHaveBeenCalledTimes(1);

        mocks.propose.mockReset();
        act(() => hook.result.current.retryOptions('0:0'));
        await settle();

        expect(mocks.propose).toHaveBeenCalledTimes(1);
    });
});

describe('usePasteMatching — joining in paste order', () => {
    it('⛔ waits for the match: nothing joins while the food has none', async () => {
        const { dispatch } = setup(jobOf(milkLine(undefined)));
        await settle();

        expect(appended(dispatch)).toEqual([]);
        expect(mocks.byFood).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('⛔ a confident match binds the food it names by food admission, never by name, and keeps what it was read from', async () => {
        const { dispatch, markJoined, result } = setup(jobOf(milkLine(makeParseMatch({ candidates: [OAT] }))));
        await settle();

        expect(mocks.byFood).toHaveBeenCalledExactlyOnceWith('whole');
        expect(mocks.create).not.toHaveBeenCalled();
        const [line] = appended(dispatch);

        expect(line?.line).toMatchObject({
            ingredientId: 'whole',
            quantity: 2,
            unit: 'cups',
            sourceLine: '2 cups milk',
            sourcePhrase: 'milk',
        });
        expect(markJoined).toHaveBeenCalledExactlyOnceWith(JOB_ID, 0, 1);
        expect(result.current.lines).toMatchObject([
            { key: '0:0', state: 'confident', binding: { boundBy: 'server', pick: { kind: 'food', foodId: 'whole' } } },
        ]);
    });

    it('the draft line carries the cook’s words (displayText) and the note the parse kept, and the food it is bound to', async () => {
        const job = jobOf(
            makeParseJobLine({
                lineIndex: 0,
                sourceLine: '1 (9 inch) double-crust pie pastry',
                status: 'parsed',
                proposal: makeParseProposal({
                    raw: '1 (9 inch) double-crust pie pastry',
                    statedMeasure: null,
                    quantity: { kind: 'exact', value: 1 },
                    unit: null,
                    foods: [
                        makeParseProposalFood({
                            name: 'double-crust pie pastry',
                            display: 'written',
                            match: makeParseMatch({ candidates: [OAT] }),
                        }),
                    ],
                }),
            }),
        );
        const { dispatch } = setup(job);
        await settle();

        const [line] = appended(dispatch);

        expect(line?.line).toMatchObject({
            ingredientId: 'whole',
            displayText: 'double-crust pie pastry',
            note: '9 inch',
        });
    });

    it('a proposed VARIANT binds through the variant admission', async () => {
        setup(
            jobOf(
                milkLine(makeParseMatch({ proposed: { kind: 'variant', id: 'v-1', name: 'Oat milk, unsweetened' } })),
            ),
        );
        await settle();

        expect(mocks.byVariant).toHaveBeenCalledExactlyOnceWith('v-1');
        expect(mocks.byFood).not.toHaveBeenCalled();
    });

    it.each(['default', 'needsChoice', 'noMatch'] as const)(
        '⛔ a %s match joins as written and is bound to NOTHING (ADR-0070 section 5: a default is never selected)',
        async (state) => {
            const match = makeParseMatch({
                state,
                proposed: null,
                candidates: [makeParseCandidate({ isDefault: true })],
            });
            const { dispatch, result } = setup(jobOf(milkLine(match)));
            await settle();

            expect(mocks.create).toHaveBeenCalledExactlyOnceWith('milk');
            expect(mocks.byFood).not.toHaveBeenCalled();
            expect(mocks.byVariant).not.toHaveBeenCalled();
            expect(appended(dispatch)).toHaveLength(1);
            expect(result.current.lines[0]?.binding).toBeUndefined();
        },
    );

    it('a checking match joins as written too, and is drawn as checking', async () => {
        const { result } = setup(jobOf(milkLine(makeParseMatch({ state: 'checking' }))));
        await settle();

        expect(mocks.create).toHaveBeenCalledWith('milk');
        expect(result.current.lines).toMatchObject([{ state: 'checking', binding: undefined }]);
    });

    it('lines join one at a time, in paste order', async () => {
        const second = makeParseJobLine({
            lineIndex: 1,
            sourceLine: '1 tsp salt',
            status: 'parsed',
            proposal: makeParseProposal({
                raw: '1 tsp salt',
                foods: [
                    makeParseProposalFood({
                        name: 'salt',
                        match: makeParseMatch({ proposed: { kind: 'root', id: 'tsalt', name: 'Table salt' } }),
                    }),
                ],
            }),
        });
        const { dispatch, markJoined, rerender } = setup(jobOf(milkLine(makeParseMatch()), second));
        await settle();
        rerender();
        await settle();

        expect(markJoined.mock.calls.map(([, index]) => index)).toEqual([0, 1]);
        expect(appended(dispatch).map((action) => action.line.ingredientId)).toEqual(['whole', 'tsalt']);
    });
});

describe('usePasteMatching — a checking line that is later reviewed', () => {
    const checking = () => milkLine(makeParseMatch({ state: 'checking', reason: 'awaitingReview', candidates: [OAT] }));
    const confident = () => milkLine(makeParseMatch({ reason: 'reviewVerified', candidates: [OAT] }));

    it('⛔ binds to the food the review confirmed when nobody bound it, as a draft rebind that teaches nothing', async () => {
        const { read, dispatch, result } = setup(jobOf(checking()));
        await settle();
        dispatch.mockClear();

        read(jobOf(confident()));
        await settle();

        const [rebind] = dispatch.mock.calls.flatMap(([action]) =>
            action.kind === 'rebindIngredient' ? [action] : [],
        );

        expect(mocks.byFood).toHaveBeenCalledWith('whole');
        expect(rebind?.binding).toMatchObject({ ingredientId: 'whole' });
        expect(result.current.lines[0]).toMatchObject({
            state: 'confident',
            binding: { boundBy: 'review', pick: { kind: 'food', foodId: 'whole' } },
        });
    });

    it('⛔ NEVER replaces a pick the cook made: no admission, no rebind, and the note is derived', async () => {
        const { read, dispatch, result } = setup(jobOf(checking()));
        await settle();
        act(() => result.current.pick('0:0', { kind: 'food', foodId: 'oat', name: 'Oat milk' }));
        await settle();
        dispatch.mockClear();
        mocks.byFood.mockClear();

        read(jobOf(confident()));
        await settle();

        expect(mocks.byFood).not.toHaveBeenCalled();
        expect(dispatch.mock.calls.filter(([action]) => action.kind === 'rebindIngredient')).toEqual([]);
        expect(result.current.lines[0]?.binding).toMatchObject({
            boundBy: 'cook',
            pick: { foodId: 'oat' },
            reviewNote: { suggestedFood: 'Whole milk', reason: 'because reviewVerified' },
        });
    });

    it('does not bind when auto-binding is off (the recipe is published)', async () => {
        const { read, dispatch } = setup(jobOf(checking()), { autoBind: false });
        await settle();
        dispatch.mockClear();

        read(jobOf(confident()));
        await settle();

        expect(dispatch.mock.calls.filter(([action]) => action.kind === 'rebindIngredient')).toEqual([]);
    });

    it('a line that stays doubtful is never bound: it asks the cook', async () => {
        const doubtful = milkLine(
            makeParseMatch({ state: 'needsChoice', reason: 'reviewDoubted', proposed: null, candidates: [OAT] }),
        );
        const { read, dispatch, result } = setup(jobOf(checking()));
        await settle();
        dispatch.mockClear();

        read(jobOf(doubtful));
        await settle();

        expect(dispatch.mock.calls.filter(([action]) => action.kind === 'rebindIngredient')).toEqual([]);
        expect(result.current.lines[0]).toMatchObject({ state: 'needsChoice', binding: undefined });
    });
});

describe('usePasteMatching — an offer the server stops showing is withdrawn', () => {
    const confident = () => milkLine(makeParseMatch({ reason: 'exactName', candidates: [OAT] }));
    const asks = () =>
        milkLine(
            makeParseMatch({ state: 'needsChoice', reason: 'reviewContradicted', proposed: null, candidates: [OAT] }),
        );
    const rebinds = (dispatch: Harness['dispatch']) =>
        dispatch.mock.calls.flatMap(([action]) => (action.kind === 'rebindIngredient' ? [action] : []));

    it('⛔ unbinds a line the server bound once the wire reads needsChoice, and puts the draft line back as written', async () => {
        const { read, dispatch, result } = setup(jobOf(confident()));
        await settle();
        expect(result.current.lines[0]).toMatchObject({ state: 'confident', binding: { boundBy: 'server' } });
        dispatch.mockClear();

        read(jobOf(asks()));
        await settle();

        expect(mocks.create).toHaveBeenCalledWith('milk');
        expect(rebinds(dispatch)).toHaveLength(1);
        expect(rebinds(dispatch)[0]?.binding).toMatchObject({ ingredientId: 'free_milk' });
        expect(result.current.lines[0]).toMatchObject({ state: 'needsChoice', binding: undefined });
    });

    it.each([false, true])(
        '⛔ a withdrawal that failed is tried again in the same session, and the line goes back (strict: %s)',
        async (strict) => {
            const { read, dispatch, result } = setup(jobOf(confident()), {}, strict);
            await settle();
            dispatch.mockClear();
            mocks.create.mockRejectedValueOnce(new Error('recipe-service unreachable'));

            read(jobOf(asks()));
            await settle();

            expect(mocks.create).toHaveBeenCalledTimes(2);
            expect(rebinds(dispatch)).toHaveLength(1);
            expect(result.current.lines[0]).toMatchObject({ state: 'needsChoice', binding: undefined });
        },
    );

    it('⛔ a withdrawal that keeps failing is tried at most MAX_MATCH_ATTEMPTS times: a down service is not a storm', async () => {
        const { read, dispatch } = setup(jobOf(confident()));
        await settle();
        dispatch.mockClear();
        mocks.create.mockRejectedValue(new Error('recipe-service unreachable'));

        read(jobOf(asks()));
        await settle();
        await settle();

        expect(mocks.create).toHaveBeenCalledTimes(MAX_MATCH_ATTEMPTS);
        expect(rebinds(dispatch)).toEqual([]);
    });

    it('⛔ never touches the cook’s own pick', async () => {
        const { read, dispatch, result } = setup(jobOf(confident()));
        await settle();
        act(() => result.current.pick('0:0', { kind: 'food', foodId: 'oat', name: 'Oat milk' }));
        await settle();
        dispatch.mockClear();
        mocks.create.mockClear();

        read(jobOf(asks()));
        await settle();

        expect(mocks.create).not.toHaveBeenCalled();
        expect(rebinds(dispatch)).toEqual([]);
        expect(result.current.lines[0]?.binding).toMatchObject({ boundBy: 'cook', pick: { foodId: 'oat' } });
    });
});

describe('usePasteMatching — the cook’s pick', () => {
    const open = () =>
        milkLine(
            makeParseMatch({
                state: 'needsChoice',
                proposed: null,
                candidates: [makeParseCandidate({ isDefault: true }), OAT],
            }),
        );

    it('⛔ sends a food through the one commit port by its kind, raises its pending send in the press, and binds it as the cook’s', async () => {
        let resolve: ((outcome: LineCommitOutcome) => void) | undefined;
        const hook = setup(jobOf(open()));
        await settle();
        hook.pickOnLine.mockImplementation(
            () =>
                new Promise((done) => {
                    resolve = done;
                }),
        );

        act(() => hook.result.current.pick('0:0', { kind: 'food', foodId: 'oat', name: 'Oat milk' }));

        // Raised inside the press: this very render already refuses a second press.
        expect(hook.result.current.pending.get('0:0')).toEqual({
            kind: 'pick',
            pick: { kind: 'food', foodId: 'oat', name: 'Oat milk' },
        });
        expect(hook.pickOnLine).toHaveBeenCalledExactlyOnceWith(hook.state.lineKeys[0], {
            kind: 'catalogFood',
            foodId: 'oat',
            name: 'Oat milk',
        });

        act(() => hook.result.current.pick('0:0', { kind: 'food', foodId: 'whole', name: 'Whole milk' }));
        expect(hook.pickOnLine).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolve?.({ kind: 'committed', key: 'k' as never, binding: { ingredientId: 'i', isUserEntered: false } });
        });

        expect(hook.result.current.pending.has('0:0')).toBe(false);
        expect(hook.result.current.lines[0]?.binding).toMatchObject({ boundBy: 'cook', pick: { foodId: 'oat' } });
    });

    it('a candidate that is a VARIANT is picked as a variant', async () => {
        const variant = {
            ...makeParseCandidate({ id: 'v-9', name: 'Oat milk, unsweetened' }),
            kind: 'variant' as const,
        };
        const hook = setup(
            jobOf(milkLine(makeParseMatch({ state: 'needsChoice', proposed: null, candidates: [variant] }))),
        );
        await settle();

        act(() => hook.result.current.pick('0:0', { kind: 'food', foodId: 'v-9', name: 'Oat milk, unsweetened' }));

        expect(hook.pickOnLine).toHaveBeenCalledWith(expect.any(String), {
            kind: 'catalogVariant',
            foodVariantId: 'v-9',
        });
    });

    it('⛔ Keep as written declares the food’s own words; it binds no food', async () => {
        const hook = setup(jobOf(open()));
        await settle();

        act(() => hook.result.current.pick('0:0', { kind: 'asWritten' }));
        await settle();

        expect(hook.pickOnLine).toHaveBeenCalledWith(expect.any(String), { kind: 'declared', text: 'milk' });
        expect(hook.result.current.lines[0]?.binding).toMatchObject({ boundBy: 'cook', pick: { kind: 'asWritten' } });
    });

    it('⛔ a pick that fails says so on its line; Try again REPEATS the pick that failed, and it saves', async () => {
        const hook = setup(jobOf(open()));
        await settle();
        hook.pickOnLine.mockResolvedValueOnce({ kind: 'failed' });

        act(() => hook.result.current.pick('0:0', { kind: 'food', foodId: 'oat', name: 'Oat milk' }));
        await settle();

        expect(hook.result.current.failed.has('0:0')).toBe(true);
        expect(hook.result.current.lines[0]?.binding).toBeUndefined();

        act(() => hook.result.current.retryPick('0:0'));
        await settle();

        expect(hook.pickOnLine).toHaveBeenCalledTimes(2);
        expect(hook.pickOnLine.mock.calls[1]).toEqual(hook.pickOnLine.mock.calls[0]);
        expect(hook.result.current.failed.has('0:0')).toBe(false);
        expect(hook.result.current.lines[0]?.binding).toMatchObject({ boundBy: 'cook', pick: { foodId: 'oat' } });
    });

    it('Use this binds the food under review as the cook’s pick', async () => {
        const hook = setup(
            jobOf(milkLine(makeParseMatch({ state: 'checking', reason: 'awaitingReview', candidates: [OAT] }))),
        );
        await settle();

        act(() => hook.result.current.useProposal('0:0'));
        await settle();

        expect(hook.pickOnLine).toHaveBeenCalledWith(expect.any(String), {
            kind: 'catalogFood',
            foodId: 'whole',
            name: 'Whole milk',
        });
        expect(hook.result.current.lines[0]?.binding).toMatchObject({ boundBy: 'cook', pick: { foodId: 'whole' } });
    });

    it('marks the save with the tag its press gave it, once it saved and never before', async () => {
        const hook = setup(jobOf(open()));
        await settle();
        let resolve: ((outcome: LineCommitOutcome) => void) | undefined;

        hook.pickOnLine.mockImplementation(
            () =>
                new Promise((done) => {
                    resolve = done;
                }),
        );

        act(() => hook.result.current.pick('0:0', { kind: 'asWritten' }, 'narrow'));
        expect(hook.result.current.saved).toBeUndefined();

        await act(async () => {
            resolve?.({ kind: 'committed', key: 'k' as never, binding: { ingredientId: 'i', isUserEntered: false } });
        });

        expect(hook.result.current.saved).toMatchObject({ key: '0:0', tag: 'narrow', seq: 1 });
    });

    it('⛔ a pick that settles after a NEW job has started is dropped: its key now names another line', async () => {
        let resolve: ((outcome: LineCommitOutcome) => void) | undefined;
        const hook = setup(jobOf(open()));
        await settle();
        hook.pickOnLine.mockImplementation(
            () =>
                new Promise((done) => {
                    resolve = done;
                }),
        );

        act(() => hook.result.current.pick('0:0', { kind: 'food', foodId: 'oat', name: 'Oat milk' }));
        hook.read(
            jobOf({
                ...milkLine(makeParseMatch({ state: 'needsChoice', proposed: null, candidates: [OAT] })),
                lineIndex: 0,
            }) as never,
        );
        hook.read(
            makeParseJob({
                id: 'job-2',
                lines: [milkLine(makeParseMatch({ state: 'needsChoice', proposed: null, candidates: [OAT] }))],
            }),
        );
        await settle();
        await act(async () => {
            resolve?.({ kind: 'committed', key: 'k' as never, binding: { ingredientId: 'i', isUserEntered: false } });
        });

        expect(hook.result.current.saved).toBeUndefined();
        expect(hook.result.current.lines[0]?.binding).not.toMatchObject({ boundBy: 'cook' });
    });
});

describe('usePasteMatching — after the paste’s session has ended', () => {
    it('⛔ a pick still goes through: the job outlives the session, and so does the cook’s choice on its lines', async () => {
        const hook = setup(
            jobOf(milkLine(makeParseMatch({ state: 'needsChoice', proposed: null, candidates: [OAT] }))),
        );
        await settle();
        hook.state.sessionEnded = true;
        hook.rerender();

        act(() => hook.result.current.pick('0:0', { kind: 'food', foodId: 'oat', name: 'Oat milk' }));
        await settle();

        expect(hook.pickOnLine).toHaveBeenCalledTimes(1);
        expect(hook.result.current.lines[0]?.binding).toMatchObject({ boundBy: 'cook', pick: { foodId: 'oat' } });
    });
});

describe('usePasteMatching — the job can no longer match', () => {
    it('⛔ a food with no match joins as written and offers Try again, Search and Keep as written, not a dead Use this', async () => {
        const hook = setup(jobOf(milkLine(undefined)));

        // The job expires after its first read asked for the matches (that call is not what this is about).
        mocks.propose.mockClear();
        hook.state.matchesGone = true;
        hook.rerender();
        await settle();

        expect(mocks.create).toHaveBeenCalledWith('milk');
        expect(hook.result.current.lines.map((line) => line.state)).toEqual(['optionsFailed']);
        // The request is not made for a job that can no longer match.
        expect(mocks.propose).not.toHaveBeenCalled();
    });
});

describe('usePasteMatching — a food found through the one picker', () => {
    const NEEDS = () => milkLine(makeParseMatch({ state: 'needsChoice', proposed: null, candidates: [OAT] }));
    const committed = (draftKey: string, binding: object): UsePasteMatchingOptions['settled'] => ({
        origin: { kind: 'entry' },
        target: { kind: 'line', key: draftKey as never },
        pick: { kind: 'catalogFood', foodId: 'food_x', name: 'x' },
        outcome: { kind: 'committed', key: draftKey as never, binding: binding as never },
    });

    it('binds the line as the cook’s food, by the wire’s food id', async () => {
        const hook = setup(jobOf(NEEDS()));
        await settle();
        const [draftKey] = hook.state.lineKeys;

        hook.state.settled = committed(draftKey as string, {
            ingredientId: 'ing',
            isUserEntered: false,
            name: 'Skim milk',
            foodId: 'food_skim',
        });
        hook.rerender();

        expect(hook.result.current.lines[0]?.binding).toMatchObject({
            boundBy: 'cook',
            pick: { kind: 'food', foodId: 'food_skim', name: 'Skim milk' },
        });
    });

    it('⛔ a line the picker kept AS WRITTEN names no food: it is kept as written, not matched', async () => {
        const hook = setup(jobOf(NEEDS()));
        await settle();
        const [draftKey] = hook.state.lineKeys;

        hook.state.settled = committed(draftKey as string, { ingredientId: 'ing', isUserEntered: true, name: 'milk' });
        hook.rerender();

        expect(hook.result.current.lines[0]?.binding).toMatchObject({ boundBy: 'cook', pick: { kind: 'asWritten' } });
    });

    it('ignores a commit from another surface, a failed one, and one on a line the paste does not own', async () => {
        const hook = setup(jobOf(NEEDS()));
        await settle();
        const [draftKey] = hook.state.lineKeys;
        const food = { ingredientId: 'ing', isUserEntered: false, name: 'Skim milk', foodId: 'food_skim' };

        for (const settled of [
            { ...committed(draftKey as string, food), origin: { kind: 'shortlist' } },
            { ...committed(draftKey as string, food), outcome: { kind: 'failed' } },
            committed('n:somewhere-else', food),
        ] as UsePasteMatchingOptions['settled'][]) {
            hook.state.settled = settled;
            hook.rerender();
        }

        expect(hook.result.current.lines[0]?.binding).toBeUndefined();
    });
});

describe('usePasteMatching — Search for a food', () => {
    it('hands the line to the one food picker (Change food on its draft row)', async () => {
        const beginSearch = vi.fn();
        const hook = setup(jobOf(milkLine(makeParseMatch({ state: 'needsChoice', proposed: null }))), { beginSearch });
        await settle();

        act(() => hook.result.current.search('0:0'));

        expect(beginSearch).toHaveBeenCalledExactlyOnceWith(hook.state.lineKeys[0]);
    });

    it('⛔ a food found through it and committed binds the line as the cook’s; the line is not drawn while it searches', async () => {
        const hook = setup(jobOf(milkLine(makeParseMatch({ state: 'needsChoice', proposed: null }))));
        await settle();
        const [draftKey] = hook.state.lineKeys;

        hook.rerender();
        expect(hook.result.current.drawn).toHaveLength(1);
        expect(hook.result.current.ownedKeys).toEqual(new Set([draftKey]));
    });
});

describe('usePasteMatching — a line the cook deletes', () => {
    it('⛔ is never joined again, however the next read reads: removal is terminal', async () => {
        const hook = setup(jobOf(milkLine(makeParseMatch({ state: 'checking', reason: 'awaitingReview' }))));
        await settle();
        const [draftKey] = hook.state.lineKeys;

        hook.rerender();
        hook.remove(draftKey as string);
        await settle();

        expect(hook.result.current.lines).toEqual([]);
        expect(hook.result.current.ownedKeys.size).toBe(0);

        mocks.byFood.mockClear();
        hook.read(jobOf(milkLine(makeParseMatch({ reason: 'reviewVerified' }))));
        await settle();

        expect(mocks.byFood).not.toHaveBeenCalled();
        expect(hook.result.current.lines).toEqual([]);
    });
});

describe('usePasteMatching — a new paste starts clean', () => {
    it('a job with a new id forgets the old job’s overlay: its keys repeat from job to job', async () => {
        const hook = setup(jobOf(milkLine(makeParseMatch())));
        await settle();
        expect(hook.result.current.lines).toHaveLength(1);

        hook.read(makeParseJob({ id: 'job-2', lines: [makeParseJobLine({ lineIndex: 0 })] }));
        await settle();

        expect(hook.result.current.lines).toEqual([]);
    });
});

/** Only to keep `mintLineKey` in the import list honest: the keys the hook mints are real line keys. */
describe('usePasteMatching — keys', () => {
    it('appends under keys from the house mint', async () => {
        const hook = setup(jobOf(milkLine(makeParseMatch())));
        await settle();

        expect(hook.state.lineKeys[0]).toMatch(/^n:/u);
        expect(mintLineKey()).toMatch(/^n:/u);
    });
});

/**
 * ADDED with item 6 of the pre-push fix pass (the claim set moved from `useState` to an explicit, justified ref): under
 * StrictMode the join and the review bind still happen once each. ⚠️ Characterization, not proof of the guard: StrictMode
 * replays effects only at mount, where no join is yet due, so these pass with the guard removed. A replay of an effect
 * against unchanged deps (Fast Refresh) cannot be driven from a test.
 */
describe('usePasteMatching — an effect the framework replays', () => {
    it('⛔ joins a line once under StrictMode', async () => {
        const { dispatch, markJoined } = setup(jobOf(milkLine(makeParseMatch({ candidates: [OAT] }))), {}, true);
        await settle();

        expect(appended(dispatch)).toHaveLength(1);
        expect(markJoined).toHaveBeenCalledOnce();
        expect(mocks.byFood).toHaveBeenCalledOnce();
    });

    it('⛔ binds the review’s food once under StrictMode', async () => {
        const checking = milkLine(makeParseMatch({ state: 'checking', reason: 'awaitingReview', candidates: [OAT] }));
        const confident = milkLine(makeParseMatch({ reason: 'reviewVerified', candidates: [OAT] }));
        const { read, dispatch } = setup(jobOf(checking), {}, true);
        await settle();
        mocks.byFood.mockClear();
        dispatch.mockClear();

        read(jobOf(confident));
        await settle();

        expect(mocks.byFood).toHaveBeenCalledOnce();
        expect(dispatch.mock.calls.filter(([action]) => action.kind === 'rebindIngredient')).toHaveLength(1);
    });
});
