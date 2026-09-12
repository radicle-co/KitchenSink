/**
 * Tests for {@link useLineCommit} — the Strategy (`commitRouteFor`) over the Commands (the TanStack mutations) that
 * carry one pick onto one line (`docs/design/rowEditorBlueprint.md` decision 7).
 *
 * Every route is driven: each surface (create form, edit form) × the command and draft strategies × each
 * pick kind's admission, plus failure, conflict and one-commit-per-target. The client hooks are mocked (their own
 * behaviour is the client package's); the routing, the draft transitions and the bindings are the real ones.
 */
import { act, renderHook } from '@testing-library/react';
import { FoodResolutionStatus, type Ingredient } from '@kitchensink/recipe-core';
import { makeIngredient, makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
    FetchUnavailableError,
    RemoteFoodGoneError,
    RequesterLimitReachedError,
    SourceBusyError,
} from '@kitchensink/food-service-client';

import { isIngredientLineKey, mintedLineKey, seedLineKey } from '../../form/lineKey.js';
import type { DraftAction } from '../../form/draftAction.js';
import type {
    IngredientPick,
    LineCommandOutcome,
    LineCommandPort,
    LineCommandSend,
    LineCommitOutcome,
    LineCommitTarget,
} from '../lineCommit.js';

const mocks = vi.hoisted(() => ({
    byFood: vi.fn(),
    byFoodVariant: vi.fn(),
    byName: vi.fn(),
    createFreeform: vi.fn(),
    rebind: vi.fn(),
    adopt: vi.fn(),
    paused: { byFood: false, rebind: false, adopt: false },
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useAddIngredientByFood: () => ({ mutateAsync: mocks.byFood, isPaused: mocks.paused.byFood }),
    useAddIngredientByFoodVariant: () => ({ mutateAsync: mocks.byFoodVariant, isPaused: false }),
    useAddIngredientByName: () => ({ mutateAsync: mocks.byName, isPaused: false }),
    useCreateIngredient: () => ({ mutateAsync: mocks.createFreeform, isPaused: false }),
    useRebindIngredientLine: () => ({ mutateAsync: mocks.rebind, isPaused: mocks.paused.rebind }),
}));

vi.mock('@kitchensink/food-service-client/hooks', () => ({
    useAdoptRemoteFood: () => ({ mutateAsync: mocks.adopt, isPaused: mocks.paused.adopt }),
}));

import type { SourceLimit } from '../useSourceLimit.js';
import { useLineCommit, type LineCommit, type LineCommitSurface } from '../useLineCommit.js';

const STORED_KEY = seedLineKey(3, 1);
const STORED: LineCommitTarget = { kind: 'line', key: STORED_KEY };
const APPENDED: LineCommitTarget = { kind: 'line', key: mintedLineKey('appended') };
const NEW_LINE: LineCommitTarget = { kind: 'newLine' };

const CHICKPEAS = makeIngredient({
    id: '00000000-0000-4000-8000-0000000000c1',
    name: 'Chickpeas',
    foodId: 'food_chickpea',
    foodResolutionStatus: FoodResolutionStatus.RESOLVED,
});

/** The binding a draft re-point carries for `ingredient` (`lineBindingOf(toIngredientLine(…))`). */
const bindingOf = (ingredient: Ingredient) => ({
    ingredientId: ingredient.id,
    name: ingredient.name,
    isUserEntered: ingredient.isUserEntered,
    ...(ingredient.foodResolutionStatus === undefined ? {} : { resolutionStatus: ingredient.foodResolutionStatus }),
    ...(ingredient.foodId === undefined ? {} : { foodId: ingredient.foodId }),
    ...(ingredient.variant === undefined ? {} : { variant: ingredient.variant }),
});

/** A command port double: stores `STORED_KEY` at position 1, and answers each run with `outcome`. */
function commandPort(outcome: LineCommandOutcome = { kind: 'committed', binding: bindingOf(CHICKPEAS) }) {
    const sends: LineCommandSend[] = [];
    const run = vi.fn(async (_key: unknown, send: LineCommandSend): Promise<LineCommandOutcome> => {
        sends.push(send);

        return outcome;
    });
    const port: LineCommandPort = { persistedKeys: [seedLineKey(3, 0), STORED_KEY], run };

    return { port, run, sends };
}

/** The tag a caller names its commits with; the hook carries it through to `settled` and reads nothing of it. */
interface TestOrigin {
    readonly surface: string;
}

const ENTRY: TestOrigin = { surface: 'entry' };

/** The session's one source limit, as the row editor holds it: none held unless a test says so. */
const limit: { retryAt: number | undefined; readonly hold: Mock<(retryAt: number) => void> } = {
    retryAt: undefined,
    hold: vi.fn(),
};

function render(surface: LineCommitSurface, sourceLimit: SourceLimit = limit) {
    return renderHook(() => useLineCommit<TestOrigin>(surface, sourceLimit));
}

async function commitThrough(
    result: { current: LineCommit<TestOrigin> },
    pick: IngredientPick,
    target: LineCommitTarget,
    origin: TestOrigin = ENTRY,
): Promise<LineCommitOutcome> {
    let outcome: LineCommitOutcome | undefined;

    await act(async () => {
        outcome = await result.current.commit(pick, target, origin);
    });

    if (outcome === undefined) {
        throw new Error('the commit did not settle');
    }

    return outcome;
}

beforeEach(() => {
    for (const mock of [
        mocks.byFood,
        mocks.byFoodVariant,
        mocks.byName,
        mocks.createFreeform,
        mocks.rebind,
        mocks.adopt,
    ]) {
        mock.mockReset();
    }

    mocks.paused.byFood = false;
    mocks.paused.rebind = false;
    mocks.paused.adopt = false;
    limit.retryAt = undefined;
    limit.hold.mockReset();
});

describe('useLineCommit — the draft strategy (create form, and lines the edit form does not store)', () => {
    it.each([
        {
            pick: { kind: 'catalogFood', foodId: 'food_chickpea', name: 'Chickpeas' },
            request: () => mocks.byFood,
            arg: 'food_chickpea',
        },
        {
            pick: { kind: 'catalogVariant', foodVariantId: 'var_flat' },
            request: () => mocks.byFoodVariant,
            arg: 'var_flat',
        },
        { pick: { kind: 'name', text: 'chickpeas' }, request: () => mocks.byName, arg: 'chickpeas' },
        { pick: { kind: 'declared', text: 'my spice mix' }, request: () => mocks.createFreeform, arg: 'my spice mix' },
    ] as const)(
        '$pick.kind is admitted by its own request, then re-points the line by key',
        async ({ pick, request, arg }) => {
            request().mockResolvedValue(CHICKPEAS);
            const dispatch = vi.fn<(action: DraftAction) => void>();
            const { result } = render({ kind: 'createForm', dispatch });

            const outcome = await commitThrough(result, pick, STORED);

            expect(request()).toHaveBeenCalledWith(arg);
            expect(dispatch).toHaveBeenCalledWith({
                kind: 'rebindIngredient',
                key: STORED_KEY,
                binding: bindingOf(CHICKPEAS),
            });
            expect(outcome).toEqual({ kind: 'committed', key: STORED_KEY, binding: bindingOf(CHICKPEAS) });
            expect(mocks.rebind).not.toHaveBeenCalled();
        },
    );

    it('the trailing row APPENDS the line under a newly minted key, and the outcome names that key', async () => {
        mocks.byFood.mockResolvedValue(CHICKPEAS);
        const dispatch = vi.fn<(action: DraftAction) => void>();
        const { result } = render({ kind: 'createForm', dispatch });

        const outcome = await commitThrough(
            result,
            { kind: 'catalogFood', foodId: 'food_chickpea', name: 'Chickpeas' },
            NEW_LINE,
        );

        const [action] = dispatch.mock.calls[0] ?? [];
        expect(action).toMatchObject({
            kind: 'appendResolvedIngredient',
            line: { ingredientId: CHICKPEAS.id, name: 'Chickpeas', foodId: 'food_chickpea', quantity: 1 },
        });
        const key = action?.kind === 'appendResolvedIngredient' ? action.key : undefined;
        expect(key !== undefined && isIngredientLineKey(key) && key.startsWith('n:')).toBe(true);
        expect(outcome).toEqual({ kind: 'committed', key, binding: bindingOf(CHICKPEAS) });
    });

    it('an UNRESOLVED admission is committed as it is: the row offers the choice later', async () => {
        const unresolved = makeIngredient({
            id: CHICKPEAS.id,
            name: 'chick',
            foodId: undefined,
            foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
        });
        mocks.byName.mockResolvedValue(unresolved);
        const dispatch = vi.fn<(action: DraftAction) => void>();
        const { result } = render({ kind: 'createForm', dispatch });

        const outcome = await commitThrough(result, { kind: 'name', text: 'chick' }, NEW_LINE);

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(outcome).toMatchObject({ kind: 'committed', binding: { resolutionStatus: 'UNRESOLVED' } });
    });

    it('a refused admission changes nothing', async () => {
        mocks.byFood.mockRejectedValue(new Error('down'));
        const dispatch = vi.fn<(action: DraftAction) => void>();
        const { result } = render({ kind: 'createForm', dispatch });

        const outcome = await commitThrough(
            result,
            { kind: 'catalogFood', foodId: 'food_chickpea', name: 'Chickpeas' },
            STORED,
        );

        expect(outcome).toEqual({ kind: 'failed' });
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('useLineCommit — the command strategy (a STORED line on the edit form)', () => {
    it.each([
        {
            case: 'a details variant',
            pick: { kind: 'catalogVariant', foodVariantId: 'var_flat' },
            target: { kind: 'catalogVariant', foodVariantId: 'var_flat' },
        },
        {
            case: 'Remove details, a catalog rebind to the root',
            pick: { kind: 'catalogFood', foodId: 'food_brisket', name: 'Brisket' },
            target: { kind: 'catalogFood', foodId: 'food_brisket' },
        },
        {
            case: 'a typed name',
            pick: { kind: 'name', text: 'chickpeas' },
            target: { kind: 'name', name: 'chickpeas' },
        },
    ] as const)('$case goes through the editor’s command, sent as the rebind request', async ({ pick, target }) => {
        mocks.rebind.mockResolvedValue(makeRecipeDetail());
        const dispatch = vi.fn<(action: DraftAction) => void>();
        const command = commandPort();
        const { result } = render({ kind: 'editForm', dispatch, command: command.port });

        const outcome = await commitThrough(result, pick, STORED);

        expect(command.run).toHaveBeenCalledWith(STORED_KEY, expect.any(Function));
        // The editor supplies the address when it sends; this hook supplies the target.
        await command.sends[0]?.({ recipeId: 'rec_1', position: 1, expectedVersion: 7 });
        expect(mocks.rebind).toHaveBeenCalledWith({ id: 'rec_1', position: 1, body: { expectedVersion: 7, target } });
        expect(outcome).toEqual({ kind: 'committed', key: STORED_KEY, binding: bindingOf(CHICKPEAS) });
        // The editor adopts the result; neither an admission nor a draft transition is issued here.
        expect(dispatch).not.toHaveBeenCalled();
        expect(mocks.byFood).not.toHaveBeenCalled();
        expect(mocks.byFoodVariant).not.toHaveBeenCalled();
    });

    it.each([{ kind: 'conflict' }, { kind: 'failed' }] as const)(
        'a command that ends $kind is reported as such',
        async (end) => {
            const command = commandPort(end);
            const { result } = render({ kind: 'editForm', dispatch: vi.fn(), command: command.port });

            expect(await commitThrough(result, { kind: 'catalogVariant', foodVariantId: 'var_flat' }, STORED)).toEqual(
                end,
            );
        },
    );

    it.each([
        { case: 'a declaration on a stored line', pick: { kind: 'declared', text: 'my spice mix' }, target: STORED },
        {
            case: 'a line added this session',
            pick: { kind: 'catalogFood', foodId: 'food_chickpea', name: 'Chickpeas' },
            target: APPENDED,
        },
    ] as const)('$case stays a draft transition on the edit form', async ({ pick, target }) => {
        mocks.createFreeform.mockResolvedValue(CHICKPEAS);
        mocks.byFood.mockResolvedValue(CHICKPEAS);
        const dispatch = vi.fn<(action: DraftAction) => void>();
        const command = commandPort();
        const { result } = render({ kind: 'editForm', dispatch, command: command.port });

        await commitThrough(result, pick, target);

        expect(command.run).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledTimes(1);
    });
});

describe('useLineCommit — one commit per target', () => {
    it('refuses a second commit on a target whose first is in flight, knows the pick in flight, and lets another target proceed', async () => {
        let answer: ((ingredient: Ingredient) => void) | undefined;
        mocks.byFood.mockImplementationOnce(
            () =>
                new Promise<Ingredient>((resolve) => {
                    answer = resolve;
                }),
        );
        mocks.byName.mockResolvedValue(CHICKPEAS);
        const dispatch = vi.fn<(action: DraftAction) => void>();
        const { result } = render({ kind: 'createForm', dispatch });
        let first: Promise<LineCommitOutcome> | undefined;

        act(() => {
            first = result.current.commit(
                { kind: 'catalogFood', foodId: 'food_chickpea', name: 'Chickpeas' },
                NEW_LINE,
                { surface: 'details' },
            );
        });

        // The row reads the pick in flight (it replaced `isCommitting`) to say what it is doing.
        expect(result.current.inFlightPick(NEW_LINE)).toEqual({
            kind: 'catalogFood',
            foodId: 'food_chickpea',
            name: 'Chickpeas',
        });
        expect(result.current.inFlightPick(STORED)).toBeUndefined();
        expect(await commitThrough(result, { kind: 'name', text: 'again' }, NEW_LINE)).toEqual({ kind: 'busy' });
        expect(mocks.byName).not.toHaveBeenCalled();
        // A refusal is not a commit: nothing settled, and the first pick is still the one in flight.
        expect(result.current.settled).toBeUndefined();
        expect(result.current.inFlightPick(NEW_LINE)).toMatchObject({ kind: 'catalogFood' });
        expect(await commitThrough(result, { kind: 'name', text: 'chickpeas' }, STORED)).toMatchObject({
            kind: 'committed',
        });

        await act(async () => {
            answer?.(CHICKPEAS);
            await first;
        });

        expect(result.current.inFlightPick(NEW_LINE)).toBeUndefined();
        // The settled commit carries the tag its caller named it with.
        expect(result.current.settled).toEqual({
            origin: { surface: 'details' },
            target: NEW_LINE,
            pick: { kind: 'catalogFood', foodId: 'food_chickpea', name: 'Chickpeas' },
            outcome: expect.objectContaining({ kind: 'committed' }),
        });
    });
});

describe('useLineCommit — a commit that cannot run now', () => {
    it('a commit whose request throws ends `failed`, and the field no longer reads busy', async () => {
        const dispatch = vi.fn<(action: DraftAction) => void>();
        const command: LineCommandPort = { persistedKeys: [STORED_KEY], run: () => Promise.reject(new Error('lost')) };
        const { result } = render({ kind: 'editForm', dispatch, command });

        const outcome = await commitThrough(result, { kind: 'catalogVariant', foodVariantId: 'var_flat' }, STORED);

        expect(outcome).toEqual({ kind: 'failed' });
        expect(result.current.inFlightPick(STORED)).toBeUndefined();
    });

    it.each([
        { case: 'an admission', paused: { byFood: true, rebind: false, adopt: false } },
        { case: 'the rebind command', paused: { byFood: false, rebind: true, adopt: false } },
        { case: 'a remote pick’s adopt', paused: { byFood: false, rebind: false, adopt: true } },
    ])('reads paused while $case waits for a connection, so a row can say offline rather than busy', ({ paused }) => {
        mocks.paused.byFood = paused.byFood;
        mocks.paused.rebind = paused.rebind;
        mocks.paused.adopt = paused.adopt;

        expect(render({ kind: 'createForm', dispatch: vi.fn() }).result.current.paused).toBe(true);
    });

    it('is not paused otherwise', () => {
        expect(render({ kind: 'createForm', dispatch: vi.fn() }).result.current.paused).toBe(false);
    });
});

/**
 * ADR-0055 point 10 and the S7 list contract P8: a remote pick is ONE command of this port. Food adopts the hit into a
 * catalog root, and the line is then committed with that root as a `catalogFood` pick, by the route
 * `commitRouteFor` chooses, so a stored line is re-pointed by the rebind command and a draft line by its admission.
 */
describe('useLineCommit — a remote pick', () => {
    const REMOTE: IngredientPick = {
        kind: 'remoteFood',
        reference: 'sealed.g',
        name: 'Garbanzo beans, raw',
        source: 'usda',
    };

    it('adopts the hit, then admits its root on a draft line by id, under the name it was shown with', async () => {
        const dispatch = vi.fn<(action: DraftAction) => void>();
        mocks.adopt.mockResolvedValue({ id: 'food_garbanzo' });
        mocks.byFood.mockResolvedValue(CHICKPEAS);
        const { result } = render({ kind: 'createForm', dispatch });

        const outcome = await commitThrough(result, REMOTE, NEW_LINE);

        expect(mocks.adopt).toHaveBeenCalledWith('sealed.g');
        expect(mocks.byFood).toHaveBeenCalledWith('food_garbanzo');
        expect(outcome).toMatchObject({ kind: 'committed', binding: bindingOf(CHICKPEAS) });
        expect(result.current.settled?.pick).toEqual(REMOTE);
    });

    it('adopts the hit, then re-points a STORED line with the rebind command, never a plain save', async () => {
        const dispatch = vi.fn<(action: DraftAction) => void>();
        const { port, run, sends } = commandPort();
        mocks.adopt.mockResolvedValue({ id: 'food_garbanzo' });
        mocks.rebind.mockResolvedValue(makeRecipeDetail());
        const { result } = render({ kind: 'editForm', dispatch, command: port });

        await commitThrough(result, REMOTE, STORED);
        await sends[0]?.({ recipeId: 'recipe_1', position: 1, expectedVersion: 4 });

        expect(run).toHaveBeenCalledTimes(1);
        expect(mocks.rebind).toHaveBeenCalledWith({
            id: 'recipe_1',
            position: 1,
            body: { expectedVersion: 4, target: { kind: 'catalogFood', foodId: 'food_garbanzo' } },
        });
        expect(mocks.byFood).not.toHaveBeenCalled();
    });

    it('holds the REMOTE pick in flight until the line commits, so its row can say where it is adding from', async () => {
        let adopted: (value: { id: string }) => void = () => undefined;
        mocks.adopt.mockReturnValue(
            new Promise((resolve) => {
                adopted = resolve;
            }),
        );
        mocks.byFood.mockResolvedValue(CHICKPEAS);
        const { result } = render({ kind: 'createForm', dispatch: vi.fn() });
        let settled: Promise<LineCommitOutcome> | undefined;

        act(() => {
            settled = result.current.commit(REMOTE, NEW_LINE, ENTRY);
        });

        expect(result.current.inFlightPick(NEW_LINE)).toEqual(REMOTE);

        await act(async () => {
            adopted({ id: 'food_garbanzo' });
            await settled;
        });

        expect(result.current.inFlightPick(NEW_LINE)).toBeUndefined();
    });

    it.each<[string, unknown, LineCommitOutcome]>([
        ['food refused the item (`409`)', new RemoteFoodGoneError('gone'), { kind: 'remoteGone' }],
        ['the source is busy (`503`)', new SourceBusyError(2), { kind: 'sourceBusy' }],
        ['no answer', new FetchUnavailableError(), { kind: 'failed' }],
        ['anything else', new Error('down'), { kind: 'failed' }],
    ])('ends with nothing committed when %s', async (_case, refusal, expected) => {
        const dispatch = vi.fn<(action: DraftAction) => void>();
        mocks.adopt.mockRejectedValue(refusal);
        const { result } = render({ kind: 'createForm', dispatch });

        await expect(commitThrough(result, REMOTE, NEW_LINE)).resolves.toEqual(expected);
        expect(mocks.byFood).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('ends `limited` with the minute the cook’s limit ends when the adopt is refused for it (`429`)', async () => {
        vi.useFakeTimers({ now: Date.UTC(2026, 9, 2, 12, 0, 10) });
        mocks.adopt.mockRejectedValue(new RequesterLimitReachedError(600));
        const { result } = render({ kind: 'createForm', dispatch: vi.fn() });

        const outcome = await commitThrough(result, REMOTE, NEW_LINE);

        expect(outcome).toEqual({ kind: 'limited', retryAt: Date.UTC(2026, 9, 2, 12, 11, 0) });
        vi.useRealTimers();
    });

    it('ends `failed` when the line’s own commit fails after the adopt', async () => {
        mocks.adopt.mockResolvedValue({ id: 'food_garbanzo' });
        mocks.byFood.mockRejectedValue(new Error('refused'));
        const { result } = render({ kind: 'createForm', dispatch: vi.fn() });

        await expect(commitThrough(result, REMOTE, NEW_LINE)).resolves.toEqual({ kind: 'failed' });
    });
});

/** The S7 list contract P8 and item 10: the cook's own limit stops a remote pick before it asks, and says so again. */
describe('useLineCommit — a remote pick and the cook’s limit', () => {
    const REMOTE: IngredientPick = {
        kind: 'remoteFood',
        reference: 'sealed.g',
        name: 'Garbanzo beans, raw',
        source: 'usda',
    };

    it('holds the session’s limit when the adopt is refused for it', async () => {
        mocks.adopt.mockRejectedValue(new RequesterLimitReachedError(60));
        const { result } = render({ kind: 'createForm', dispatch: vi.fn() });

        const outcome = await commitThrough(result, REMOTE, NEW_LINE);

        expect(limit.hold).toHaveBeenCalledWith(outcome.kind === 'limited' ? outcome.retryAt : Number.NaN);
    });

    it('makes no request while the limit stands, settles `limited`, and counts each refused press', async () => {
        const held: SourceLimit = { retryAt: Date.now() + 60_000, hold: vi.fn() };
        const { result } = render({ kind: 'createForm', dispatch: vi.fn() }, held);

        await commitThrough(result, REMOTE, NEW_LINE);
        const outcome = await commitThrough(result, REMOTE, NEW_LINE);

        expect(mocks.adopt).not.toHaveBeenCalled();
        expect(outcome).toEqual({ kind: 'limited', retryAt: held.retryAt });
        expect(result.current.settled).toMatchObject({ pick: REMOTE, outcome: { kind: 'limited' } });
        expect(result.current.limitRefusals).toBe(2);
    });

    it('still commits a pick of our own database while the limit stands: it spends no lookup', async () => {
        const held: SourceLimit = { retryAt: Date.now() + 60_000, hold: vi.fn() };
        mocks.byFood.mockResolvedValue(CHICKPEAS);
        const { result } = render({ kind: 'createForm', dispatch: vi.fn() }, held);

        const outcome = await commitThrough(
            result,
            { kind: 'catalogFood', foodId: 'food_cp', name: 'Chickpeas' },
            NEW_LINE,
        );

        expect(outcome.kind).toBe('committed');
        expect(result.current.limitRefusals).toBe(0);
    });
});
