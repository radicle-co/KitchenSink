/**
 * The store's rule for which document a command applies to (ADR-0094 sections 3 and 6): storage is the truth, memory
 * stands in only when storage could not be read, and the one document held after a failed write is used only while
 * storage still holds the rev it held then.
 */
import { describe, expect, it } from 'vitest';

import { chooseBase, replay } from '../chooseBase.js';
import { EMPTY_KEPT_DOCUMENT } from '../keptRecord.js';
import type { ParsedKept } from '../keptRecord.js';

import { iso, makeDoc, makePage, T0 } from '../__fixtures__/keptFixtures.js';
import { TICK } from '../../../detail/__fixtures__/tickKeys.js';
import type { IngredientTickKey } from '../../../common/ingredientTickKey.js';

const ok = (rev: number, ticks: readonly IngredientTickKey[] = []): ParsedKept => ({
    kind: 'ok',
    doc: makeDoc({ rev, entries: { r1: makePage({ ticks: [...ticks] }) } }),
    droppedTimerIds: [],
});
const memory = makeDoc({ rev: 9, entries: { r1: makePage({ ticks: [TICK.memory] }) } });
const tick = {
    command: { type: 'tickPage', recipeId: 'r1', line: TICK.salt, ticked: true } as const,
    at: iso(T0),
};

describe('chooseBase', () => {
    it('uses memory when storage could not be read, and never writes', () => {
        const chosen = chooseBase({ stored: undefined, pending: undefined, memory, unsaved: [tick], writable: false });

        expect(chosen).toEqual({ base: memory, storedRev: EMPTY_KEPT_DOCUMENT.rev, clearPending: false });
    });

    it('uses what storage holds, never memory, when storage was read', () => {
        const chosen = chooseBase({
            stored: ok(3, [TICK.stored]),
            pending: undefined,
            memory,
            unsaved: [],
            writable: true,
        });

        expect(chosen.base.entries['r1']).toMatchObject({ ticks: [TICK.stored] });
        expect(chosen.storedRev).toBe(3);
        expect(chosen.clearPending).toBe(true);
    });

    it('reads an absent key as empty, so a record another tab cleared does not come back from memory', () => {
        const chosen = chooseBase({
            stored: { kind: 'absent' },
            pending: undefined,
            memory,
            unsaved: [],
            writable: true,
        });

        expect(chosen.base).toEqual(EMPTY_KEPT_DOCUMENT);
    });

    it('uses the document held after a failed write while storage still holds the rev it held then', () => {
        const held = makeDoc({ rev: 4, entries: { r1: makePage({ ticks: [TICK.held] }) } });
        const chosen = chooseBase({
            stored: ok(3, [TICK.stored]),
            pending: { fromRev: 3, doc: held },
            memory,
            unsaved: [],
            writable: true,
        });

        expect(chosen.base).toEqual(held);
        expect(chosen.clearPending).toBe(false);
    });

    it('drops the held document and uses storage once another writer moved the rev', () => {
        const chosen = chooseBase({
            stored: ok(5, [TICK.stored]),
            pending: { fromRev: 3, doc: memory },
            memory,
            unsaved: [],
            writable: true,
        });

        expect(chosen.base.entries['r1']).toMatchObject({ ticks: [TICK.stored] });
        expect(chosen.clearPending).toBe(true);
    });

    it('treats an unreadable record as rev 0, so a held document from rev 0 still applies', () => {
        const held = makeDoc({ rev: 1, entries: { r1: makePage({ ticks: [TICK.held] }) } });
        const chosen = chooseBase({
            stored: { kind: 'invalid' },
            pending: { fromRev: 0, doc: held },
            memory,
            unsaved: [],
            writable: true,
        });

        expect(chosen.base).toEqual(held);
        expect(chosen.storedRev).toBe(0);
    });

    it('replays the unsaved commands on top of the chosen document only when it can write', () => {
        const base = chooseBase({ stored: ok(3), pending: undefined, memory, unsaved: [tick], writable: true }).base;
        const notWritable = chooseBase({ stored: ok(3), pending: undefined, memory, unsaved: [tick], writable: false });

        expect(base.entries['r1']).toMatchObject({ ticks: [TICK.salt] });
        expect(notWritable.base.entries['r1']).toMatchObject({ ticks: [] });
    });
});

describe('replay', () => {
    it('applies each command in the order it was made', () => {
        const replayed = replay(makeDoc(), [tick, { ...tick, command: { ...tick.command, line: TICK.oil } }]);

        expect(replayed.entries['r1']).toMatchObject({ ticks: [TICK.salt, TICK.oil] });
    });
});
