/**
 * The bounded replay of a refused bearer, shared by the food, recipe and profile clients (`../bearerReplay.ts`).
 *
 * One table pins the rule: when a send is sent again, with which bearer, after how long, and which attempt is the
 * answer. The send double answers a scripted verdict per send (the last one repeats) and returns a fresh object each
 * time, so "the answer" is asserted by identity: the replay hands back an attempt unchanged, never a copy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    withBearerReplay,
    type BearerVerdict,
    type IdentitySyncBackoffOptions,
    type TokenSource,
} from '../bearerReplay.js';

/** How the case's bearer is supplied. */
type TokenKind = 'minting' | 'sameAnswer' | 'literal' | 'none';

/** When the case's caller stops waiting, if it does. */
type CallerSignal = 'live' | 'stopsAfterFirstSend' | 'stopsWhileWaiting';

/** One send's answer, as the double returns it. */
interface Attempt {
    readonly send: number;
    readonly verdict: BearerVerdict;
}

interface ReplayCase {
    /** What each send answers, in order; the last one repeats. */
    readonly verdicts: readonly BearerVerdict[];
    readonly token: TokenKind;
    readonly forceRefreshFirst?: boolean;
    readonly backoff?: Omit<IdentitySyncBackoffOptions, 'sleep'>;
    readonly signal?: CallerSignal;
    /** The bearer each send carried, in order. */
    readonly sent: readonly (string | undefined)[];
    /** The `forceRefresh` of each mint, in order. */
    readonly mints: readonly boolean[];
    /** Each back-off the replay waited, in milliseconds. */
    readonly waits: readonly number[];
}

const SYNC: BearerVerdict = 'identitySyncPending';

const CASES: readonly (readonly [string, ReplayCase])[] = [
    [
        'an answer is returned after one send, with no fresh mint',
        { verdicts: ['answered'], token: 'minting', sent: ['tok-1'], mints: [false], waits: [] },
    ],
    [
        'a refusal is replayed once with a freshly minted bearer',
        {
            verdicts: ['refused', 'answered'],
            token: 'minting',
            sent: ['tok-1', 'tok-2'],
            mints: [false, true],
            waits: [],
        },
    ],
    [
        'a second refusal is the answer: one replay, never two',
        {
            verdicts: ['refused', 'refused', 'answered'],
            token: 'minting',
            sent: ['tok-1', 'tok-2'],
            mints: [false, true],
            waits: [],
        },
    ],
    [
        'a refusal is not replayed when the fresh mint answers the refused bearer',
        { verdicts: ['refused', 'answered'], token: 'sameAnswer', sent: ['tok-same'], mints: [false, true], waits: [] },
    ],
    [
        'a literal bearer is never minted again, so never replayed',
        { verdicts: ['refused', 'answered'], token: 'literal', sent: ['tok-literal'], mints: [], waits: [] },
    ],
    [
        'no bearer is never replayed',
        { verdicts: ['refused', 'answered'], token: 'none', sent: [undefined], mints: [], waits: [] },
    ],
    [
        'identity sync pending waits, then replays with a fresh bearer',
        {
            verdicts: [SYNC, 'answered'],
            token: 'minting',
            sent: ['tok-1', 'tok-2'],
            mints: [false, true],
            waits: [250],
        },
    ],
    [
        'a persistent identity sync pending walks the default back-off, then is the answer',
        {
            verdicts: [SYNC],
            token: 'minting',
            sent: ['tok-1', 'tok-2', 'tok-3', 'tok-4'],
            mints: [false, true, true, true],
            waits: [250, 500, 1000],
        },
    ],
    [
        'the back-off repeats its last entry when the retries outnumber it',
        {
            verdicts: [SYNC],
            token: 'minting',
            backoff: { maxIdentitySyncRetries: 3, identitySyncBackoffMs: [10, 20] },
            sent: ['tok-1', 'tok-2', 'tok-3', 'tok-4'],
            mints: [false, true, true, true],
            waits: [10, 20, 20],
        },
    ],
    [
        'no identity sync retries means no wait and no replay',
        {
            verdicts: [SYNC, 'answered'],
            token: 'minting',
            backoff: { maxIdentitySyncRetries: 0 },
            sent: ['tok-1'],
            mints: [false],
            waits: [],
        },
    ],
    [
        'identity sync pending is not replayed when the fresh mint answers the refused bearer',
        { verdicts: [SYNC, 'answered'], token: 'sameAnswer', sent: ['tok-same'], mints: [false, true], waits: [250] },
    ],
    [
        'identity sync pending with a literal bearer neither waits nor replays',
        { verdicts: [SYNC, 'answered'], token: 'literal', sent: ['tok-literal'], mints: [], waits: [] },
    ],
    [
        'the back-off and the refusal’s one replay are separate budgets',
        {
            verdicts: [SYNC, SYNC, SYNC, 'refused', 'answered'],
            token: 'minting',
            sent: ['tok-1', 'tok-2', 'tok-3', 'tok-4', 'tok-5'],
            mints: [false, true, true, true, true],
            waits: [250, 500, 1000],
        },
    ],
    [
        'the first mint can be asked to skip the cache (a caller-forced read)',
        {
            verdicts: ['answered'],
            token: 'minting',
            forceRefreshFirst: true,
            sent: ['tok-1'],
            mints: [true],
            waits: [],
        },
    ],
    [
        'a caller that has stopped waiting gets the refusal, with no fresh mint or send',
        {
            verdicts: ['refused', 'answered'],
            token: 'minting',
            signal: 'stopsAfterFirstSend',
            sent: ['tok-1'],
            mints: [false],
            waits: [],
        },
    ],
    [
        'a caller that stops waiting during the back-off gets the refusal, with no fresh mint or send',
        {
            verdicts: [SYNC, 'answered'],
            token: 'minting',
            signal: 'stopsWhileWaiting',
            sent: ['tok-1'],
            mints: [false],
            waits: [250],
        },
    ],
];

/**
 * The case's token source, recording the `forceRefresh` of each mint.
 *
 * @param kind - How the bearer is supplied.
 * @param mints - Where each mint's `forceRefresh` is recorded.
 * @returns The source.
 */
function tokenOf(kind: TokenKind, mints: boolean[]): TokenSource | undefined {
    switch (kind) {
        case 'minting':
            return (options) => {
                mints.push(options?.forceRefresh === true);

                return `tok-${String(mints.length)}`;
            };

        case 'sameAnswer':
            return async (options) => {
                mints.push(options?.forceRefresh === true);

                return 'tok-same';
            };

        case 'literal':
            return 'tok-literal';
        case 'none':
            return undefined;
    }
}

describe('withBearerReplay', () => {
    it.each(CASES)('%s', async (_label, testCase) => {
        const mints: boolean[] = [];
        const sent: (string | undefined)[] = [];
        const waits: number[] = [];
        const attempts: Attempt[] = [];
        const caller = new AbortController();

        const result = await withBearerReplay<Attempt>({
            token: tokenOf(testCase.token, mints),
            forceRefreshFirst: testCase.forceRefreshFirst,
            signal: caller.signal,
            backoff: {
                ...testCase.backoff,
                sleep: async (ms) => {
                    waits.push(ms);

                    if (testCase.signal === 'stopsWhileWaiting') {
                        caller.abort();
                    }
                },
            },
            send: async (bearer) => {
                sent.push(bearer);

                const verdict = testCase.verdicts[attempts.length] ?? testCase.verdicts.at(-1) ?? 'answered';
                const attempt = { send: attempts.length + 1, verdict };

                attempts.push(attempt);

                if (testCase.signal === 'stopsAfterFirstSend') {
                    caller.abort();
                }

                return attempt;
            },
            verdictOf: (attempt) => attempt.verdict,
        });

        expect(sent).toStrictEqual(testCase.sent);
        expect(mints).toStrictEqual(testCase.mints);
        expect(waits).toStrictEqual(testCase.waits);
        // The answer is the last attempt sent, handed back as it is.
        expect(result).toBe(attempts.at(-1));
    });

    it('propagates a fresh mint that fails, and sends nothing more', async () => {
        const send = vi.fn(async () => 'refused' as const);
        const refusal = new Error('the session changed');

        await expect(
            withBearerReplay({
                token: (options) => {
                    if (options?.forceRefresh === true) {
                        throw refusal;
                    }

                    return 'tok-1';
                },
                send,
                verdictOf: (attempt) => attempt,
            }),
        ).rejects.toBe(refusal);
        expect(send).toHaveBeenCalledTimes(1);
    });

    describe('the default wait', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('waits the back-off on the clock', async () => {
            vi.useFakeTimers();

            const send = vi.fn(async () => (send.mock.calls.length === 1 ? SYNC : 'answered'));
            let minted = 0;
            const replayed = withBearerReplay({
                token: () => {
                    minted += 1;

                    return `tok-${String(minted)}`;
                },
                send,
                verdictOf: (verdict) => verdict,
            });

            await vi.advanceTimersByTimeAsync(249);
            expect(send).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            await expect(replayed).resolves.toBe('answered');
            expect(send).toHaveBeenCalledTimes(2);
        });

        it('ends when the caller stops waiting, without the clock moving', async () => {
            vi.useFakeTimers();

            const caller = new AbortController();
            const send = vi.fn(async () => SYNC);
            const replayed = withBearerReplay({
                token: () => `tok-${String(send.mock.calls.length)}`,
                send,
                verdictOf: (verdict) => verdict,
                signal: caller.signal,
            });

            await vi.advanceTimersByTimeAsync(0);
            caller.abort();

            await expect(replayed).resolves.toBe(SYNC);
            expect(send).toHaveBeenCalledTimes(1);
        });
    });
});
