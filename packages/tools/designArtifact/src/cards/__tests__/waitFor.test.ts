// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { isWaitTimeoutError, nextFrame, waitFor } from '../waitFor.js';

afterEach(() => {
    document.body.replaceChildren();
});

describe('waitFor', () => {
    it('resolves at once with what the probe already finds', async () => {
        document.body.append(Object.assign(document.createElement('p'), { id: 'here' }));

        await expect(waitFor(() => document.getElementById('here'))).resolves.toBe(document.getElementById('here'));
    });

    it('waits for a node to be added, and resolves with it', async () => {
        const waiting = waitFor(() => document.getElementById('late'));

        await nextFrame();
        document.body.append(Object.assign(document.createElement('p'), { id: 'late' }));

        await expect(waiting).resolves.toBe(document.getElementById('late'));
    });

    it('waits for a change that is not a DOM mutation (a plain value the probe reads)', async () => {
        let value = 0;
        const waiting = waitFor(() => (value >= 3 ? value : null));

        value = 3;

        await expect(waiting).resolves.toBe(3);
    });

    it('treats a falsy probe result as "not yet", but 0 as an answer', async () => {
        await expect(waitFor(() => 0)).resolves.toBe(0);
    });

    it('rejects with a named timeout that says what it waited for', async () => {
        const failure = await waitFor(() => null, { timeoutMs: 30, description: 'the menu' }).catch(
            (error: unknown) => error,
        );

        expect(isWaitTimeoutError(failure)).toBe(true);
        expect(failure).toMatchObject({ message: expect.stringContaining('the menu') });
    });

    it('stops looking once it has timed out', async () => {
        let calls = 0;

        await waitFor(
            () => {
                calls += 1;

                return null;
            },
            { timeoutMs: 30 },
        ).catch(() => undefined);

        const seen = calls;

        await new Promise((resolve) => setTimeout(resolve, 60));

        expect(calls).toBe(seen);
    });
});

describe('nextFrame', () => {
    it('resolves after a frame', async () => {
        await expect(nextFrame()).resolves.toBeUndefined();
    });
});
