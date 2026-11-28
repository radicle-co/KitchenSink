/**
 * The rewrite seam (heldPublicSave U2, AE5): the stub, a fake, the production binding and the fail-closed wrapper.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeRewriteWayContract, BLOCKED_INPUTS } from '../__fixtures__/describeRewriteWayContract.js';
import {
    REWRITE_WAY_DEADLINE_MS,
    failClosedRewriteWay,
    rewriteWay,
    unavailableRewriteWay,
    type RewriteWay,
    type RewriteWayAnswer,
} from '../rewriteWay.js';

const AVAILABLE: RewriteWayAnswer = { kind: 'available', wayLineKey: 'keepPublicInOwnWords' };
const UNAVAILABLE: RewriteWayAnswer = { kind: 'unavailable' };
const INPUT = BLOCKED_INPUTS[0]!;
const portAnswering = (answer: () => Promise<RewriteWayAnswer>): RewriteWay => ({ answer });

describeRewriteWayContract('the stub', 'unavailable', () => unavailableRewriteWay);
describeRewriteWayContract('a fake that offers the way', 'available', (io) => ({
    answer: async () => {
        await io.client.read('/recipes/rcp_1/source');

        return AVAILABLE;
    },
}));
describeRewriteWayContract('the wrapper over a fake', 'available', () =>
    failClosedRewriteWay(portAnswering(() => Promise.resolve(AVAILABLE))),
);

describe('the production binding', () => {
    it.each(BLOCKED_INPUTS.map((input) => [`${input.door}/${input.cause.kind}`, input] as const))(
        'offers no rewrite way for %s',
        async (_label, input) => {
            expect(await rewriteWay.answer(input, new AbortController().signal)).toEqual(UNAVAILABLE);
        },
    );

    it.each([true, false])('offers no rewrite way with the toggle %s', async (on) => {
        vi.resetModules();
        vi.doMock('../heldSaveToggle.js', () => ({ HELD_SAVE_WAYS_OUT_ON: on }));
        const fresh = await import('../rewriteWay.js');
        expect(await fresh.rewriteWay.answer(INPUT, new AbortController().signal)).toEqual(UNAVAILABLE);
        vi.doUnmock('../heldSaveToggle.js');
    });
});

describe('failClosedRewriteWay', () => {
    afterEach(() => {
        vi.useRealTimers();
    });
    const signal = (): AbortSignal => new AbortController().signal;

    it('passes a complete answer through', async () => {
        const wrapped = failClosedRewriteWay(portAnswering(() => Promise.resolve(AVAILABLE)));
        expect(await wrapped.answer(INPUT, signal())).toEqual(AVAILABLE);
    });

    it('reads a throw as unavailable', async () => {
        const wrapped = failClosedRewriteWay(
            portAnswering(() => {
                throw new Error('boom');
            }),
        );
        expect(await wrapped.answer(INPUT, signal())).toEqual(UNAVAILABLE);
    });

    it('reads a rejection as unavailable', async () => {
        const wrapped = failClosedRewriteWay(portAnswering(() => Promise.reject(new Error('boom'))));
        expect(await wrapped.answer(INPUT, signal())).toEqual(UNAVAILABLE);
    });

    it('reads an answer outside the closed set as unavailable', async () => {
        const wrapped = failClosedRewriteWay(
            portAnswering(() => Promise.resolve({ kind: 'available', wayLineKey: 'free text' } as never)),
        );
        expect(await wrapped.answer(INPUT, signal())).toEqual(UNAVAILABLE);
    });

    it('reads an abort before the answer as unavailable', async () => {
        const controller = new AbortController();
        const wrapped = failClosedRewriteWay(portAnswering(() => new Promise(() => undefined)));
        const pending = wrapped.answer(INPUT, controller.signal);
        controller.abort();
        expect(await pending).toEqual(UNAVAILABLE);
    });

    it('reads an already aborted signal as unavailable without asking the port', async () => {
        const controller = new AbortController();
        controller.abort();
        const answer = vi.fn(() => Promise.resolve(AVAILABLE));
        expect(await failClosedRewriteWay({ answer }).answer(INPUT, controller.signal)).toEqual(UNAVAILABLE);
        expect(answer).not.toHaveBeenCalled();
    });

    it('reads no answer within the deadline as unavailable, and aborts the port', async () => {
        vi.useFakeTimers();
        let portSignal: AbortSignal | undefined;
        const spy: RewriteWay = {
            answer: (_input, s) => {
                portSignal = s;

                return new Promise(() => undefined);
            },
        };
        const pending = failClosedRewriteWay(spy).answer(INPUT, signal());
        await vi.advanceTimersByTimeAsync(REWRITE_WAY_DEADLINE_MS - 1);
        expect(portSignal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await pending).toEqual(UNAVAILABLE);
        expect(portSignal?.aborted).toBe(true);
    });

    it('an answer just inside the deadline is kept', async () => {
        vi.useFakeTimers();
        const slow = portAnswering(
            () => new Promise((resolve) => setTimeout(() => resolve(AVAILABLE), REWRITE_WAY_DEADLINE_MS - 1)),
        );
        const pending = failClosedRewriteWay(slow).answer(INPUT, signal());
        await vi.advanceTimersByTimeAsync(REWRITE_WAY_DEADLINE_MS - 1);
        expect(await pending).toEqual(AVAILABLE);
    });
});
