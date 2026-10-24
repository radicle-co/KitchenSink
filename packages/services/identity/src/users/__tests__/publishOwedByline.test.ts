/**
 * `publishOwedByline` — the one step every producer route takes after a byline write commits (plan 2026-10-15-010
 * D6c): publish the snapshot, then settle the debt the write recorded, conditionally on its stamp.
 */
import { HANDLE_SYNC_PUBLISH_FAILED } from '@kitchensink/identity-core';
import { newUserId, type UserId } from '@kitchensink/identity-db';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { publishOwedByline, type SettleHandleSync } from '../handleSync.publisher.js';

const USER = newUserId();
const STAMP = new Date('2026-10-15T08:00:00.123Z');
const BYLINE = { displayName: 'Ada Lovelace', username: 'ada', stampedAt: STAMP };

describe('SettleHandleSync', () => {
    // The port names the id it settles, so a route cannot hand it an account id or a bare string, and no caller
    // launders one with a cast inside its settle lambda (plan 2026-10-13-007, Wave 1).
    it('takes a UserId, the same brand UserDAO.settleHandleSync takes', () => {
        expectTypeOf<Parameters<SettleHandleSync>[0]>().toEqualTypeOf<UserId>();
        expectTypeOf<Parameters<typeof publishOwedByline>[2]>().toEqualTypeOf<UserId>();
    });
});

describe('publishOwedByline', () => {
    it('publishes the WHOLE snapshot keyed by the write’s own stamp, then clears exactly that debt', async () => {
        const publish = vi.fn().mockResolvedValue(undefined);
        const settle = vi.fn().mockResolvedValue(undefined);

        const outcome = await publishOwedByline({ publish }, settle, USER, BYLINE);

        expect(publish).toHaveBeenCalledWith({
            userId: USER,
            displayName: 'Ada Lovelace',
            username: 'ada',
            sourceTimestamp: '2026-10-15T08:00:00.123Z',
        });
        expect(settle).toHaveBeenCalledWith(USER, STAMP, null);
        expect(outcome).toEqual({ outcome: 'published' });
        expect(publish.mock.invocationCallOrder[0]).toBeLessThan(settle.mock.invocationCallOrder[0]!);
    });

    it('leaves the debt with a failure CODE — never the error text — when the publish fails', async () => {
        const error = new Error('sns down for Ada Lovelace');
        const settle = vi.fn().mockResolvedValue(undefined);

        const outcome = await publishOwedByline({ publish: vi.fn().mockRejectedValue(error) }, settle, USER, BYLINE);

        expect(settle).toHaveBeenCalledTimes(1);
        expect(settle).toHaveBeenCalledWith(USER, STAMP, HANDLE_SYNC_PUBLISH_FAILED);
        expect(outcome).toEqual({ outcome: 'owed', error, settleError: undefined });
    });

    it('never throws: a failure to record the code is reported, and the debt keeps its stamp', async () => {
        const settleError = new Error('db down');
        const settle = vi.fn().mockRejectedValue(settleError);

        const outcome = await publishOwedByline(
            { publish: vi.fn().mockRejectedValue(new Error('sns down')) },
            settle,
            USER,
            BYLINE,
        );

        expect(outcome).toMatchObject({ outcome: 'owed', settleError });
    });

    // A stored name the consumer refuses used to settle `publish_failed` forever, and the same stored name failed
    // every later sync for that cook. The snapshot is normalized to the contract before it is published.
    it('publishes a stored name past the bound cut to the bound, so the debt can settle', async () => {
        const publish = vi.fn().mockResolvedValue(undefined);
        const settle = vi.fn().mockResolvedValue(undefined);

        const outcome = await publishOwedByline({ publish }, settle, USER, { ...BYLINE, displayName: 'x'.repeat(150) });

        expect(publish).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'x'.repeat(100) }));
        expect(settle).toHaveBeenCalledWith(USER, STAMP, null);
        expect(outcome).toEqual({ outcome: 'published' });
    });

    it('publishes the username as the name of a cook whose name is blank', async () => {
        const publish = vi.fn().mockResolvedValue(undefined);

        await publishOwedByline({ publish }, vi.fn().mockResolvedValue(undefined), USER, {
            ...BYLINE,
            displayName: '',
        });

        expect(publish).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'ada', username: 'ada' }));
    });

    it('settles the debt WITHOUT publishing when the byline has neither a name nor a username', async () => {
        const publish = vi.fn().mockResolvedValue(undefined);
        const settle = vi.fn().mockResolvedValue(undefined);

        const outcome = await publishOwedByline({ publish }, settle, USER, {
            displayName: '  ',
            username: null,
            stampedAt: STAMP,
        });

        expect(publish).not.toHaveBeenCalled();
        expect(settle).toHaveBeenCalledWith(USER, STAMP, null);
        expect(outcome).toEqual({ outcome: 'nothing_to_publish' });
    });
});
