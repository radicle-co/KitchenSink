/**
 * Tests for {@link useAuthoredFoodCreate} — the create-my-own-food form's controller (blueprint decision 2). Since plan
 * 002 S5.5 food creates the food (`POST /api/v1/foods/authored`) and the line is a separate commit: the hook emits a
 * `catalogFood` pick of the food into the host's commit port (`useLineCommit`), with whether the food was created or
 * reused, so the same form serves the trailing row and a row's ⋮, and the edit form's stored line is re-pointed by the
 * rebind command rather than by a plain admission.
 *
 * The create mutation is mocked (its own behaviour is the client package's); the commit port is a deferred double, so
 * each test decides when, and how, the commit ends.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { seedLineKey } from '../../form/lineKey.js';
import type { LineCommitOutcome, LineCommitTarget } from '../lineCommit.js';

const { useCreateAuthoredFoodMock } = vi.hoisted(() => ({ useCreateAuthoredFoodMock: vi.fn() }));

vi.mock('@kitchensink/food-service-client/hooks', () => ({
    useCreateAuthoredFood: useCreateAuthoredFoodMock,
}));

import { useAuthoredFoodCreate } from '../useAuthoredFoodCreate.js';

/** Food's `201`: the food it created (`CreateAuthoredFoodResult`). Only the fields the hook reads. */
const CREATED = { kind: 'created', food: { id: 'F_new', name: 'Grandma Blend' } } as const;
const TRAILING: LineCommitTarget = { kind: 'newLine' };
const ROW: LineCommitTarget = { kind: 'line', key: seedLineKey(3, 1) };
const COMMITTED: LineCommitOutcome = {
    kind: 'committed',
    key: seedLineKey(3, 1),
    binding: { ingredientId: 'ing-a1', name: 'Grandma Blend', isUserEntered: false },
};

type CreateOptions = { onSuccess?: (value: unknown) => void; onError?: (error: unknown) => void };

/** A create mutation double. `answer` settles every `mutate` synchronously; `null` leaves it pending. */
function createMutation(answer: { readonly value: unknown } | { readonly error: unknown } | null, isPending = false) {
    return {
        mutate: vi.fn((_value: unknown, options?: CreateOptions) => {
            if (answer === null) {
                return;
            }

            if ('value' in answer) {
                options?.onSuccess?.(answer.value);
            } else {
                options?.onError?.(answer.error);
            }
        }),
        isPending,
        reset: vi.fn(),
    };
}

/** A commit port whose every call waits until the test settles it. */
function deferredCommit() {
    const settles: ((outcome: LineCommitOutcome) => void)[] = [];
    const commit = vi.fn(
        () =>
            new Promise<LineCommitOutcome>((resolve) => {
                settles.push(resolve);
            }),
    );

    return {
        commit,
        settle: async (outcome: LineCommitOutcome): Promise<void> => {
            await act(async () => {
                settles.shift()?.(outcome);
                await Promise.resolve();
            });
        },
    };
}

function fill(result: { current: ReturnType<typeof useAuthoredFoodCreate> }): void {
    for (const [field, value] of [
        ['calories', '100'],
        ['proteinG', '10'],
        ['carbsG', '20'],
        ['fatG', '5'],
    ] as const) {
        act(() => result.current.setField(field, value));
    }
}

beforeEach(() => {
    useCreateAuthoredFoodMock.mockReturnValue(createMutation(null));
});

describe('useAuthoredFoodCreate — opening and closing', () => {
    it('opens on the name the cook typed, for the target that opened it', () => {
        const { result } = renderHook(() => useAuthoredFoodCreate({ commit: deferredCommit().commit }));

        expect(result.current.state).toEqual({ kind: 'closed' });

        act(() => result.current.open('grandma blend', ROW));

        expect(result.current.state).toMatchObject({ kind: 'open', draft: { name: 'grandma blend', calories: '' } });
        expect(result.current.target).toEqual(ROW);
    });

    it('⛔ a second open keeps the draft the cook typed, and the target', () => {
        const { result } = renderHook(() => useAuthoredFoodCreate({ commit: deferredCommit().commit }));

        act(() => result.current.open('grandma blend', ROW));
        act(() => result.current.setField('calories', '100'));
        act(() => result.current.open('something else', TRAILING));

        expect(result.current.state).toMatchObject({ kind: 'open', draft: { name: 'grandma blend', calories: '100' } });
        expect(result.current.target).toEqual(ROW);
    });

    it('cancel closes and discards', () => {
        const { result } = renderHook(() => useAuthoredFoodCreate({ commit: deferredCommit().commit }));

        act(() => result.current.open('grandma blend', ROW));
        act(() => result.current.cancel());

        expect(result.current.state).toEqual({ kind: 'closed' });
        expect(result.current.target).toBeUndefined();
    });
});

describe('useAuthoredFoodCreate — submit', () => {
    it('reports field errors inline and sends nothing when the draft is invalid', () => {
        const mutation = createMutation(null);
        useCreateAuthoredFoodMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useAuthoredFoodCreate({ commit: deferredCommit().commit }));

        act(() => result.current.open('grandma blend', ROW));
        act(() => result.current.submit());

        expect(mutation.mutate).not.toHaveBeenCalled();
        expect(result.current.state).toMatchObject({ kind: 'open', fieldErrors: { calories: 'required' } });
    });

    it('creates the food, then commits it as a catalogFood pick on the target, as CREATED; closes once it is on the line', async () => {
        const mutation = createMutation({ value: CREATED });
        useCreateAuthoredFoodMock.mockReturnValue(mutation);
        const port = deferredCommit();
        const { result } = renderHook(() => useAuthoredFoodCreate({ commit: port.commit }));

        act(() => result.current.open('grandma blend', ROW));
        fill(result);
        act(() => result.current.submit());

        expect(mutation.mutate).toHaveBeenCalledWith(
            { name: 'grandma blend', macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 5 } },
            expect.anything(),
        );
        // The food's own name and id: the line names the food food made.
        expect(port.commit).toHaveBeenCalledWith(
            { kind: 'catalogFood', foodId: 'F_new', name: 'Grandma Blend' },
            ROW,
            'created',
        );
        // The food exists but is not on the line yet: the form still reads busy.
        expect(result.current.state.kind).toBe('submitting');

        await port.settle(COMMITTED);

        expect(result.current.state).toEqual({ kind: 'closed' });
    });

    it.each([{ kind: 'failed' }, { kind: 'conflict' }] as const)(
        'a commit that ends $kind keeps the form open with its draft, and says the submit failed',
        async (outcome) => {
            useCreateAuthoredFoodMock.mockReturnValue(createMutation({ value: CREATED }));
            const port = deferredCommit();
            const { result } = renderHook(() => useAuthoredFoodCreate({ commit: port.commit }));

            act(() => result.current.open('grandma blend', ROW));
            fill(result);
            act(() => result.current.submit());
            await port.settle(outcome);

            expect(result.current.state).toMatchObject({
                kind: 'open',
                submitFailed: true,
                draft: { name: 'grandma blend', calories: '100' },
            });
        },
    );

    it('a failed create keeps the form open with its draft, and commits nothing', () => {
        useCreateAuthoredFoodMock.mockReturnValue(createMutation({ error: new Error('down') }));
        const port = deferredCommit();
        const { result } = renderHook(() => useAuthoredFoodCreate({ commit: port.commit }));

        act(() => result.current.open('grandma blend', ROW));
        fill(result);
        act(() => result.current.submit());

        expect(port.commit).not.toHaveBeenCalled();
        expect(result.current.state).toMatchObject({ kind: 'open', submitFailed: true, draft: { calories: '100' } });
    });

    it('⛔ one press, one create: submit and cancel are ignored while the create runs', () => {
        const mutation = createMutation(null, true);
        useCreateAuthoredFoodMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useAuthoredFoodCreate({ commit: deferredCommit().commit }));

        act(() => result.current.open('grandma blend', ROW));
        fill(result);
        act(() => result.current.submit());
        act(() => result.current.cancel());

        expect(mutation.mutate).not.toHaveBeenCalled();
        expect(result.current.state.kind).toBe('submitting');
    });

    it('⛔ submit and cancel are ignored while the created food is being put on the line', async () => {
        const mutation = createMutation({ value: CREATED });
        useCreateAuthoredFoodMock.mockReturnValue(mutation);
        const port = deferredCommit();
        const { result } = renderHook(() => useAuthoredFoodCreate({ commit: port.commit }));

        act(() => result.current.open('grandma blend', ROW));
        fill(result);
        act(() => result.current.submit());
        act(() => result.current.submit());
        act(() => result.current.cancel());

        expect(mutation.mutate).toHaveBeenCalledTimes(1);
        expect(result.current.state.kind).toBe('submitting');

        await port.settle(COMMITTED);
        expect(result.current.state).toEqual({ kind: 'closed' });
    });
});

describe('useAuthoredFoodCreate — the cook already has a food with this name', () => {
    /** Food's `409 DUPLICATE_AUTHORED_NAME`, as the client answers it. */
    const DUPLICATE = { value: { kind: 'duplicate', existingId: 'F_prior' } };

    it('lands in the duplicate state with the existing id, and commits nothing yet', () => {
        useCreateAuthoredFoodMock.mockReturnValue(createMutation(DUPLICATE));
        const port = deferredCommit();
        const { result } = renderHook(() => useAuthoredFoodCreate({ commit: port.commit }));

        act(() => result.current.open('grandma blend', ROW));
        fill(result);
        act(() => result.current.submit());

        expect(result.current.state).toMatchObject({
            kind: 'duplicate',
            existingFoodId: 'F_prior',
            reusePending: false,
        });
        expect(port.commit).not.toHaveBeenCalled();
    });

    it('reuse commits the EXISTING food as a catalog pick on the target, as REUSED; one press, one commit; closes when done', async () => {
        useCreateAuthoredFoodMock.mockReturnValue(createMutation(DUPLICATE));
        const port = deferredCommit();
        const { result } = renderHook(() => useAuthoredFoodCreate({ commit: port.commit }));

        act(() => result.current.open('grandma blend', TRAILING));
        fill(result);
        act(() => result.current.submit());
        act(() => result.current.reuseExisting());
        act(() => result.current.reuseExisting());

        expect(port.commit).toHaveBeenCalledTimes(1);
        expect(port.commit).toHaveBeenCalledWith(
            { kind: 'catalogFood', foodId: 'F_prior', name: 'grandma blend' },
            TRAILING,
            'reused',
        );
        expect(result.current.state).toMatchObject({ kind: 'duplicate', reusePending: true });

        await port.settle(COMMITTED);
        expect(result.current.state).toEqual({ kind: 'closed' });
    });

    it('a reuse that fails stays in the duplicate state, retryable', async () => {
        useCreateAuthoredFoodMock.mockReturnValue(createMutation(DUPLICATE));
        const port = deferredCommit();
        const { result } = renderHook(() => useAuthoredFoodCreate({ commit: port.commit }));

        act(() => result.current.open('grandma blend', ROW));
        fill(result);
        act(() => result.current.submit());
        act(() => result.current.reuseExisting());
        await port.settle({ kind: 'failed' });

        expect(result.current.state).toMatchObject({ kind: 'duplicate', reusePending: false, reuseFailed: true });

        act(() => result.current.reuseExisting());
        expect(port.commit).toHaveBeenCalledTimes(2);
    });
});

describe('useAuthoredFoodCreate — a port that throws', () => {
    it('ends like a refused commit: the form stays open with its draft, and is not stuck busy', async () => {
        useCreateAuthoredFoodMock.mockReturnValue(createMutation({ value: CREATED }));
        const commit = vi.fn(() => Promise.reject(new Error('lost')));
        const { result } = renderHook(() => useAuthoredFoodCreate({ commit }));

        act(() => result.current.open('grandma blend', ROW));
        fill(result);
        await act(async () => {
            result.current.submit();
            await Promise.resolve();
        });

        expect(result.current.state).toMatchObject({ kind: 'open', submitFailed: true });
        act(() => result.current.cancel());
        expect(result.current.state).toEqual({ kind: 'closed' });
    });
});
