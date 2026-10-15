/**
 * The handle-sync message builder: one snapshot of the whole byline, stamped with the clock the caller read from
 * the database (plan 2026-10-15-010 D6). Pure.
 */
import { describe, expect, it } from 'vitest';

import { buildHandleSyncMessage, handleSyncMessageSchema } from '../handleSync.js';

const USER = '01J9ZK8N7QF3B2X4M6T0V5C1AB';

describe('buildHandleSyncMessage', () => {
    it('carries BOTH halves of the byline and the given stamp, unchanged', () => {
        expect(
            buildHandleSyncMessage(USER, { displayName: 'Ada Lovelace', username: 'ada' }, '2026-10-15T00:00:00.000Z'),
        ).toEqual({
            userId: USER,
            displayName: 'Ada Lovelace',
            username: 'ada',
            sourceTimestamp: '2026-10-15T00:00:00.000Z',
        });
    });

    it('says null for a cook with no username, and the result satisfies the consumer contract', () => {
        const message = buildHandleSyncMessage(
            USER,
            { displayName: 'Ada', username: null },
            '2026-10-15T00:00:00.000Z',
        );

        expect(message.username).toBeNull();
        expect(handleSyncMessageSchema.safeParse(message).success).toBe(true);
    });
});
