/**
 * Tests for {@link useIngredientEntry} — the hoisted entry controller (`docs/design/rowEditorBlueprint.md` decision 1,
 * `ingredientStatusExplanation.md` §8a): ONE active target, ONE debounce, ONE food search and ONE analytics session
 * for every entry field the host renders, with each field's text kept per target.
 *
 * ⛔ The session rule is the one §8a exists for: it settles when the active target changes or ITS row is removed, and
 * at unmount — never because some other row was deleted (per-row instances flushed on every deletion).
 *
 * REWRITTEN for plan 002 S7.8: the food search is the ONE progressive answer (`docs/design/rowEditorOpenDecisions.md`,
 * S7 list contract), read through the seam (`useIngredientSuggestionSource`, mocked here as the role it plays; its own
 * suite runs it against the real client and TanStack). The live search is gone (S7.9): a remote food is picked from the
 * list itself (P8), and the count is said early only when the answer still runs 1 s after its database part (P7). The
 * commit port is a double, so each test decides how the commit ends.
 */
import type { ProgressiveFrame } from '@kitchensink/food-service-client';
import { act, renderHook } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    COMPLETE_FRAME,
    answerOf,
    authoredResult,
    catalogResult,
    databaseFrame,
    remoteItem,
    sourceAnswered,
} from '../../__fixtures__/progressiveFrames.js';
import { mintedLineKey, seedLineKey } from '../../form/lineKey.js';
import type {
    AuthoredFoodOption,
    CatalogFoodHit,
    CatalogFoodOption,
    ProgressiveRead,
    RemoteFoodOption,
} from '../foodSuggestions.model.js';
import { INGREDIENT_SEARCH_DEBOUNCE_MS } from '../ingredientSearchDebounce.js';
import type { EntryLine } from '../ingredientEntry.model.js';
import type { LineCommitOutcome, LineCommitTarget } from '../lineCommit.js';
import type { SourceLimit } from '../useSourceLimit.js';

const mocks = vi.hoisted(() => ({
    useIngredientSuggestionSource: vi.fn(),
    refetch: vi.fn(),
    emit: vi.fn(),
}));

vi.mock('../ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: mocks.useIngredientSuggestionSource,
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: mocks.emit }),
}));

import { useIngredientEntry, type IngredientEntry } from '../useIngredientEntry.js';

const OIL: EntryLine = { key: seedLineKey(3, 0), name: 'Olive oil' };
const CHICK: EntryLine = { key: seedLineKey(3, 1), name: 'chick' };
const KALE: EntryLine = { key: mintedLineKey('kale'), name: 'kale' };
const at = (line: EntryLine): LineCommitTarget => ({ kind: 'line', key: line.key });
const TRAILING: LineCommitTarget = { kind: 'newLine' };

const MY_CHICKPEAS = authoredResult('food_mine', 'Chickpeas, home cooked');
const CANNED = catalogResult('food_cp', 'Chickpeas, canned');
const FRIED_BREAST = {
    id: 'food_breast',
    name: 'boneless skinless chicken breasts',
    score: 0.9,
    variant: { id: 'var_fried', parts: [{ attribute: 'cookingMethod', text: 'fried' }] },
} satisfies CatalogFoodHit;
const MINE_OPTION: AuthoredFoodOption = {
    group: 'authored',
    hit: { id: 'food_mine', name: 'Chickpeas, home cooked', score: 0.5 },
};
const CANNED_OPTION: CatalogFoodOption = {
    group: 'catalog',
    hit: { id: 'food_cp', name: 'Chickpeas, canned', score: 0.5 },
};
const FRIED_OPTION: CatalogFoodOption = { group: 'catalog', hit: FRIED_BREAST };
const GARBANZO_OPTION: RemoteFoodOption = {
    group: 'remote',
    source: 'usda',
    hit: remoteItem('Garbanzo beans', 'sealed.g'),
};

/** What the seam answers: one read, the same object on every render, as TanStack's stable fields make it. */
function source(read: ProgressiveRead) {
    return { read, refetch: mocks.refetch };
}

/** The seam's read of an answer that ended after `frames`. */
const ended = (...frames: ProgressiveFrame[]) => source({ kind: 'ended', answer: answerOf(...frames), resumed: false });

/** The seam's read of an answer still running after `frames`. */
const running = (...frames: ProgressiveFrame[]) =>
    source({ kind: 'asking', answer: answerOf(...frames), resumed: false });

const bothAnswered = (authored: Parameters<typeof databaseFrame>[0]) => ended(databaseFrame(authored), COMPLETE_FRAME);

/** A commit port whose every call is answered with `outcome`. */
function port(outcome: LineCommitOutcome = { kind: 'failed' }) {
    return vi.fn(async (): Promise<LineCommitOutcome> => outcome);
}

const committed = (key = OIL.key): LineCommitOutcome => ({
    kind: 'committed',
    key,
    binding: { ingredientId: 'ing_chickpea', name: 'Chickpeas', isUserEntered: false },
});

/** The session's one source limit, as the row editor holds it. */
const LIMIT: SourceLimit = { retryAt: undefined, hold: vi.fn() };

function render(lines: readonly EntryLine[] = [OIL, CHICK], commit = port()) {
    return renderHook(({ current }) => useIngredientEntry({ lines: current, commit, sourceLimit: LIMIT }), {
        initialProps: { current: lines },
    });
}

/** Type into `target` and let the debounce settle. */
function typeSettled(result: { current: IngredientEntry }, target: LineCommitTarget, text: string): void {
    act(() => result.current.setText(target, text));
    act(() => {
        vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
    });
}

/** The query the food search was last enabled for, or `undefined`. */
const lastEnabledQuery = (): string | undefined => {
    const enabledCalls = mocks.useIngredientSuggestionSource.mock.calls.filter(([, enabled]) => enabled === true);

    return enabledCalls.at(-1)?.[0] as string | undefined;
};

beforeEach(() => {
    // Cleared here, not after: the previous test's unmount settles its open session AFTER its own hooks ran.
    vi.clearAllMocks();
    vi.useFakeTimers();
    focusManager.setFocused(true);
    mocks.useIngredientSuggestionSource.mockReturnValue(running());
    mocks.emit.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.useRealTimers();
    focusManager.setFocused(undefined);
});

describe('useIngredientEntry — text per target, one active target', () => {
    it('keeps each field’s text; a field nobody typed in shows its line', () => {
        const { result } = render();

        act(() => result.current.setText(TRAILING, 'flour'));
        act(() => result.current.setText(at(CHICK), 'chickpeas'));

        expect(result.current.textOf(TRAILING)).toBe('flour');
        expect(result.current.textOf(at(CHICK))).toBe('chickpeas');
        expect(result.current.textOf(at(OIL))).toBe('Olive oil');
    });

    it('the focused field is the active one, and only it reads active', () => {
        const { result } = render();

        act(() => result.current.focus(at(OIL)));

        expect(result.current.active).toEqual(at(OIL));
        expect(result.current.isActive(at(OIL))).toBe(true);
        expect(result.current.isActive(TRAILING)).toBe(false);
    });

    it('⛔ searches ONLY the active field’s settled text, and never another field’s', () => {
        const { result } = render();

        typeSettled(result, TRAILING, 'flour');
        expect(lastEnabledQuery()).toBe('flour');

        act(() => result.current.setText(at(CHICK), 'chickpeas'));
        // The debounce has not settled for the new field: the old field's text is not searched under it.
        expect(result.current.view.kind).toBe('searching');
        expect(mocks.useIngredientSuggestionSource).toHaveBeenLastCalledWith('flour', false, LIMIT.hold);
        act(() => {
            vi.advanceTimersByTime(INGREDIENT_SEARCH_DEBOUNCE_MS);
        });
        expect(lastEnabledQuery()).toBe('chickpeas');
    });

    it('below the search minimum it reads nothing and says so', () => {
        const { result } = render();

        typeSettled(result, TRAILING, 'fl');

        expect(lastEnabledQuery()).toBeUndefined();
        expect(result.current.view).toEqual({ kind: 'tooShort', minimum: 3 });
    });

    it('a parked read makes the list offline at once (P6)', () => {
        mocks.useIngredientSuggestionSource.mockReturnValue(source({ kind: 'parked' }));
        const { result } = render();

        typeSettled(result, TRAILING, 'flour');

        expect(result.current.view).toEqual({ kind: 'offline' });
    });

    it('the list is searching until the database part arrives (P2)', () => {
        const { result } = render();

        typeSettled(result, TRAILING, 'chickpeas');

        expect(result.current.view).toEqual({ kind: 'searching', resumed: false });
    });

    it('the database part served: the cook’s own foods, then the catalog’s', () => {
        mocks.useIngredientSuggestionSource.mockReturnValue(
            bothAnswered({ authored: [MY_CHICKPEAS], catalog: [CANNED] }),
        );
        const { result } = render();

        typeSettled(result, TRAILING, 'chickpeas');

        expect(result.current.view).toMatchObject({
            kind: 'served',
            database: {
                authored: { kind: 'answered', foods: [MINE_OPTION] },
                catalog: { kind: 'answered', foods: [CANNED_OPTION] },
            },
            progress: 'complete',
        });
    });
});

describe('useIngredientEntry — the analytics session (§8a)', () => {
    const sessionEvents = () =>
        mocks.emit.mock.calls.map(([body]) => (body as { events: { outcome: unknown }[] }).events[0]);

    it('a pick from the list settles the session as a pick, at its place in its group', async () => {
        mocks.useIngredientSuggestionSource.mockReturnValue(
            bothAnswered({ authored: [MY_CHICKPEAS], catalog: [CANNED] }),
        );
        const { result } = render([OIL], port(committed()));

        typeSettled(result, TRAILING, 'chickpeas');
        await act(async () => {
            result.current.selectFood(CANNED_OPTION);
        });

        expect(sessionEvents()).toEqual([
            expect.objectContaining({
                served: [
                    { group: 'local', label: 'Chickpeas, home cooked' },
                    { group: 'catalog', label: 'Chickpeas, canned', foodId: 'food_cp' },
                ],
                outcome: { kind: 'pick', group: 'catalog', positionInGroup: 1, foodId: 'food_cp' },
            }),
        ]);
    });

    it('a list served from one database group while the other failed is a served list', () => {
        mocks.useIngredientSuggestionSource.mockReturnValue(
            ended(databaseFrame({ authored: 'unavailable', catalog: [CANNED] }), COMPLETE_FRAME),
        );
        const { result } = render();

        typeSettled(result, TRAILING, 'chickpeas');
        act(() => result.current.focus(at(OIL)));

        expect(sessionEvents()).toEqual([
            expect.objectContaining({
                served: [{ group: 'catalog', label: 'Chickpeas, canned', foodId: 'food_cp' }],
                outcome: { kind: 'no_pick' },
            }),
        ]);
    });

    it('⛔ a search where both database groups failed served nothing: the session keeps the list it was served', () => {
        const failedBoth = ended(databaseFrame({ authored: 'unavailable', catalog: 'unavailable' }), COMPLETE_FRAME);
        const servedCanned = bothAnswered({ catalog: [CANNED] });
        mocks.useIngredientSuggestionSource.mockImplementation((query: string) =>
            query === 'chickpeas' ? failedBoth : servedCanned,
        );
        const { result } = render();

        typeSettled(result, TRAILING, 'chickpea');
        typeSettled(result, TRAILING, 'chickpeas');
        act(() => result.current.focus(at(OIL)));

        expect(sessionEvents()).toEqual([
            expect.objectContaining({
                query: 'chickpea',
                served: [{ group: 'catalog', label: 'Chickpeas, canned', foodId: 'food_cp' }],
                outcome: { kind: 'no_pick' },
            }),
        ]);
    });

    it('moving to another field settles the open session once, as a no-pick', () => {
        mocks.useIngredientSuggestionSource.mockReturnValue(bothAnswered({ authored: [MY_CHICKPEAS] }));
        const { result } = render();

        typeSettled(result, TRAILING, 'chickpeas');
        act(() => result.current.focus(at(CHICK)));
        act(() => result.current.focus(at(OIL)));

        expect(mocks.emit).toHaveBeenCalledTimes(1);
        expect(sessionEvents()[0]).toMatchObject({ query: 'chickpeas', outcome: { kind: 'no_pick' } });
    });

    it('removing the ACTIVE field’s row settles its session', () => {
        mocks.useIngredientSuggestionSource.mockReturnValue(bothAnswered({ authored: [MY_CHICKPEAS] }));
        const { result, rerender } = render([OIL, CHICK, KALE]);

        typeSettled(result, at(KALE), 'chickpeas');
        rerender({ current: [OIL, CHICK] });

        expect(mocks.emit).toHaveBeenCalledTimes(1);
        expect(result.current.active).toBeUndefined();
    });

    it('⛔ removing ANOTHER row settles nothing', () => {
        mocks.useIngredientSuggestionSource.mockReturnValue(bothAnswered({ authored: [MY_CHICKPEAS] }));
        const { result, rerender } = render([OIL, CHICK, KALE]);

        typeSettled(result, TRAILING, 'chickpeas');
        rerender({ current: [OIL, KALE] });

        expect(mocks.emit).not.toHaveBeenCalled();
        expect(result.current.active).toEqual(TRAILING);
    });

    it('clearing the active field settles it, and so does leaving the screen', () => {
        mocks.useIngredientSuggestionSource.mockReturnValue(bothAnswered({ authored: [MY_CHICKPEAS] }));
        const first = render();

        typeSettled(first.result, TRAILING, 'chickpeas');
        act(() => first.result.current.setText(TRAILING, ''));
        expect(mocks.emit).toHaveBeenCalledTimes(1);

        const second = render();

        typeSettled(second.result, TRAILING, 'chickpeas');
        second.unmount();
        expect(mocks.emit).toHaveBeenCalledTimes(2);
    });
});

describe('useIngredientEntry — picks go to the commit port for the active field', () => {
    it.each([
        {
            case: 'one of the cook’s own foods is that food, by id (L4.4)',
            pickFrom: (entry: IngredientEntry) => entry.selectFood(MINE_OPTION),
            expected: { kind: 'catalogFood', foodId: 'food_mine', name: 'Chickpeas, home cooked' },
        },
        {
            case: 'a catalog food is that food, by id',
            pickFrom: (entry: IngredientEntry) => entry.selectFood(CANNED_OPTION),
            expected: { kind: 'catalogFood', foodId: 'food_cp', name: 'Chickpeas, canned' },
        },
        {
            case: 'a catalog food whose search named one variant binds that variant (§S2, AE3)',
            pickFrom: (entry: IngredientEntry) => entry.selectFood(FRIED_OPTION),
            expected: { kind: 'catalogVariant', foodVariantId: 'var_fried' },
        },
        {
            case: 'Find nutrition is the typed name',
            pickFrom: (entry: IngredientEntry) => entry.findByName(),
            expected: { kind: 'name', text: 'chickpeas' },
        },
        {
            case: 'Use as written is a declaration',
            pickFrom: (entry: IngredientEntry) => entry.declareAsWritten(),
            expected: { kind: 'declared', text: 'chickpeas' },
        },
        {
            case: 'a remote food is its sealed reference, with the name its root carries and its source (P8)',
            pickFrom: (entry: IngredientEntry) => entry.selectRemoteFood(GARBANZO_OPTION),
            expected: { kind: 'remoteFood', reference: 'sealed.g', name: 'Garbanzo beans', source: 'usda' },
        },
    ])('$case', async ({ pickFrom, expected }) => {
        const commit = port(committed());
        const { result } = render([OIL], commit);

        act(() => result.current.setText(TRAILING, '  chickpeas  '));
        await act(async () => {
            pickFrom(result.current);
        });

        expect(commit).toHaveBeenCalledWith(expected, TRAILING);
    });

    it('a committed pick empties the field; anything else keeps the text', async () => {
        const failing = render([OIL], port({ kind: 'failed' }));

        act(() => failing.result.current.setText(TRAILING, 'chickpeas'));
        await act(async () => {
            failing.result.current.findByName();
        });
        expect(failing.result.current.textOf(TRAILING)).toBe('chickpeas');

        const working = render([OIL], port(committed()));

        act(() => working.result.current.setText(TRAILING, 'chickpeas'));
        await act(async () => {
            working.result.current.findByName();
        });
        expect(working.result.current.textOf(TRAILING)).toBe('');
    });

    it('text typed while the commit ran is kept: only the text that was picked goes', async () => {
        let land: ((outcome: LineCommitOutcome) => void) | undefined;
        const commit = vi.fn(
            () =>
                new Promise<LineCommitOutcome>((resolve) => {
                    land = resolve;
                }),
        );
        const { result } = render([OIL], commit);

        act(() => result.current.setText(TRAILING, 'chickpeas'));
        act(() => result.current.findByName());
        act(() => result.current.setText(TRAILING, 'chickpeas, canned'));
        await act(async () => {
            land?.(committed());
        });

        expect(result.current.textOf(TRAILING)).toBe('chickpeas, canned');
    });

    it('with no active field, or nothing typed, a pick commits nothing', async () => {
        const commit = port();
        const { result } = render([OIL], commit);

        await act(async () => {
            result.current.findByName();
        });
        act(() => result.current.focus(TRAILING));
        await act(async () => {
            result.current.declareAsWritten();
        });

        expect(commit).not.toHaveBeenCalled();
    });
});

describe('useIngredientEntry — the trailing row reads the measure in front of the food (blueprint A1, A2)', () => {
    it('the trailing row asks the food search for the food alone, not the measure or the preparation', () => {
        const { result } = render([OIL]);

        typeSettled(result, TRAILING, '2 tbsp olive oil, for frying');

        expect(lastEnabledQuery()).toBe('olive oil');
    });

    it('⛔ a row’s own field (Change food) still searches its whole text: only the trailing row reads a measure', () => {
        const { result } = render([OIL]);

        act(() => result.current.beginChange(OIL.key));
        typeSettled(result, at(OIL), '2 tbsp olive oil');

        expect(lastEnabledQuery()).toBe('2 tbsp olive oil');
    });

    it('a measure with no food yet asks nothing and lists nothing: the search is empty', () => {
        const { result } = render([OIL]);

        typeSettled(result, TRAILING, '2 cups');

        expect(lastEnabledQuery()).toBeUndefined();
        expect(result.current.view.kind).toBe('idle');
    });

    it('a pick commits the trailing line with the measure read from the text it was picked on', async () => {
        const commit = port(committed());
        const { result } = render([OIL], commit);

        act(() => result.current.setText(TRAILING, '2 tbsp chickpeas, rinsed'));
        await act(async () => {
            result.current.selectFood(CANNED_OPTION);
        });

        expect(commit).toHaveBeenCalledWith(
            { kind: 'catalogFood', foodId: 'food_cp', name: 'Chickpeas, canned' },
            {
                kind: 'newLine',
                measure: { quantity: { kind: 'exact', value: 2 }, unit: 'tablespoon', preparation: 'rinsed' },
            },
        );
    });

    it('Find nutrition and Use as written name the food alone, and carry the measure', async () => {
        const commit = port(committed());
        const { result } = render([OIL], commit);

        act(() => result.current.setText(TRAILING, '400 g chickpeas'));
        await act(async () => {
            result.current.findByName();
        });

        expect(commit).toHaveBeenCalledWith(
            { kind: 'name', text: 'chickpeas' },
            { kind: 'newLine', measure: { quantity: { kind: 'exact', value: 400 }, unit: 'g', preparation: '' } },
        );
    });

    it('a measure with no food commits nothing: a line is never stored without a food', async () => {
        const commit = port(committed());
        const { result } = render([OIL], commit);

        act(() => result.current.setText(TRAILING, '2 cups'));
        await act(async () => {
            result.current.declareAsWritten();
        });

        expect(commit).not.toHaveBeenCalled();
    });

    it('the measure is not pending text a save drops: the field still holds the whole text the cook typed', () => {
        const { result } = render([OIL]);

        act(() => result.current.setText(TRAILING, '2 tbsp olive oil'));

        expect(result.current.textOf(TRAILING)).toBe('2 tbsp olive oil');
        expect(result.current.pendingEntryText).toBe('2 tbsp olive oil');
    });
});

describe('useIngredientEntry — Change food and the pending text', () => {
    it('Change food puts the row in entry mode on its name, and the name alone is not pending', () => {
        const { result } = render();

        act(() => result.current.beginChange(OIL.key));

        expect(result.current.changing).toEqual(new Set([OIL.key]));
        expect(result.current.textOf(at(OIL))).toBe('Olive oil');
        expect(result.current.pendingEntryText).toBe('');
    });

    it('says, per field, whether it holds pending text (each row names its own)', () => {
        const { result } = render();

        act(() => result.current.beginChange(OIL.key));
        act(() => result.current.setText(at(CHICK), 'chickpeas'));

        expect(result.current.isPending(at(OIL))).toBe(false);
        expect(result.current.isPending(at(CHICK))).toBe(true);
        expect(result.current.isPending(TRAILING)).toBe(false);
    });

    it('new text on the row is pending, and leaving keeps it; Cancel puts the line back', () => {
        const { result } = render();

        act(() => result.current.beginChange(OIL.key));
        act(() => result.current.setText(at(OIL), 'canola oil'));
        act(() => result.current.leave(at(OIL)));

        expect(result.current.pending).toEqual({ target: at(OIL), text: 'canola oil' });
        expect(result.current.pendingEntryText).toBe('canola oil');

        act(() => result.current.abandon(at(OIL)));

        expect(result.current.changing.size).toBe(0);
        expect(result.current.pendingEntryText).toBe('');
    });

    it('a commit ends Change food', async () => {
        const { result } = render([OIL, CHICK], port(committed(OIL.key)));

        act(() => result.current.beginChange(OIL.key));
        act(() => result.current.setText(at(OIL), 'canola oil'));
        await act(async () => {
            result.current.findByName();
        });

        expect(result.current.changing.size).toBe(0);
    });
});

describe('useIngredientEntry — a remote pick (P8)', () => {
    const sessionEvents = () =>
        mocks.emit.mock.calls.map(([body]) => (body as { events: { outcome: unknown }[] }).events[0]);

    // The analytics wire names only our database's groups, so a remote pick ends the session as a no-pick, as a live
    // hit did before it.
    it('ends the session as a no-pick, carrying the database foods it was served', async () => {
        mocks.useIngredientSuggestionSource.mockReturnValue(
            ended(
                databaseFrame({ catalog: [CANNED] }),
                sourceAnswered('usda', remoteItem('Garbanzo beans', 'sealed.g')),
            ),
        );
        const { result } = render([OIL], port(committed()));

        typeSettled(result, TRAILING, 'chickpeas');
        await act(async () => {
            result.current.selectRemoteFood(GARBANZO_OPTION);
        });

        expect(sessionEvents()).toEqual([
            expect.objectContaining({
                served: [{ group: 'catalog', label: 'Chickpeas, canned', foodId: 'food_cp' }],
                outcome: { kind: 'no_pick' },
            }),
        ]);
    });

    // P8: "The cached answer for this text is dropped, so the list asks again."
    it('asks the search again when food refused the hit, and keeps the text', async () => {
        const { result } = render([OIL], port({ kind: 'remoteGone' }));

        typeSettled(result, TRAILING, 'chickpeas');
        await act(async () => {
            result.current.selectRemoteFood(GARBANZO_OPTION);
        });

        expect(mocks.refetch).toHaveBeenCalledTimes(1);
        expect(result.current.textOf(TRAILING)).toBe('chickpeas');
    });

    it.each<LineCommitOutcome>([{ kind: 'failed' }, { kind: 'sourceBusy' }, { kind: 'limited', retryAt: 1 }])(
        'keeps the answer when the pick ended $kind',
        async (outcome) => {
            const { result } = render([OIL], port(outcome));

            typeSettled(result, TRAILING, 'chickpeas');
            await act(async () => {
                result.current.selectRemoteFood(GARBANZO_OPTION);
            });

            expect(mocks.refetch).not.toHaveBeenCalled();
        },
    );
});

describe('useIngredientEntry — when the count is said (P7)', () => {
    it('says the database part early only when the answer still runs 1 s after it settled', () => {
        mocks.useIngredientSuggestionSource.mockReturnValue(running(databaseFrame({ catalog: [CANNED] })));
        const { result } = render();

        typeSettled(result, TRAILING, 'chickpeas');
        expect(result.current.databaseSaidEarly).toBe(false);

        act(() => {
            vi.advanceTimersByTime(999);
        });
        expect(result.current.databaseSaidEarly).toBe(false);

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current.databaseSaidEarly).toBe(true);
    });

    it('keeps the slow path for that answer once it ends, so its end says only what came after', () => {
        mocks.useIngredientSuggestionSource.mockReturnValue(running(databaseFrame({ catalog: [CANNED] })));
        const { result, rerender } = render();

        typeSettled(result, TRAILING, 'chickpeas');
        act(() => {
            vi.advanceTimersByTime(1_000);
        });
        mocks.useIngredientSuggestionSource.mockReturnValue(
            ended(databaseFrame({ catalog: [CANNED] }), COMPLETE_FRAME),
        );
        rerender({ current: [OIL, CHICK] });

        expect(result.current.databaseSaidEarly).toBe(true);
    });

    it('takes the fast path when the answer ends inside the guard, and the guard firing later changes nothing', () => {
        mocks.useIngredientSuggestionSource.mockReturnValue(running(databaseFrame({ catalog: [CANNED] })));
        const { result, rerender } = render();

        typeSettled(result, TRAILING, 'chickpeas');
        act(() => {
            vi.advanceTimersByTime(500);
        });
        mocks.useIngredientSuggestionSource.mockReturnValue(
            ended(databaseFrame({ catalog: [CANNED] }), COMPLETE_FRAME),
        );
        rerender({ current: [OIL, CHICK] });
        act(() => {
            vi.advanceTimersByTime(2_000);
        });

        expect(result.current.databaseSaidEarly).toBe(false);
    });

    it('starts afresh for a new text', () => {
        mocks.useIngredientSuggestionSource.mockReturnValue(running(databaseFrame({ catalog: [CANNED] })));
        const { result } = render();

        typeSettled(result, TRAILING, 'chickpeas');
        act(() => {
            vi.advanceTimersByTime(1_000);
        });
        typeSettled(result, TRAILING, 'chickpea');

        expect(result.current.databaseSaidEarly).toBe(false);
    });
});

describe('useIngredientEntry — the cook’s limit from a source frame (system change 9)', () => {
    it('hands the search the session’s hold, so a frame that reports the limit holds it for the session', () => {
        const { result } = render();

        typeSettled(result, TRAILING, 'chickpeas');

        expect(lastEnabledQuery()).toBe('chickpeas');
        expect(mocks.useIngredientSuggestionSource).toHaveBeenLastCalledWith('chickpeas', true, LIMIT.hold);
    });
});
