/**
 * The per-user store-review record (S12 U2, plan 0011 KTD2): a map from user id to `{ finishes, lastRequestAt? }` under one
 * key on the device. Every rule is read from the plan's test scenarios, not from the code: a bad entry reads as not
 * loaded and is healed by the next write, and only this cook's entry is ever written, healed or removed.
 */
import { describe, expect, it, vi } from 'vitest';

import { makeMemoryKeptPort, makeSerialRunner } from '../__fixtures__/makeMemoryKeptPort.js';
import { createStoreReviewRecord, STORE_REVIEW_KEY } from '../storeReviewRecord.js';

const NOW = '2026-11-20T10:00:00.000Z';

/** How many reports named `step`: the reporter's second argument is `{ source, step }`. */
function reportsAtStep(report: ReturnType<typeof vi.fn>, step: string): number {
    return report.mock.calls.filter(([, context]) => isRecord(context) && context['step'] === step).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function setup(initial: Record<string, string> = {}) {
    const device = makeMemoryKeptPort(initial);
    const report = vi.fn();
    const clock = { value: NOW };
    const record = createStoreReviewRecord({
        port: device.port,
        exclusive: makeSerialRunner(),
        now: () => clock.value,
        report,
    });
    const stored = (): unknown => JSON.parse(device.data.get(STORE_REVIEW_KEY) ?? 'null');

    return { device, report, record, stored, clock };
}

describe('the store-review record: reading', () => {
    it('reads a cook with no entry as loaded at zero finishes', async () => {
        const { record } = setup();

        expect(await record.read('user_a')).toEqual({ finishes: 0 });
    });

    it('reads a stored entry as it is, with its last request instant', async () => {
        const { record } = setup({
            [STORE_REVIEW_KEY]: JSON.stringify({ user_a: { finishes: 3, lastRequestAt: '2026-10-01T00:00:00.000Z' } }),
        });

        expect(await record.read('user_a')).toEqual({ finishes: 3, lastRequestAt: '2026-10-01T00:00:00.000Z' });
    });

    it('reads a bad entry as not loaded, and reports it once with no user content', async () => {
        const { record, report } = setup({ [STORE_REVIEW_KEY]: JSON.stringify({ user_a: { finishes: 'many' } }) });

        expect(await record.read('user_a')).toBeUndefined();
        expect(await record.read('user_a')).toBeUndefined();
        expect(report).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(report.mock.calls)).not.toContain('many');
        expect(JSON.stringify(report.mock.calls)).not.toContain('user_a');
    });

    it.each([
        ['a negative count', { finishes: -1 }],
        ['a fractional count', { finishes: 1.5 }],
        ['a last request that is not an instant', { finishes: 2, lastRequestAt: 'yesterday' }],
        ['an entry that is not an object', 7],
    ])('reads %s as not loaded', async (_name, entry) => {
        const { record } = setup({ [STORE_REVIEW_KEY]: JSON.stringify({ user_a: entry }) });

        expect(await record.read('user_a')).toBeUndefined();
    });

    it('reads nothing readable as not loaded when the key is not a JSON object', async () => {
        for (const raw of ['not json', '[1,2]', 'null', '"text"']) {
            const { record } = setup({ [STORE_REVIEW_KEY]: raw });

            expect(await record.read('user_a'), raw).toBeUndefined();
        }
    });

    it('reads as not loaded, and reports, when the device storage cannot be read', async () => {
        const { record, report, device } = setup();

        device.state.failReads = true;

        expect(await record.read('user_a')).toBeUndefined();
        expect(report).toHaveBeenCalledTimes(1);
    });
});

describe('the store-review record: counting a finish', () => {
    it('counts each finish and keeps the last request', async () => {
        const { record, stored } = setup({
            [STORE_REVIEW_KEY]: JSON.stringify({ user_a: { finishes: 1, lastRequestAt: '2026-10-01T00:00:00.000Z' } }),
        });

        expect(await record.recordFinish('user_a')).toEqual({ finishes: 2, lastRequestAt: '2026-10-01T00:00:00.000Z' });
        expect(await record.recordFinish('user_a')).toEqual({ finishes: 3, lastRequestAt: '2026-10-01T00:00:00.000Z' });
        expect(stored()).toEqual({ user_a: { finishes: 3, lastRequestAt: '2026-10-01T00:00:00.000Z' } });
    });

    it('starts a new cook at one finish, and leaves another cook`s entry as it was', async () => {
        const other = { finishes: 5, lastRequestAt: '2026-09-01T00:00:00.000Z' };
        const { record, stored } = setup({ [STORE_REVIEW_KEY]: JSON.stringify({ user_a: other }) });

        expect(await record.recordFinish('user_b')).toEqual({ finishes: 1 });
        expect(stored()).toEqual({ user_a: other, user_b: { finishes: 1 } });
    });

    it('lets two finishes begun in the same tick both land', async () => {
        const { record, stored } = setup();

        await Promise.all([record.recordFinish('user_a'), record.recordFinish('user_a')]);

        expect(stored()).toEqual({ user_a: { finishes: 2 } });
    });

    it('heals only this cook`s bad entry, as just asked, and leaves every other entry as it was', async () => {
        const good = { finishes: 4 };
        const { record, stored, report } = setup({
            [STORE_REVIEW_KEY]: JSON.stringify({ user_a: { finishes: 'x' }, user_b: good, user_c: 'bad' }),
        });

        expect(await record.recordFinish('user_a')).toEqual({ finishes: 1, lastRequestAt: NOW });
        // The healed entry is what the next read says, and the other entries (valid and bad) are untouched.
        expect(stored()).toEqual({ user_a: { finishes: 1, lastRequestAt: NOW }, user_b: good, user_c: 'bad' });
        expect(report).toHaveBeenCalledTimes(1);
        expect(await record.read('user_a')).toEqual({ finishes: 1, lastRequestAt: NOW });
    });

    it('replaces a key that is not a JSON object with a map holding only this cook`s healed entry, and does not throw', async () => {
        const { record, stored } = setup({ [STORE_REVIEW_KEY]: '[1,2,3]' });

        await expect(record.recordFinish('user_a')).resolves.toEqual({ finishes: 1, lastRequestAt: NOW });
        expect(stored()).toEqual({ user_a: { finishes: 1, lastRequestAt: NOW } });
    });

    it('writes nothing over what it could not read, and reports', async () => {
        const { record, device, report } = setup({ [STORE_REVIEW_KEY]: JSON.stringify({ user_a: { finishes: 2 } }) });

        device.state.failReads = true;

        expect(await record.recordFinish('user_a')).toBeUndefined();
        expect(device.calls.write).toBe(0);
        expect(report).toHaveBeenCalled();
    });

    it('answers undefined, and reports, when the write fails', async () => {
        const { record, device, report } = setup();

        device.state.failWrites = true;

        expect(await record.recordFinish('user_a')).toBeUndefined();
        expect(report).toHaveBeenCalledTimes(1);
    });
});

describe('the store-review record: ids that are names on every object', () => {
    it.each(['constructor', 'toString', '__proto__'])(
        'reads %s as a cook with no entry, and counts a finish as an own entry',
        async (id) => {
            const { record, device } = setup({ [STORE_REVIEW_KEY]: JSON.stringify({}) });

            expect(await record.read(id)).toEqual({ finishes: 0 });
            expect(await record.recordFinish(id)).toEqual({ finishes: 1 });
            expect(Object.hasOwn(JSON.parse(device.data.get(STORE_REVIEW_KEY) ?? '{}'), id)).toBe(true);
        },
    );

    it('does not clear a cook whose id is only a name on every object', async () => {
        const { record, device } = setup({ [STORE_REVIEW_KEY]: JSON.stringify({ user_a: { finishes: 1 } }) });

        await record.clear('toString');

        expect(device.calls.write).toBe(0);
        expect(device.calls.remove).toBe(0);
    });
});

describe('the store-review record: noting a request', () => {
    it('sets the last request instant and keeps the finishes', async () => {
        const { record, stored } = setup({ [STORE_REVIEW_KEY]: JSON.stringify({ user_a: { finishes: 4 } }) });

        expect(await record.recordRequest('user_a')).toEqual({ finishes: 4, lastRequestAt: NOW });
        expect(stored()).toEqual({ user_a: { finishes: 4, lastRequestAt: NOW } });
    });

    it('⛔ moves the last request instant to the latest ask, not the first', async () => {
        const { record, clock } = setup();

        await record.recordRequest('user_a');
        clock.value = '2026-12-01T00:00:00.000Z';
        await record.recordRequest('user_a');

        // Mutation: keep the first instant (`current.lastRequestAt ?? now()`), and the cooldown never restarts.
        expect(await record.read('user_a')).toEqual({ finishes: 0, lastRequestAt: '2026-12-01T00:00:00.000Z' });
    });

    it('heals a bad entry as just asked, never as never asked', async () => {
        const { record } = setup({ [STORE_REVIEW_KEY]: JSON.stringify({ user_a: { lastRequestAt: 3 } }) });

        expect(await record.recordRequest('user_a')).toEqual({ finishes: 1, lastRequestAt: NOW });
    });
});

describe('the store-review record: a bad entry is reported again after it was dealt with', () => {
    const BAD = JSON.stringify({ user_a: { finishes: 'many' } });

    it('⛔ reports a bad entry once, and again when it goes bad after a finish healed it', async () => {
        const { record, report, device } = setup({ [STORE_REVIEW_KEY]: BAD });

        await record.read('user_a');
        await record.read('user_a');
        expect(report).toHaveBeenCalledTimes(1);
        await record.recordFinish('user_a');
        device.data.set(STORE_REVIEW_KEY, BAD);
        await record.read('user_a');

        // Mutation: never forget a reported cook after a write, and the second bad entry is never reported.
        expect(reportsAtStep(report, 'parse')).toBe(2);
    });

    it.each([
        ['another cook stays', { user_a: { finishes: 'many' }, user_b: { finishes: 1 } }],
        ['the cook is the last entry', { user_a: { finishes: 'many' } }],
    ])('⛔ reports a bad entry again when it goes bad after a clear removed it (%s)', async (_name, seed) => {
        const { record, report, device } = setup({ [STORE_REVIEW_KEY]: JSON.stringify(seed) });

        await record.read('user_a');
        await record.clear('user_a');
        device.data.set(STORE_REVIEW_KEY, BAD);
        await record.read('user_a');

        // Mutation: never forget a reported cook after a clear.
        expect(reportsAtStep(report, 'parse')).toBe(2);
    });

    it('⛔ reports again after a clear removed a key that was not a readable map', async () => {
        const { record, report, device } = setup({ [STORE_REVIEW_KEY]: '{"user_a":' });

        await record.read('user_a');
        await record.clear('user_a');
        device.data.set(STORE_REVIEW_KEY, '{"user_a":');
        await record.read('user_a');

        expect(reportsAtStep(report, 'parse')).toBe(2);
    });
});

describe('the store-review record: clearing a cook', () => {
    it('removes this cook`s entry and keeps every other entry', async () => {
        const other = { finishes: 2, lastRequestAt: '2026-10-01T00:00:00.000Z' };
        const { record, stored } = setup({
            [STORE_REVIEW_KEY]: JSON.stringify({ user_a: { finishes: 9 }, user_b: other, user_c: 'bad' }),
        });

        await record.clear('user_a');

        expect(stored()).toEqual({ user_b: other, user_c: 'bad' });
        expect(await record.read('user_a')).toEqual({ finishes: 0 });
    });

    it('removes the key when the last entry goes', async () => {
        const { record, device } = setup({ [STORE_REVIEW_KEY]: JSON.stringify({ user_a: { finishes: 9 } }) });

        await record.clear('user_a');

        expect(device.data.has(STORE_REVIEW_KEY)).toBe(false);
    });

    it('removes this cook`s bad entry too', async () => {
        const { record, stored } = setup({
            [STORE_REVIEW_KEY]: JSON.stringify({ user_a: 'bad', user_b: { finishes: 1 } }),
        });

        await record.clear('user_a');

        expect(stored()).toEqual({ user_b: { finishes: 1 } });
    });

    it('⛔ removes a key that is not a readable map, so a cut-off map that still holds the cook`s id does not stay', async () => {
        const { record, device } = setup({ [STORE_REVIEW_KEY]: '{"user_a":{"finishes":' });

        await record.clear('user_a');

        expect(device.data.has(STORE_REVIEW_KEY)).toBe(false);
    });

    it('writes nothing when there is no entry or no key', async () => {
        const { record, device } = setup({ [STORE_REVIEW_KEY]: JSON.stringify({ user_b: { finishes: 1 } }) });

        await record.clear('user_a');

        expect(device.calls.write).toBe(0);
        expect(device.calls.remove).toBe(0);
        expect(await setup().record.clear('user_a')).toBeUndefined();
    });

    it('with no cook id, writes nothing and reports once, with no user content', async () => {
        const { record, device, report } = setup({ [STORE_REVIEW_KEY]: JSON.stringify({ user_b: { finishes: 1 } }) });

        await record.clear(undefined);

        expect(device.calls.write).toBe(0);
        expect(device.calls.remove).toBe(0);
        expect(report).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(report.mock.calls)).not.toContain('user_b');
    });

    it('⛔ holds the same lock as a finish, so a clear and another cook`s finish begun together both land', async () => {
        const { record, stored } = setup({
            [STORE_REVIEW_KEY]: JSON.stringify({ user_a: { finishes: 3 }, user_b: { finishes: 1 } }),
        });

        await Promise.all([record.clear('user_a'), record.recordFinish('user_b')]);

        // Mutation: clear under another lock name, and one write overwrites the other, bringing the cook back or losing the count.
        expect(stored()).toEqual({ user_b: { finishes: 2 } });
    });

    it('never rejects: a storage that cannot be read or written is reported, so a close is not stranded', async () => {
        const { record, device, report } = setup({
            [STORE_REVIEW_KEY]: JSON.stringify({ user_a: { finishes: 9 }, user_b: { finishes: 1 } }),
        });

        device.state.failReads = true;
        await expect(record.clear('user_a')).resolves.toBeUndefined();
        device.state.failReads = false;
        device.state.failWrites = true;
        await expect(record.clear('user_a')).resolves.toBeUndefined();
        expect(report).toHaveBeenCalledTimes(2);
    });
});
