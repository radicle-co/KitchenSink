/**
 * Tests for {@link useIngredientRowEditor} — the row editor's controllers, composed once for the three hosts
 * (`docs/design/rowEditorBlueprint.md` decisions 1, 2 and 7).
 *
 * The composed hooks are mocked, so these tests pin the composition alone: every surface that picks commits through
 * the ONE port `useLineCommit` returns, each settled commit is recorded with the surface it came from, and a details
 * dialog outcome becomes the pick blueprint decision 7 names (a variant, or Remove details as the root). The hooks'
 * own behaviour is theirs and is tested beside them; the composition with real clients is the integration tier
 * (`tests/__integration__/rowEditor.integration.test.tsx`).
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DetailsDialogOutcome } from '../../details/detailsDialogMachine.js';
import type { UseVariantDetailsDialogOptions } from '../../details/useVariantDetailsDialog.js';
import { seedLineKey } from '../../form/lineKey.js';
import type { GateOutcome } from '../../editor/gate.js';
import type { IngredientPick, LineCommitOutcome, LineCommitPort, LineCommitTarget } from '../lineCommit.js';
import type { UseAuthoredFoodCreateOptions } from '../useAuthoredFoodCreate.js';

const mocks = vi.hoisted(() => ({
    commit: vi.fn(),
    entryOptions: [] as { readonly commit: unknown }[],
    authoredOptions: [] as UseAuthoredFoodCreateOptions[],
    detailsOptions: [] as unknown[],
    surface: undefined as unknown,
    entryPending: undefined as { readonly target: LineCommitTarget; readonly text: string } | undefined,
    settled: undefined as unknown,
    inFlightPick: vi.fn(),
    sourceLimit: { retryAt: undefined, hold: () => undefined },
    naming: { marker: 'naming' },
    lineCommitLimits: [] as unknown[],
    abandon: vi.fn(),
}));

vi.mock('../useLineCommit.js', () => ({
    useLineCommit: (surface: unknown, sourceLimit: unknown) => {
        mocks.surface = surface;
        mocks.lineCommitLimits.push(sourceLimit);

        return {
            commit: mocks.commit,
            inFlightPick: mocks.inFlightPick,
            settled: mocks.settled,
            paused: false,
            limitRefusals: 0,
        };
    },
}));
vi.mock('../useSourceLimit.js', () => ({
    useSourceLimit: () => mocks.sourceLimit,
}));
vi.mock('../useSourceNaming.js', () => ({
    useSourceNaming: () => mocks.naming,
}));
vi.mock('../useIngredientEntry.js', () => ({
    useIngredientEntry: (options: { readonly commit: unknown }) => {
        mocks.entryOptions.push(options);

        return { marker: 'entry', pending: mocks.entryPending, abandon: mocks.abandon };
    },
}));
vi.mock('../useAuthoredFoodCreate.js', () => ({
    useAuthoredFoodCreate: (options: UseAuthoredFoodCreateOptions) => {
        mocks.authoredOptions.push(options);

        return { marker: 'authoredFood' };
    },
}));
vi.mock('../../details/useVariantDetailsDialog.js', () => ({
    useVariantDetailsDialog: (options: unknown) => {
        mocks.detailsOptions.push(options);

        return { marker: 'details' };
    },
}));

import { useIngredientRowEditor, type RowDetailsTarget } from '../useIngredientRowEditor.js';

const KEY = seedLineKey(2, 0);
const LINE: LineCommitTarget = { kind: 'line', key: KEY };
const SURFACE = { kind: 'createForm', dispatch: () => undefined } as const;
const COMMITTED: LineCommitOutcome = {
    kind: 'committed',
    key: KEY,
    binding: { ingredientId: 'ing_flat', isUserEntered: false },
};

const lastOf = <T,>(calls: readonly T[]): T => {
    const last = calls.at(-1);

    if (last === undefined) {
        throw new Error('the hook was not called');
    }

    return last;
};

const portOf = (options: { readonly commit: unknown }): LineCommitPort => options.commit as LineCommitPort;
const detailsOptions = (): UseVariantDetailsDialogOptions =>
    lastOf(mocks.detailsOptions) as UseVariantDetailsDialogOptions;

const BRISKET: RowDetailsTarget = {
    key: KEY,
    rootId: 'food_brisket',
    foodName: 'beef brisket',
    entry: { mode: 'edit', current: { id: 'var_point', parts: [{ attribute: 'cut', text: 'point half' }] } },
};

beforeEach(() => {
    mocks.commit.mockReset();
    mocks.commit.mockResolvedValue(COMMITTED);
    mocks.abandon.mockReset();
    mocks.entryOptions.length = 0;
    mocks.authoredOptions.length = 0;
    mocks.detailsOptions.length = 0;
    mocks.lineCommitLimits.length = 0;
    mocks.entryPending = undefined;
    mocks.settled = undefined;
    mocks.inFlightPick.mockReset();
});

const render = () =>
    renderHook(() => useIngredientRowEditor({ surface: SURFACE, lines: [{ key: KEY, name: 'beef brisket' }] }));

describe('useIngredientRowEditor', () => {
    it('hands the host’s surface to the commit hook, and returns each composed controller', () => {
        const { result } = render();

        expect(mocks.surface).toBe(SURFACE);
        // The rows remove (and row 6 settles) through the host's own draft transition.
        expect(result.current.dispatch).toBe(SURFACE.dispatch);
        expect(result.current.entry).toMatchObject({ marker: 'entry' });
        expect(result.current.authoredFood).toEqual({ marker: 'authoredFood' });
        expect(result.current.details.model).toEqual({ marker: 'details' });
    });

    // System change 9: ONE limit for the session, above every surface that spends the budget. REWRITTEN for plan 002
    // S7.8: row 6 now picks through the commit port as row 7 does, so no candidate pick is composed here any more.
    it('holds ONE source limit for the session, and hands it to the commit port, the entry and the panels', () => {
        const { result } = render();

        expect(lastOf(mocks.lineCommitLimits)).toBe(mocks.sourceLimit);
        expect(lastOf(mocks.entryOptions)).toMatchObject({ sourceLimit: mocks.sourceLimit });
        expect(result.current.sourceLimit).toBe(mocks.sourceLimit);
    });

    // P5: one naming of the sources for every row and panel, read once, here.
    it('reads how the editor names a remote source once, for every row and panel', () => {
        expect(render().result.current.naming).toBe(mocks.naming);
    });

    it('the entry commits through the one port, tagged as its own', async () => {
        render();
        const pick: IngredientPick = { kind: 'name', text: 'saffron' };

        let outcome: LineCommitOutcome | undefined;

        await act(async () => {
            outcome = await portOf(lastOf(mocks.entryOptions))(pick, LINE);
        });

        expect(mocks.commit).toHaveBeenCalledWith(pick, LINE, { kind: 'entry' });
        expect(outcome).toEqual(COMMITTED);
    });

    it.each(['created', 'reused'] as const)(
        'the authored-food form commits through the one port, tagged with the food it %s (S5.5)',
        async (made) => {
            render();
            const pick: IngredientPick = { kind: 'catalogFood', foodId: 'food_mine', name: 'saffron' };

            let outcome: LineCommitOutcome | undefined;

            await act(async () => {
                outcome = await lastOf(mocks.authoredOptions).commit(pick, LINE, made);
            });

            expect(mocks.commit).toHaveBeenCalledWith(pick, LINE, { kind: 'authoredFood', outcome: made });
            expect(outcome).toEqual(COMMITTED);
        },
    );

    it('row 7: a shortlist pick commits on THAT line through the one port, tagged as the shortlist’s', async () => {
        const { result } = render();
        const pick: IngredientPick = { kind: 'catalogFood', foodId: 'food_sauce', name: 'Applesauce' };

        let outcome: LineCommitOutcome | undefined;

        await act(async () => {
            outcome = await result.current.pickFromShortlist(KEY, pick);
        });

        expect(mocks.commit).toHaveBeenCalledExactlyOnceWith(pick, LINE, { kind: 'shortlist' });
        expect(outcome).toEqual(COMMITTED);
        // A shortlist pick is not the entry's: its field's text is not touched.
        expect(mocks.abandon).not.toHaveBeenCalled();
    });

    it.each([
        ['the trailing row', { kind: 'newLine' } as const],
        ['a row', LINE],
    ])('a food put on %s spends the text the form was opened on: that field empties (B8)', async (_l, target) => {
        mocks.commit.mockResolvedValue(COMMITTED);
        render();
        const pick: IngredientPick = { kind: 'catalogFood', foodId: 'food_mine', name: 'saffron' };

        await act(async () => {
            await lastOf(mocks.authoredOptions).commit(pick, target, 'created');
        });

        expect(mocks.abandon).toHaveBeenCalledWith(target);
    });

    it.each([{ kind: 'failed' }, { kind: 'conflict' }, { kind: 'busy' }] as const)(
        'a food that did not go on the line ($kind) leaves the field’s text where it was',
        async (refused) => {
            mocks.commit.mockResolvedValue(refused);
            render();
            const pick: IngredientPick = { kind: 'catalogFood', foodId: 'food_mine', name: 'saffron' };

            await act(async () => {
                await lastOf(mocks.authoredOptions).commit(pick, { kind: 'newLine' }, 'created');
            });

            expect(mocks.abandon).not.toHaveBeenCalled();
        },
    );

    it('reads the settled commit and the pick in flight from the commit hook, which owns them', () => {
        const pick: IngredientPick = { kind: 'catalogFood', foodId: 'food_kale', name: 'Kale, raw' };
        const settled = { origin: { kind: 'entry' }, pick, target: LINE, outcome: COMMITTED };

        mocks.settled = settled;
        mocks.inFlightPick.mockImplementation((target: LineCommitTarget) =>
            target.kind === 'line' ? pick : undefined,
        );
        const { result } = render();

        expect(result.current.settled).toBe(settled);
        expect(result.current.pickInFlight(LINE)).toBe(pick);
        expect(result.current.pickInFlight({ kind: 'newLine' })).toBeUndefined();
    });

    it('opens the details dialog for one line, on its root, in the mode it was asked for', () => {
        const { result } = render();

        expect(detailsOptions().open).toBe(false);

        act(() => result.current.details.open(BRISKET));

        expect(result.current.details.target).toEqual(BRISKET);
        expect(detailsOptions()).toMatchObject({ open: true, rootId: 'food_brisket', entry: BRISKET.entry });
    });

    it('a picked variant closes the dialog and is committed on that line as the variant (decision 7)', async () => {
        const { result } = render();
        const variant = { id: 'var_flat', parts: [{ attribute: 'cut', text: 'flat half' }] };

        act(() => result.current.details.open(BRISKET));
        await act(async () => {
            detailsOptions().onOutcome({ kind: 'committed', mode: 'edit', variant });
            await Promise.resolve();
        });

        expect(result.current.details.target).toBeUndefined();
        expect(mocks.commit).toHaveBeenCalledWith({ kind: 'catalogVariant', foodVariantId: 'var_flat' }, LINE, {
            kind: 'details',
            mode: 'edit',
        });
    });

    it('Remove details closes the dialog and is committed as the line’s root (decision 7)', async () => {
        const { result } = render();

        act(() => result.current.details.open(BRISKET));
        await act(async () => {
            detailsOptions().onOutcome({ kind: 'removed' });
            await Promise.resolve();
        });

        expect(mocks.commit).toHaveBeenCalledWith(
            { kind: 'catalogFood', foodId: 'food_brisket', name: 'beef brisket' },
            LINE,
            { kind: 'details', mode: 'edit' },
        );
    });

    it.each<[string, DetailsDialogOutcome]>([['a dismissal', { kind: 'dismissed' }]])(
        '%s closes the dialog and writes nothing',
        async (_label, outcome) => {
            const { result } = render();

            act(() => result.current.details.open(BRISKET));
            await act(async () => {
                detailsOptions().onOutcome(outcome);
                await Promise.resolve();
            });

            expect(result.current.details.target).toBeUndefined();
            expect(mocks.commit).not.toHaveBeenCalled();
            expect(result.current.settled).toBeUndefined();
        },
    );
});

describe('useIngredientRowEditor — a refusal for pending text (`rowEditorOpenDecisions.md` R7)', () => {
    const PENDING = { ingredients: 'ingredientsPendingText' } as const;

    it.each<[string, GateOutcome]>([
        ['a gate that went ahead', { kind: 'send' }],
        ['a gate that waited on a command', { kind: 'busy' }],
        ['a refusal for a title', { kind: 'refused', errors: { title: 'titleRequired' }, section: 'details' }],
        [
            'another ingredients code',
            { kind: 'refused', errors: { ingredients: 'ingredientsEmpty' }, section: 'ingredients' },
        ],
        // The refusal lands on Details, so the Ingredients field is not where it points (R7 item 2).
        [
            'pending text, landing on Details',
            { kind: 'refused', errors: { title: 'titleRequired', ...PENDING }, section: 'details' },
        ],
    ])('%s raises no focus request', (_case, outcome) => {
        // A field holds pending text, so a level raised here would stand rather than drop by itself.
        mocks.entryPending = { target: LINE, text: 'saffron' };
        const { result } = render();

        act(() => result.current.refused(outcome));

        expect(result.current.pendingFocusRequested).toBe(false);
    });

    it('a refusal that lands on Ingredients for pending text raises a level that holds until the field takes it, and the next refusal raises it again', () => {
        const { result } = render();
        const landsOnTwo: GateOutcome = {
            kind: 'refused',
            errors: { ...PENDING, steps: 'stepsRequired' },
            section: 'ingredients',
        };

        mocks.entryPending = { target: LINE, text: 'saffron' };
        expect(result.current.pendingFocusRequested).toBe(false);

        act(() => result.current.refused(landsOnTwo));
        expect(result.current.pendingFocusRequested).toBe(true);

        // A level, not an event: a later render (the step the refusal moved to mounting) still reads it.
        act(() => result.current.details.open(BRISKET));
        expect(result.current.pendingFocusRequested).toBe(true);

        act(() => result.current.pendingFocusHandled());
        expect(result.current.pendingFocusRequested).toBe(false);

        act(() => result.current.refused(landsOnTwo));
        expect(result.current.pendingFocusRequested).toBe(true);
        // Each refusal is counted, so the pending field can say its sentence again at the next one (R8).
        expect(result.current.pendingRefusals).toBe(2);
    });

    it('the level drops by itself once no field holds pending text, so it never fires later at text typed after', () => {
        mocks.entryPending = { target: LINE, text: 'saffron' };
        const { result, rerender } = render();

        act(() => result.current.refused({ kind: 'refused', errors: PENDING, section: 'ingredients' }));
        expect(result.current.pendingFocusRequested).toBe(true);

        // The cook cleared the text before the field took focus (or a target no field shows held it).
        mocks.entryPending = undefined;
        rerender();
        expect(result.current.pendingFocusRequested).toBe(false);

        mocks.entryPending = { target: LINE, text: 'saffron threads' };
        rerender();
        expect(result.current.pendingFocusRequested).toBe(false);
    });

    it('a refusal for pending text, from Next or a save, makes the pending field say why until no field holds pending text', () => {
        mocks.entryPending = { target: LINE, text: 'saffron' };
        const { result, rerender } = render();

        expect(result.current.pendingRefused).toBe(false);

        act(() => result.current.refused({ kind: 'refused', errors: PENDING, section: 'ingredients' }));
        expect(result.current.pendingRefused).toBe(true);

        // Taking focus is not an answer: the sentence stays while the text does (R7, "On the field").
        act(() => result.current.pendingFocusHandled());
        expect(result.current.pendingRefused).toBe(true);

        mocks.entryPending = undefined;
        rerender();
        expect(result.current.pendingRefused).toBe(false);

        // Text typed after the answer was never refused.
        mocks.entryPending = { target: LINE, text: 'saffron threads' };
        rerender();
        expect(result.current.pendingRefused).toBe(false);
    });

    it('a refusal that does not point at pending text makes no field say anything', () => {
        mocks.entryPending = { target: LINE, text: 'saffron' };
        const { result } = render();

        act(() =>
            result.current.refused({
                kind: 'refused',
                errors: { title: 'titleRequired', ...PENDING },
                section: 'details',
            }),
        );

        expect(result.current.pendingRefused).toBe(false);
    });
});

/**
 * E2 (`docs/design/rowEditorOpenDecisions.md`): whether the cook has moved past what last settled lives here, in the
 * host, because the host outlives the step. The field group mounts and unmounts with its step; leaving the step is not
 * moving past. And each entry pick that settles without a line counts, so the wizard can count it as an attempt on its
 * step.
 */
describe('useIngredientRowEditor — what last settled, and whether the cook moved past it (E2)', () => {
    const failedPick = (): unknown => ({
        origin: { kind: 'entry' },
        target: LINE,
        pick: { kind: 'name', text: 'smoked flour' },
        outcome: { kind: 'failed' },
    });

    it('nothing settled is nothing to move past', () => {
        expect(render().result.current.movedPast).toBe(true);
    });

    it('a settled commit stands until the cook moves on, and the next one stands again', () => {
        const { result, rerender } = render();

        mocks.settled = failedPick();
        rerender();
        expect(result.current.movedPast).toBe(false);

        act(() => result.current.moveOn());
        expect(result.current.movedPast).toBe(true);

        mocks.settled = failedPick();
        rerender();
        expect(result.current.movedPast).toBe(false);
    });

    it.each([
        ['failed', 1, { kind: 'failed' }],
        ['refused by the source', 1, { kind: 'sourceBusy' }],
        ['gone from its source', 1, { kind: 'remoteGone' }],
        ['refused by the limit', 1, { kind: 'limited', retryAt: 1 }],
        ['committed', 0, COMMITTED],
        ['refused as busy', 0, { kind: 'busy' }],
        ['a conflict', 0, { kind: 'conflict' }],
    ] as const)('an entry pick that settles %s counts %i failures', async (_case, counted, outcome) => {
        mocks.commit.mockResolvedValue(outcome);
        const { result } = render();

        await act(async () => {
            await portOf(lastOf(mocks.entryOptions))({ kind: 'name', text: 'saffron' }, LINE);
        });

        expect(result.current.pickFailures).toBe(counted);
    });

    it('counts only the entry’s picks: a refused shortlist pick says its failure in its own panel', async () => {
        mocks.commit.mockResolvedValue({ kind: 'failed' });
        const { result } = render();

        await act(async () => {
            await result.current.pickFromShortlist(KEY, { kind: 'catalogFood', foodId: 'food_sauce', name: 'sauce' });
        });

        expect(result.current.pickFailures).toBe(0);
    });
});
