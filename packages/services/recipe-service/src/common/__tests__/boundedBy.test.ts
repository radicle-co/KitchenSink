/**
 * `boundedBy` — ends a WAIT at a request deadline without cancelling the work (ADR-0071).
 *
 * `pg` cannot cancel a pool acquire or a statement it has sent, so the request stops waiting and the work finishes in
 * the background. Each case is written against a way that goes wrong: waiting past the deadline, starting work that
 * has no time left, an abandoned rejection crashing the process, and a late result nobody collects.
 */
import { describe, expect, it, vi } from 'vitest';

import { boundedBy, isDeadlineExceededError } from '../boundedBy.js';

/** A promise the test settles by hand. */
function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

describe('boundedBy', () => {
    it('answers with the work when it finishes before the deadline', async () => {
        const controller = new AbortController();

        await expect(boundedBy(controller.signal, async () => 42)).resolves.toBe(42);
    });

    it('⛔ stops waiting when the deadline fires, though the work never finishes', async () => {
        const controller = new AbortController();
        const never = deferred<number>();
        const waiting = boundedBy(controller.signal, () => never.promise).catch((error: unknown) => error);

        controller.abort();

        expect(isDeadlineExceededError(await waiting)).toBe(true);
    });

    it('⛔ never starts work whose deadline has already passed', async () => {
        const work = vi.fn(async () => 1);

        await expect(boundedBy(AbortSignal.abort(), work)).rejects.toSatisfy(isDeadlineExceededError);
        expect(work).not.toHaveBeenCalled();
    });

    it('passes the work’s own failure through when it fails in time', async () => {
        const controller = new AbortController();

        await expect(
            boundedBy(controller.signal, async () => {
                throw new Error('statement failed');
            }),
        ).rejects.toThrow('statement failed');
    });

    it('⛔ swallows the failure of work abandoned at the deadline (no unhandled rejection)', async () => {
        const controller = new AbortController();
        const late = deferred<number>();
        const waiting = boundedBy(controller.signal, () => late.promise).catch((error: unknown) => error);

        controller.abort();
        await waiting;
        late.reject(new Error('connection reset after the request gave up'));
        await new Promise((resolve) => setImmediate(resolve));

        // Reaching here without an unhandledRejection (vitest fails the run on one) is the assertion.
        expect(true).toBe(true);
    });

    it('⛔ hands a result that lands after the deadline to onLate, so a claim can be undone', async () => {
        const controller = new AbortController();
        const late = deferred<string>();
        const onLate = vi.fn();
        const waiting = boundedBy(controller.signal, () => late.promise, onLate).catch((error: unknown) => error);

        controller.abort();
        await waiting;
        late.resolve('claimed');
        await new Promise((resolve) => setImmediate(resolve));

        expect(onLate).toHaveBeenCalledExactlyOnceWith('claimed');
    });

    it('does not call onLate for a result that arrived in time', async () => {
        const controller = new AbortController();
        const onLate = vi.fn();

        await boundedBy(controller.signal, async () => 'in time', onLate);

        expect(onLate).not.toHaveBeenCalled();
    });

    it('removes its listener from a long-lived signal once the work is done', async () => {
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');

        await boundedBy(controller.signal, async () => 1);

        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    });
});
