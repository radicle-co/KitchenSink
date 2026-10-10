import { describe, expect, it, vi, type Mock } from 'vitest';

import {
    canHoldWakeLock,
    holdScreenWakeLock,
    type WakeLockEnvironment,
    type WakeLockSentinelLike,
} from '../wakeLock.js';

/**
 * The web Screen Wake Lock adapter (blueprint A20, build spec §6.3). The capability is a secure context AND the API on
 * `navigator`; a hold requests the screen lock, asks again when the page comes back into view (the browser drops the
 * lock whenever the page is hidden), and its release lets go of whatever it holds — including a lock that arrives
 * after the release, which would otherwise keep the screen on with nobody left to release it.
 */

interface FakeSentinel extends WakeLockSentinelLike {
    released: boolean;
    readonly release: Mock<() => Promise<void>>;
}

function sentinel(): FakeSentinel {
    const made: FakeSentinel = {
        released: false,
        release: vi.fn<() => Promise<void>>(() => {
            made.released = true;

            return Promise.resolve();
        }),
    };

    return made;
}

interface FakeEnvironment extends WakeLockEnvironment {
    visibility: DocumentVisibilityState;
    readonly request: Mock<(type: 'screen') => Promise<FakeSentinel>>;
    readonly fireVisibility: () => void;
    readonly listenerCount: () => number;
}

function environment(overrides: { secure?: boolean; api?: boolean; request?: () => Promise<FakeSentinel> } = {}) {
    const listeners = new Set<() => void>();
    const request = vi.fn<(type: 'screen') => Promise<FakeSentinel>>(
        overrides.request ?? (() => Promise.resolve(sentinel())),
    );
    const env: FakeEnvironment = {
        isSecureContext: overrides.secure ?? true,
        navigator: overrides.api === false ? {} : { wakeLock: { request } },
        visibility: 'visible',
        document: {
            get visibilityState() {
                return env.visibility;
            },
            addEventListener: (_type: 'visibilitychange', listener: () => void) => {
                listeners.add(listener);
            },
            removeEventListener: (_type: 'visibilitychange', listener: () => void) => {
                listeners.delete(listener);
            },
        },
        request,
        fireVisibility: () => {
            for (const listener of listeners) {
                listener();
            }
        },
        listenerCount: () => listeners.size,
    };

    return env;
}

/** Let every settled promise run its handlers. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('canHoldWakeLock', () => {
    it.each([
        { secure: true, api: true, expected: true },
        { secure: false, api: true, expected: false },
        { secure: true, api: false, expected: false },
        { secure: false, api: false, expected: false },
    ])('secure context $secure, API present $api → $expected', ({ secure, api, expected }) => {
        expect(canHoldWakeLock(environment({ secure, api }))).toBe(expected);
    });
});

describe('holdScreenWakeLock', () => {
    it('requests the screen lock once', async () => {
        const env = environment();

        holdScreenWakeLock(env);
        await settle();

        expect(env.request).toHaveBeenCalledTimes(1);
        expect(env.request).toHaveBeenCalledWith('screen');
    });

    it('releases the lock it holds, and stops listening', async () => {
        const held = sentinel();
        const env = environment({ request: () => Promise.resolve(held) });

        const release = holdScreenWakeLock(env);
        await settle();
        release();

        expect(held.release).toHaveBeenCalledTimes(1);
        expect(env.listenerCount()).toBe(0);
    });

    it('releases a lock that arrives after the hold was released', async () => {
        const late = sentinel();
        let grant: (value: FakeSentinel) => void = () => undefined;
        const env = environment({ request: () => new Promise((resolve) => (grant = resolve)) });

        const release = holdScreenWakeLock(env);
        release();
        grant(late);
        await settle();

        expect(late.release).toHaveBeenCalledTimes(1);
    });

    it('asks again when the page comes back into view after the browser dropped the lock', async () => {
        const first = sentinel();
        const env = environment({ request: () => Promise.resolve(first) });

        holdScreenWakeLock(env);
        await settle();
        first.released = true;
        env.visibility = 'hidden';
        env.fireVisibility();
        env.visibility = 'visible';
        env.fireVisibility();
        await settle();

        expect(env.request).toHaveBeenCalledTimes(2);
    });

    it('does not ask again while the lock it holds is still held', async () => {
        const env = environment();

        holdScreenWakeLock(env);
        await settle();
        env.fireVisibility();
        await settle();

        expect(env.request).toHaveBeenCalledTimes(1);
    });

    it('does not ask a second time while the first request is still pending', async () => {
        const env = environment({ request: () => new Promise(() => undefined) });

        holdScreenWakeLock(env);
        env.fireVisibility();
        await settle();

        expect(env.request).toHaveBeenCalledTimes(1);
    });

    it('does not ask while the page is hidden, and asks once it is shown', async () => {
        const env = environment();
        env.visibility = 'hidden';

        holdScreenWakeLock(env);
        await settle();
        expect(env.request).not.toHaveBeenCalled();

        env.visibility = 'visible';
        env.fireVisibility();
        await settle();
        expect(env.request).toHaveBeenCalledTimes(1);
    });

    it('survives a refused request and asks again on the next return to view', async () => {
        let calls = 0;
        const env = environment({
            request: () => {
                calls += 1;

                return calls === 1
                    ? Promise.reject(new DOMException('no', 'NotAllowedError'))
                    : Promise.resolve(sentinel());
            },
        });

        holdScreenWakeLock(env);
        await settle();
        env.fireVisibility();
        await settle();

        expect(env.request).toHaveBeenCalledTimes(2);
    });

    it('does nothing at all without the capability', async () => {
        const env = environment({ secure: false });

        const release = holdScreenWakeLock(env);
        await settle();
        release();

        expect(env.request).not.toHaveBeenCalled();
        expect(env.listenerCount()).toBe(0);
    });
});
