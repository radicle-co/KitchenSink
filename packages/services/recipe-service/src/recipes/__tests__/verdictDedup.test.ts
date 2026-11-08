/**
 * `withoutVerdictsOnRecord` — the ONE fail-open dedup read the save path's producer and the paste matcher share before
 * they ask the review gate anything (ADR-0071 review, F15).
 *
 * What it guards: a judgement already on record is never paid for twice; an item with no key is never dropped; and an
 * unreadable verdict table asks about ALL of them (fails OPEN — a duplicate question costs money, a dropped one leaves a
 * line unjudged), saying so through the caller's own log.
 */
import { describe, expect, it, vi } from 'vitest';

import type { LineVerificationsDal } from '../dal/lineVerifications.dal.js';
import { withoutVerdictsOnRecord } from '../verdictDedup.js';

/** A verdict table holding the given keys. */
const tableWith = (
    ...keys: string[]
): Pick<LineVerificationsDal, 'findExistingKeys'> & { findExistingKeys: ReturnType<typeof vi.fn> } => ({
    findExistingKeys: vi.fn(async (asked: readonly string[]) => new Set(asked.filter((key) => keys.includes(key)))),
});

describe('withoutVerdictsOnRecord', () => {
    it('drops every item whose verdict is on record, in one keyed read', async () => {
        const table = tableWith('k2');

        const left = await withoutVerdictsOnRecord(table, ['k1', 'k2', 'k3'], (item) => item, vi.fn());

        expect(left).toStrictEqual(['k1', 'k3']);
        expect(table.findExistingKeys).toHaveBeenCalledTimes(1);
        expect(table.findExistingKeys).toHaveBeenCalledWith(['k1', 'k2', 'k3']);
    });

    it('keeps an item with no key — there is nothing to look up for it', async () => {
        const left = await withoutVerdictsOnRecord(
            tableWith('k1'),
            [{ key: null }, { key: 'k1' }],
            (item) => item.key,
            vi.fn(),
        );

        expect(left).toStrictEqual([{ key: null }]);
    });

    it('⛔ fails OPEN: an unreadable table asks about all of them, and reports why', async () => {
        const failure = new Error('verdict table unreachable');
        const onReadFailure = vi.fn();
        const table = { findExistingKeys: vi.fn().mockRejectedValue(failure) };

        const left = await withoutVerdictsOnRecord(table, ['k1', 'k2'], (item) => item, onReadFailure);

        expect(left).toStrictEqual(['k1', 'k2']);
        expect(onReadFailure).toHaveBeenCalledWith(failure);
    });

    it('reads nothing for nothing', async () => {
        const table = tableWith();

        expect(await withoutVerdictsOnRecord(table, [], (item: string) => item, vi.fn())).toStrictEqual([]);
        expect(table.findExistingKeys).not.toHaveBeenCalled();
    });
});
