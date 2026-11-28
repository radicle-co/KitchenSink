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
    type RewriteWayPort,
    type RewriteWayAnswer,
} from '../rewriteWay.js';

const AVAILABLE: RewriteWayAnswer = { kind: 'available', wayLineKey: 'keepPublicInOwnWords' };
const RAW_AVAILABLE = { kind: 'available', wayLineKey: 'keepPublicInOwnWords' };
const UNAVAILABLE: RewriteWayAnswer = { kind: 'unavailable' };
const INPUT = BLOCKED_INPUTS[0]!;
const portAnswering = (answer: () => Promise<unknown>): RewriteWayPort => ({ answer });

describeRewriteWayContract('the stub', 'unavailable', () => unavailableRewriteWay);
describeRewriteWayContract('a fake that offers the way', 'available', (io) => ({
    answer: async () => {
        await io.client.read('/recipes/rcp_1/source');

        return AVAILABLE;
    },
}));
describeRewriteWayContract('the wrapper over a fake', 'available', () =>
    failClosedRewriteWay(portAnswering(() => Promise.resolve(RAW_AVAILABLE))),
);

describe('the production binding', () => {
    it.each(BLOCKED_INPUTS.map((input) => [`${input.door}/${input.cause.kind}`, input] as const))(
        'offers no rewrite way for %s',
        async (_label, input) => {
            expect(await rewriteWay.answer(input, new AbortController().signal)).toEqual(UNAVAILABLE);
        },
    );
});

describe('failClosedRewriteWay', () => {
    afterEach(() => {
        vi.useRealTimers();
    });
    const signal = (): AbortSignal => new AbortController().signal;

    it('passes a complete answer through', async () => {
        const wrapped = failClosedRewriteWay(portAnswering(() => Promise.resolve(RAW_AVAILABLE)));
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
            portAnswering(() => Promise.resolve({ kind: 'available', wayLineKey: 'free text' })),
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
        const answer = vi.fn(() => Promise.resolve(RAW_AVAILABLE));
        expect(await failClosedRewriteWay({ answer }).answer(INPUT, controller.signal)).toEqual(UNAVAILABLE);
        expect(answer).not.toHaveBeenCalled();
    });

    it('reads no answer within the deadline as unavailable, and aborts the port', async () => {
        vi.useFakeTimers();
        let portSignal: AbortSignal | undefined;
        const spy: RewriteWayPort = {
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

    it.each([
        ['a javascript: URL', 'javascript:alert(1)'],
        ['a URL with credentials', 'https://seriouseats.com@evil.example/x'],
        ['a relative URL', '/recipes/1'],
    ])('drops the link for %s and keeps the way', async (_name, sourceUrl) => {
        const wrapped = failClosedRewriteWay(portAnswering(() => Promise.resolve({ ...RAW_AVAILABLE, sourceUrl })));
        expect(await wrapped.answer(INPUT, signal())).toEqual(AVAILABLE);
    });

    it('passes a safe link through as the checked href and host', async () => {
        const wrapped = failClosedRewriteWay(
            portAnswering(() => Promise.resolve({ ...RAW_AVAILABLE, sourceUrl: 'https://example.com/recipe' })),
        );
        expect(await wrapped.answer(INPUT, signal())).toEqual({
            ...AVAILABLE,
            link: { href: 'https://example.com/recipe', host: 'example.com' },
        });
    });

    it('removes its abort listener once settled', async () => {
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        await failClosedRewriteWay(portAnswering(() => Promise.resolve(RAW_AVAILABLE))).answer(
            INPUT,
            controller.signal,
        );
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('an answer just inside the deadline is kept', async () => {
        vi.useFakeTimers();
        const slow = portAnswering(
            () => new Promise((resolve) => setTimeout(() => resolve(RAW_AVAILABLE), REWRITE_WAY_DEADLINE_MS - 1)),
        );
        const pending = failClosedRewriteWay(slow).answer(INPUT, signal());
        await vi.advanceTimersByTimeAsync(REWRITE_WAY_DEADLINE_MS - 1);
        expect(await pending).toEqual(AVAILABLE);
    });
});
