/**
 * `FoodRefsGateway` — the recipe read's source of bound lines' NAMES (plan 002 R9, R10), and the bind path's
 * one food-service check (R51).
 *
 * The read side is total: it never rejects, chunks at food's published cap, runs chunks in bounded waves under
 * one deadline, and turns every failure into `unreachable` — never `absent`, which is food's definite answer. A
 * 404 for the ROUTE is a deploy skew (ADR-0036) and must read as unreachable too. There is no name cache: plan
 * 002 R9 allows no fallback name.
 */
import { describe, expect, it, vi } from 'vitest';

import { MAX_FOOD_REFS } from '@kitchensink/schema-food';
import { UnexpectedResponseError } from '@kitchensink/food-service-client';

import { FoodRefsGateway } from '../foodRefs.gateway.js';

const CALLER = { kind: 'user', token: 't' } as never;
const UNHURRIED_DEADLINE_MS = 60_000;

type ResolveRefs = ReturnType<typeof vi.fn>;

function makeClients(resolveRefs: ResolveRefs, deadlineMs = UNHURRIED_DEADLINE_MS): never {
    const client = { resolveRefs };

    return { readClient: () => client, standard: () => client, readDeadlineMs: () => deadlineMs } as never;
}

function entriesFor(refs: readonly { kind: string; id: string }[]): { entries: unknown[] } {
    return {
        entries: refs.map((ref) => ({ outcome: 'found', ref, name: `name of ${ref.id}`, status: 'RESOLVED' })),
    };
}

describe('FoodRefsGateway.resolve', () => {
    it('answers every distinct ref, asking once however often a recipe repeats it', async () => {
        const resolveRefs = vi.fn(async (refs: { kind: string; id: string }[]) => entriesFor(refs));
        const gateway = new FoodRefsGateway(makeClients(resolveRefs));

        const lookup = await gateway.resolve(
            CALLER,
            [
                { kind: 'root', id: 'a' },
                { kind: 'root', id: 'a' },
                { kind: 'variant', id: 'a' },
            ],
            'read',
        );

        expect(resolveRefs).toHaveBeenCalledTimes(1);
        expect(resolveRefs.mock.calls[0]?.[0]).toHaveLength(2);
        expect(lookup.answers.get('root:a')).toMatchObject({ outcome: 'found', name: 'name of a', isPrivate: false });
        expect(lookup.degraded).toBe(false);
    });

    it('splits at food’s published cap rather than letting food refuse the batch', async () => {
        const resolveRefs = vi.fn(async (refs: { kind: string; id: string }[]) => entriesFor(refs));
        const refs = Array.from({ length: MAX_FOOD_REFS + 1 }, (_, index) => ({
            kind: 'root' as const,
            id: `f${index}`,
        }));

        const lookup = await new FoodRefsGateway(makeClients(resolveRefs)).resolve(CALLER, refs, 'read');

        expect(resolveRefs).toHaveBeenCalledTimes(2);
        expect(lookup.answers.size).toBe(MAX_FOOD_REFS + 1);
    });

    it('maps absent to absent, private to the caller’s own, and a null name to no name', async () => {
        const resolveRefs = vi.fn(async () => ({
            entries: [
                { outcome: 'absent', ref: { kind: 'root', id: 'gone' } },
                {
                    outcome: 'found',
                    ref: { kind: 'root', id: 'mine' },
                    name: 'my mix',
                    status: 'RESOLVED',
                    visibility: 'private',
                },
                { outcome: 'found', ref: { kind: 'root', id: 'nameless' }, name: null, status: 'RESOLVED' },
            ],
        }));

        const { answers } = await new FoodRefsGateway(makeClients(resolveRefs)).resolve(
            CALLER,
            [
                { kind: 'root', id: 'gone' },
                { kind: 'root', id: 'mine' },
                { kind: 'root', id: 'nameless' },
            ],
            'read',
        );

        expect(answers.get('root:gone')).toStrictEqual({ outcome: 'absent' });
        expect(answers.get('root:mine')).toStrictEqual({
            outcome: 'found',
            name: 'my mix',
            status: 'RESOLVED',
            isPrivate: true,
            rootId: 'mine',
        });
        expect(answers.get('root:nameless')).toMatchObject({ outcome: 'found', name: undefined });
    });

    it('⛔ a failed chunk makes its refs UNREACHABLE — never absent — and marks the lookup degraded', async () => {
        const resolveRefs = vi.fn().mockRejectedValue(new Error('socket hang up'));

        const lookup = await new FoodRefsGateway(makeClients(resolveRefs)).resolve(
            CALLER,
            [{ kind: 'root', id: 'a' }],
            'read',
        );

        expect(lookup.answers.get('root:a')).toStrictEqual({ outcome: 'unreachable' });
        expect(lookup.degraded).toBe(true);
    });

    it('⛔ a 404 for the route itself is a deploy skew, read as unreachable (ADR-0036)', async () => {
        const resolveRefs = vi.fn().mockRejectedValue(new UnexpectedResponseError(404, 'route not served'));

        const lookup = await new FoodRefsGateway(makeClients(resolveRefs)).resolve(
            CALLER,
            [{ kind: 'root', id: 'a' }],
            'read',
        );

        expect(lookup.answers.get('root:a')).toStrictEqual({ outcome: 'unreachable' });
    });

    it('⛔ never sends a caller-less request: every ref is unreachable, and nothing is asked', async () => {
        const resolveRefs = vi.fn();

        const lookup = await new FoodRefsGateway(makeClients(resolveRefs)).resolve(
            undefined,
            [{ kind: 'root', id: 'a' }],
            'read',
        );

        expect(resolveRefs).not.toHaveBeenCalled();
        expect(lookup.answers.get('root:a')).toStrictEqual({ outcome: 'unreachable' });
    });

    it('stops sending waves once the deadline has passed, and reports the unsent refs unreachable', async () => {
        const refs = Array.from({ length: MAX_FOOD_REFS * 7 }, (_, index) => ({
            kind: 'root' as const,
            id: `f${index}`,
        }));
        const resolveRefs = vi.fn(
            (chunk: { kind: string; id: string }[], options?: { signal?: AbortSignal }) =>
                new Promise((resolve) => {
                    options?.signal?.addEventListener('abort', () => resolve(entriesFor(chunk)));
                }),
        );

        const lookup = await new FoodRefsGateway(makeClients(resolveRefs, 50)).resolve(CALLER, refs, 'read');

        // Six chunks go in the first wave; the seventh is never sent.
        expect(resolveRefs).toHaveBeenCalledTimes(6);
        expect(lookup.answers.get(`root:f${MAX_FOOD_REFS * 7 - 1}`)).toStrictEqual({ outcome: 'unreachable' });
        expect(lookup.degraded).toBe(true);
    });

    it('asks for nothing when there is nothing to name', async () => {
        const resolveRefs = vi.fn();

        const lookup = await new FoodRefsGateway(makeClients(resolveRefs)).resolve(CALLER, [], 'read');

        expect(resolveRefs).not.toHaveBeenCalled();
        expect([lookup.answers.size, lookup.degraded]).toStrictEqual([0, false]);
    });
});

describe('FoodRefsGateway.resolveForBind — the bind path’s one check (R51)', () => {
    it('returns food’s answer about the one food', async () => {
        const resolveRefs = vi.fn(async (refs: { kind: string; id: string }[]) => entriesFor(refs));

        expect(
            await new FoodRefsGateway(makeClients(resolveRefs)).resolveForBind(CALLER, { kind: 'root', id: 'a' }),
        ).toMatchObject({
            outcome: 'found',
            name: 'name of a',
        });
    });

    it('⛔ throws SOURCE_UNAVAILABLE when food cannot be asked — a bind is never made on no answer', async () => {
        const resolveRefs = vi.fn().mockRejectedValue(new Error('socket hang up'));

        await expect(
            new FoodRefsGateway(makeClients(resolveRefs)).resolveForBind(CALLER, { kind: 'root', id: 'a' }),
        ).rejects.toMatchObject({ response: { code: 'SOURCE_UNAVAILABLE' } });
    });
});

describe('FoodRefsGateway — where a ref’s food lives: its live root and its variant (curated U9)', () => {
    const FLAT_PARTS = [{ attribute: 'cut', text: 'flat' }];

    /** Ask food about one ref, food answering `entry` for it. */
    async function answerFor(ref: { kind: 'root' | 'variant'; id: string }, entry: Record<string, unknown>) {
        const resolveRefs = vi.fn(async () => ({ entries: [{ ref, ...entry }] }));
        const { answers } = await new FoodRefsGateway(makeClients(resolveRefs)).resolve(CALLER, [ref], 'read');

        return answers.get(`${ref.kind}:${ref.id}`);
    }

    const found = { outcome: 'found', name: 'beef brisket', status: 'RESOLVED' };

    it.each<[string, { kind: 'root' | 'variant'; id: string }, Record<string, unknown>, Record<string, unknown>]>([
        ['a live root is its own root', { kind: 'root', id: 'R' }, found, { rootId: 'R' }],
        [
            'a live variant names its root and carries its parts',
            { kind: 'variant', id: 'V' },
            { ...found, variant: { rootId: 'R', parts: FLAT_PARTS } },
            { rootId: 'R', variant: { id: 'V', parts: FLAT_PARTS } },
        ],
        [
            'a root forwarded to a root is the root the forward ends at',
            { kind: 'root', id: 'R-old' },
            { ...found, forwardedTo: { kind: 'root', id: 'R' } },
            { rootId: 'R' },
        ],
        [
            '⛔ a root forwarded to a VARIANT reads as that variant — the line renders variant-bound',
            { kind: 'root', id: 'R-old' },
            { ...found, variant: { rootId: 'R', parts: FLAT_PARTS }, forwardedTo: { kind: 'variant', id: 'V' } },
            { rootId: 'R', variant: { id: 'V', parts: FLAT_PARTS } },
        ],
        [
            'a variant forwarded to a root reads as that root, with no variant',
            { kind: 'variant', id: 'V-old' },
            { ...found, forwardedTo: { kind: 'root', id: 'R' } },
            { rootId: 'R' },
        ],
    ])('%s', async (_, ref, entry, expected) => {
        const answer = await answerFor(ref, entry);

        expect(answer).toMatchObject({ outcome: 'found', name: 'beef brisket', ...expected });

        if (!('variant' in expected)) {
            expect(answer).not.toHaveProperty('variant');
        }
    });

    it.each<[string, { kind: 'root' | 'variant'; id: string }, Record<string, unknown>]>([
        ['a variant target with no variant facts', { kind: 'variant', id: 'V' }, found],
        [
            'a root target carrying variant facts',
            { kind: 'root', id: 'R' },
            { ...found, variant: { rootId: 'R', parts: FLAT_PARTS } },
        ],
    ])('⛔ reads food’s contract breach — %s — as UNREACHABLE, never a guess', async (_, ref, entry) => {
        expect(await answerFor(ref, entry)).toStrictEqual({ outcome: 'unreachable' });
    });

    it('⛔ a bind check that meets a contract breach throws SOURCE_UNAVAILABLE rather than refusing the food', async () => {
        const ref = { kind: 'variant' as const, id: 'V' };
        const resolveRefs = vi.fn(async () => ({ entries: [{ ref, ...found }] }));

        await expect(new FoodRefsGateway(makeClients(resolveRefs)).resolveForBind(CALLER, ref)).rejects.toMatchObject({
            response: { code: 'SOURCE_UNAVAILABLE' },
        });
    });
});
