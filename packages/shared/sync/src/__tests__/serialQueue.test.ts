/**
 * The serial queue — what makes a read-modify-write over one storage key safe to call from anywhere.
 */
import { describe, expect, it } from 'vitest';

import { createSerialQueue } from '../serialQueue.js';

describe('createSerialQueue', () => {
    it('⛔ runs each piece of work only after the one before it has settled, in call order', async () => {
        const run = createSerialQueue();
        const events: string[] = [];
        let releaseFirst: (() => void) | undefined;

        const first = run(async () => {
            events.push('first:start');
            await new Promise<void>((resolve) => {
                releaseFirst = resolve;
            });
            events.push('first:end');
        });
        const second = run(async () => {
            events.push('second');
        });

        await Promise.resolve();
        releaseFirst?.();
        await Promise.all([first, second]);

        expect(events).toStrictEqual(['first:start', 'first:end', 'second']);
    });

    it('hands each caller its own result or rejection, and keeps running after a rejection', async () => {
        const run = createSerialQueue();

        const failed = run(async () => {
            throw new Error('boom');
        });
        const next = run(async () => 'next');

        await expect(failed).rejects.toThrow('boom');
        await expect(next).resolves.toBe('next');
    });
});
