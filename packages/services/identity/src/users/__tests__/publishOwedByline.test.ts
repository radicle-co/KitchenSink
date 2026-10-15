/**
 * `publishOwedByline` — the one step every producer route takes after a byline write commits (plan 2026-10-15-010
 * D6c): publish the snapshot, then settle the debt the write recorded, conditionally on its stamp.
 */
import { HANDLE_SYNC_PUBLISH_FAILED } from '@kitchensink/identity-core';
import { describe, expect, it, vi } from 'vitest';

import { publishOwedByline } from '../handleSync.publisher.js';

const USER = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const STAMP = new Date('2026-10-15T08:00:00.123Z');
const BYLINE = { displayName: 'Ada Lovelace', username: 'ada', stampedAt: STAMP };

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
});
