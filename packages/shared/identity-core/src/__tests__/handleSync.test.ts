/**
 * The handle-sync message builder: one snapshot of the whole byline, stamped with the clock the caller read from
 * the database (plan 2026-10-15-010 D6). Pure.
 */
import { describe, expect, it } from 'vitest';

import {
    bylineIsPublishable,
    buildHandleSyncMessage,
    handleSyncMessageSchema,
    MAX_DISPLAY_NAME_LENGTH,
} from '../handleSync.js';

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

    // The snapshot is a CONTRACT BOUNDARY: a stored name the consumer would refuse made every later publish for
    // that cook fail forever (the debt settles `publish_failed`, and a username change re-publishes the same
    // stored name). The builder normalizes to what the consumer accepts, so an update can always settle.
    describe('normalizes the display name to what the consumer accepts', () => {
        const AT = '2026-10-15T00:00:00.000Z';

        it('trims it', () => {
            expect(buildHandleSyncMessage(USER, { displayName: '  Ada  ', username: null }, AT).displayName).toBe(
                'Ada',
            );
        });

        it('cuts a name past the bound to the bound, and the result satisfies the contract', () => {
            const message = buildHandleSyncMessage(
                USER,
                { displayName: `${'a'.repeat(120)} ${'b'.repeat(80)}`, username: 'ada' },
                AT,
            );

            expect(message.displayName).toBe('a'.repeat(MAX_DISPLAY_NAME_LENGTH));
            expect(handleSyncMessageSchema.safeParse(message).success).toBe(true);
        });

        it('never leaves half of a surrogate pair at the cut', () => {
            const message = buildHandleSyncMessage(
                USER,
                { displayName: `${'a'.repeat(MAX_DISPLAY_NAME_LENGTH - 1)}\u{1F600}`, username: null },
                AT,
            );

            expect(message.displayName).toBe('a'.repeat(MAX_DISPLAY_NAME_LENGTH - 1));
            expect(handleSyncMessageSchema.safeParse(message).success).toBe(true);
        });

        it.each(['', '   '])(
            'falls back to the username for a blank name (%j): the byline renders @handle alone',
            (blank) => {
                const message = buildHandleSyncMessage(USER, { displayName: blank, username: 'ada' }, AT);

                expect(message.displayName).toBe('ada');
                expect(handleSyncMessageSchema.safeParse(message).success).toBe(true);
            },
        );
    });
});

describe('bylineIsPublishable', () => {
    it.each([
        [{ displayName: 'Ada', username: null }, true],
        [{ displayName: '', username: 'ada' }, true],
        [{ displayName: '  ', username: null }, false],
        [{ displayName: '', username: null }, false],
    ])('%j -> %s', (byline, expected) => {
        expect(bylineIsPublishable(byline)).toBe(expected);
    });
});
