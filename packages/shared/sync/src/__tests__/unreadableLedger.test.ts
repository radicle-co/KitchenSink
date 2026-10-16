/**
 * The unreadable-work ledger: how many times THIS session set unreadable bytes aside, per store object and cook.
 *
 * ⛔ WRITTEN FROM `specSharedSystem.md` §17: the notice is shown once per LOAD that set data aside, and is NEVER derived
 * from a quarantine key existing (the key lives until sign-out). So the fact is a count that starts at zero for a new
 * store object, whatever the store already holds, and moves only when `appendToQuarantine` runs.
 */
import { describe, expect, it, vi } from 'vitest';

import { appendToQuarantine } from '../quarantine.js';
import { createMemoryOutboxStore } from '../outboxStore.js';
import { unreadableLedgerFor } from '../unreadableLedger.js';

describe('unreadableLedgerFor', () => {
    it('starts at zero, even when the store already holds a quarantine from an earlier load', async () => {
        const store = createMemoryOutboxStore();

        await store.setItem('q.user_a', JSON.stringify(['from an earlier load']));

        expect(unreadableLedgerFor(store, 'user_a').count()).toBe(0);
    });

    it('is one ledger per store object and cook', () => {
        const store = createMemoryOutboxStore();

        expect(unreadableLedgerFor(store, 'user_a')).toBe(unreadableLedgerFor(store, 'user_a'));
        expect(unreadableLedgerFor(store, 'user_a')).not.toBe(unreadableLedgerFor(store, 'user_b'));
        expect(unreadableLedgerFor(store, 'user_a')).not.toBe(unreadableLedgerFor(createMemoryOutboxStore(), 'user_a'));
    });

    it('⛔ counts each set-aside through appendToQuarantine, for that cook only', async () => {
        const store = createMemoryOutboxStore();

        await appendToQuarantine(store, 'user_a', 'q.user_a', 'bytes one');
        await appendToQuarantine(store, 'user_a', 'q.user_a', 'bytes two');
        await appendToQuarantine(store, 'user_b', 'q.user_b', 'someone else');

        expect(unreadableLedgerFor(store, 'user_a').count()).toBe(2);
        expect(unreadableLedgerFor(store, 'user_b').count()).toBe(1);
    });

    it('tells a subscriber the new count on each set-aside, and stops after unsubscribe', async () => {
        const store = createMemoryOutboxStore();
        const heard = vi.fn();
        const unsubscribe = unreadableLedgerFor(store, 'user_a').subscribe(heard);

        await appendToQuarantine(store, 'user_a', 'q.user_a', 'bytes one');
        unsubscribe();
        await appendToQuarantine(store, 'user_a', 'q.user_a', 'bytes two');

        expect(heard.mock.calls).toStrictEqual([[1]]);
    });

    it('resets to zero and tells subscribers, but stays silent when already zero', async () => {
        const store = createMemoryOutboxStore();
        const ledger = unreadableLedgerFor(store, 'user_a');
        const heard = vi.fn();

        ledger.subscribe(heard);
        ledger.reset();
        expect(heard).not.toHaveBeenCalled();

        await appendToQuarantine(store, 'user_a', 'q.user_a', 'bytes');
        ledger.reset();

        expect(ledger.count()).toBe(0);
        expect(heard.mock.calls).toStrictEqual([[1], [0]]);
    });

    it('⛔ a listener that throws does not stop the others or the quarantine write', async () => {
        const store = createMemoryOutboxStore();
        const ledger = unreadableLedgerFor(store, 'user_a');
        const after = vi.fn();

        ledger.subscribe(() => {
            throw new Error('listener bug');
        });
        ledger.subscribe(after);

        await expect(appendToQuarantine(store, 'user_a', 'q.user_a', 'bytes')).resolves.toBeUndefined();
        expect(after).toHaveBeenCalledWith(1);
    });
});
