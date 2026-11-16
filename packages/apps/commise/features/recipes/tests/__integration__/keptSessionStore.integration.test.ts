import { describe, expect, it, vi } from 'vitest';

import { makeFakeLocks, makeFakePort } from '../../src/session/kept/__fixtures__/fakeKeptPort.js';
import { HOUR, iso, makeCooking, makeDoc, T0 } from '../../src/session/kept/__fixtures__/keptFixtures.js';
import { keptKeyFor, parseKeptDocument, serializeKeptDocument } from '../../src/session/kept/keptRecord.js';
import { createKeptSessionStore } from '../../src/session/kept/keptSessionStore.js';
import type { ExclusiveRunner } from '../../src/session/kept/keptPort.js';
import type { KeptCommand } from '../../src/session/kept/keptCommands.js';

const KEY = keptKeyFor('A');
const NOW = iso(T0 + HOUR);
const step = (index: number) => ({ index, digest: `s1:0000000${index}` });
const line = { stepIndex: 1, stepDigest: 's1:00000001', lineIndex: 0 };

/** Two tabs: two stores over ONE port and ONE lock manager (so both queue on the same lock name). */
async function twoTabs(initial: Record<string, string> = {}, locks: ExclusiveRunner = makeFakeLocks()) {
    const fake = makeFakePort(initial);
    const make = () =>
        createKeptSessionStore({
            port: fake.port,
            exclusiveOf: () => locks,
            now: () => NOW,
            report: vi.fn(),
            warn: vi.fn(),
        });
    const [a, b] = [make(), make()];

    await a.scope('A');
    await b.scope('A');

    const stored = () => {
        const parsed = parseKeptDocument(fake.data.get(KEY) ?? null);

        if (parsed.kind !== 'ok') {
            throw new Error(`expected a stored document, got ${parsed.kind}`);
        }

        return parsed.doc;
    };

    return { ...fake, a, b, stored };
}

const withSession = serializeKeptDocument(makeDoc({ rev: 1, entries: { r1: makeCooking({ step: step(1) }) } }));
const setStep6: KeptCommand = { type: 'setStep', recipeId: 'r1', step: step(5) };
const tickButter: KeptCommand = { type: 'tickPage', recipeId: 'r1', ingredientId: 'butter', ticked: true };

describe('two tabs over one record (R12, AE13, RT1)', () => {
    it('tab 1 writes step 6, then tab 2 at the older rev ticks butter: both are stored at rev 3 (mutant: last write wins)', async () => {
        const { a, b, stored } = await twoTabs({ [KEY]: withSession });

        await a.dispatch(setStep6);
        await b.dispatch(tickButter);

        expect(stored()).toMatchObject({
            rev: 3,
            entries: { r1: { kind: 'cooking', step: step(5), ticks: ['butter'] } },
        });
    });

    it('both tabs dispatch in the same tick and both changes survive (mutant: the write runs outside the lock)', async () => {
        const { a, b, stored } = await twoTabs({ [KEY]: withSession });

        await Promise.all([a.dispatch(setStep6), b.dispatch(tickButter)]);

        expect(stored()).toMatchObject({ rev: 3, entries: { r1: { step: step(5), ticks: ['butter'] } } });
    });

    it('two writes queued in the same tick on one store both survive (qse 3: no queue means last write wins)', async () => {
        const { a, stored } = await twoTabs({ [KEY]: withSession });

        await Promise.all([a.dispatch(tickButter), a.dispatch({ ...tickButter, ingredientId: 'salt' })]);

        expect(stored().entries['r1']).toMatchObject({ ticks: ['butter', 'salt'] });
    });

    it('tab 1 ends the session, then tab 2 at the older rev ticks a step line: no cooking entry exists (mutant: stale copy)', async () => {
        const { a, b, stored } = await twoTabs({ [KEY]: withSession });

        await a.dispatch({ type: 'endSession', recipeId: 'r1' });
        const outcome = await b.dispatch({ type: 'tickLine', recipeId: 'r1', line, ticked: true });

        expect(outcome).toEqual({ kind: 'unchanged' });
        expect(stored().entries['r1']).toBeUndefined();
    });

    it("startSession join: B starts, then A starts: the stored string is byte-identical after A, and A gets joined with B's step", async () => {
        const { a, b, data } = await twoTabs({
            [KEY]: serializeKeptDocument(makeDoc({ rev: 1, entries: { r1: makePageOnly() } })),
        });

        await b.dispatch({ type: 'startSession', recipeId: 'r1', step: step(3) });
        const afterB = data.get(KEY);
        const outcome = await a.dispatch({ type: 'startSession', recipeId: 'r1', step: step(0) });

        expect(outcome).toEqual({ kind: 'joined', step: step(3) });
        expect(data.get(KEY)).toBe(afterB);
    });
});

describe('a write never brings back a cleared or newer record (KTD2, KTD3)', () => {
    it('B clears, then A, still holding the old session in memory, ticks: nothing from before the clear returns (mutant: base is memory when the key is absent)', async () => {
        const { a, b, stored } = await twoTabs({ [KEY]: withSession });

        await b.clear('A');
        await a.dispatch(tickButter);

        expect(stored().entries['r1']).toEqual({ kind: 'page', ticks: ['butter'], lastTouch: NOW });
    });

    it("A's write fails, then B writes, then A dispatches: A builds on B's stored document (mutant: base is A's memory)", async () => {
        const { a, b, stored, state } = await twoTabs({ [KEY]: withSession });

        state.failWrites = true;
        await a.dispatch(tickButter);
        state.failWrites = false;
        await b.dispatch({ ...tickButter, ingredientId: 'salt' });
        await a.dispatch({ ...tickButter, ingredientId: 'pepper' });

        expect(stored().entries['r1']).toMatchObject({ ticks: ['salt', 'pepper'] });
    });
});

describe('sign-out while a write waits (AE10, KTD3)', () => {
    it('leaves no cook.v2.* key (mutant: the clear outside the lock, or no generation check)', async () => {
        const base = makeFakeLocks();
        const door = { gate: Promise.resolve(), open: () => undefined as void };
        // Every section waits at the gate, so the dispatch is inside the lock, waiting, when the clear is asked for.
        const gated: ExclusiveRunner = (name, work) =>
            base(name, async () => {
                await door.gate;

                return work();
            });
        const { a, data } = await twoTabs({ [KEY]: withSession }, gated);
        door.gate = new Promise<void>((resolve) => {
            door.open = resolve;
        });
        const waiting = a.dispatch(tickButter);
        const clearing = a.clear('A');

        door.open();
        await Promise.all([waiting, clearing]);

        expect([...data.keys()].filter((k) => k.startsWith('cook.v2.'))).toEqual([]);
        expect(a.getSnapshot()).toEqual({ status: 'loading' });
    });
});

describe('sign-out during a write (KTD3)', () => {
    it("does not publish the signed-out cook's document as ready (mutant: no generation check after the write)", async () => {
        const fake = makeFakePort({ [KEY]: withSession });
        const door = { gate: Promise.resolve(), open: () => undefined as void, writing: false };
        const slowPort = {
            ...fake.port,
            write: async (key: string, value: string) => {
                door.writing = true;
                await door.gate;

                return fake.port.write(key, value);
            },
        };
        const locks = makeFakeLocks();
        const store = createKeptSessionStore({
            port: slowPort,
            exclusiveOf: () => locks,
            now: () => NOW,
            report: vi.fn(),
            warn: vi.fn(),
        });

        await store.scope('A');
        door.gate = new Promise<void>((resolve) => {
            door.open = resolve;
        });
        const writing = store.dispatch(tickButter);

        await vi.waitFor(() => expect(door.writing).toBe(true));
        const clearing = store.clear('A');

        door.open();
        await Promise.all([writing, clearing]);

        expect(store.getSnapshot()).toEqual({ status: 'loading' });
        expect(fake.data.has(KEY)).toBe(false);
    });
});

function makePageOnly() {
    return { kind: 'page' as const, ticks: [], lastTouch: iso(T0) };
}
