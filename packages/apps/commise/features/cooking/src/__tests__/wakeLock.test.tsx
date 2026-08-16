import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { acquireWebWakeLock } from '../wakeLock';

/**
 * T-004 — web wake-lock adapter (FR-035 / REQ-007, REQ-CN-002).
 *
 * The regression these tests exist for: an earlier design registered `document.addEventListener` at
 * MODULE scope, which throws under SSR on import and leaks a listener that re-acquires the lock long
 * after the session ended.
 */

interface FakeSentinel {
    release: ReturnType<typeof vi.fn>;
}

function installWakeLockApi(): { request: ReturnType<typeof vi.fn>; sentinels: FakeSentinel[] } {
    const sentinels: FakeSentinel[] = [];
    const request = vi.fn(async () => {
        const sentinel: FakeSentinel = { release: vi.fn(async () => {}) };
        sentinels.push(sentinel);

        return sentinel;
    });
    Object.defineProperty(globalThis.navigator, 'wakeLock', { value: { request }, configurable: true });

    return { request, sentinels };
}

afterEach(() => {
    if ('wakeLock' in globalThis.navigator) {
        Reflect.deleteProperty(globalThis.navigator as unknown as Record<string, unknown>, 'wakeLock');
    }
    vi.restoreAllMocks();
});

describe('acquireWebWakeLock — happy path', () => {
    it('requests a screen wake lock on acquire', async () => {
        const { request } = installWakeLockApi();

        await acquireWebWakeLock();

        expect(request).toHaveBeenCalledWith('screen');
    });

    it('releases the sentinel when the disposer runs', async () => {
        const { sentinels } = installWakeLockApi();

        const dispose = await acquireWebWakeLock();
        await dispose();

        expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);
    });
});

describe('acquireWebWakeLock — listener lifetime (REQ-CN-002)', () => {
    it('registers no listener at module scope (structural — SSR import safety)', () => {
        // A behavioural spy cannot prove this: the module is imported before any spy can be installed.
        // So assert it structurally, on the source — every `addEventListener` must sit inside a
        // function body, never at top level. This is the exact defect that would crash an SSR route
        // with `ReferenceError: document is not defined` merely by importing the module.
        // Resolved from the package root, not `import.meta.url`: under jsdom that is an `http://` URL,
        // and `readFileSync` rejects any non-`file:` scheme. Vitest runs with cwd at the package root.
        const source = readFileSync(resolve(process.cwd(), 'src/wakeLock.ts'), 'utf8');
        const topLevelListener = source.split('\n').some((line) => /^\s{0,3}document\.addEventListener/.test(line));

        expect(topLevelListener).toBe(false);
    });

    it('does not touch document or navigator when they are undefined (SSR)', async () => {
        // Simulates the server pass: the guards must short-circuit before any DOM identifier is read.
        const originalNavigator = globalThis.navigator;
        Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'navigator');

        await expect(acquireWebWakeLock()).resolves.toBeTypeOf('function');

        Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    });

    it('adds the visibility listener on acquire and removes it on dispose', async () => {
        installWakeLockApi();
        const add = vi.spyOn(document, 'addEventListener');
        const remove = vi.spyOn(document, 'removeEventListener');

        const dispose = await acquireWebWakeLock();
        expect(add).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

        await dispose();
        expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });

    it('re-acquires when the tab becomes visible again while the session is live', async () => {
        const { request } = installWakeLockApi();

        await acquireWebWakeLock();
        expect(request).toHaveBeenCalledTimes(1);

        // Simulate the OS dropping the lock on background, then the user returning.
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.waitFor(() => {
            expect(request).toHaveBeenCalledTimes(1);
        });
    });

    it('does NOT re-acquire after the session has been disposed', async () => {
        const { request } = installWakeLockApi();

        const dispose = await acquireWebWakeLock();
        await dispose();
        document.dispatchEvent(new Event('visibilitychange'));

        // One acquisition total: the listener is gone, so returning to the tab must not take a new
        // lock for a session the user already left.
        expect(request).toHaveBeenCalledTimes(1);
    });
});

describe('acquireWebWakeLock — graceful degradation', () => {
    it('resolves to a no-op disposer when the Wake Lock API is absent', async () => {
        const dispose = await acquireWebWakeLock();

        await expect(dispose()).resolves.toBeUndefined();
    });

    it('does not throw when the request is rejected by the browser', async () => {
        const request = vi.fn(async () => {
            throw new Error('denied by permissions policy');
        });
        Object.defineProperty(globalThis.navigator, 'wakeLock', { value: { request }, configurable: true });

        const dispose = await acquireWebWakeLock();

        await expect(dispose()).resolves.toBeUndefined();
    });

    it('does not propagate a failing release into the caller unmount path', async () => {
        const request = vi.fn(async () => ({
            release: vi.fn(async () => {
                throw new Error('already released');
            }),
        }));
        Object.defineProperty(globalThis.navigator, 'wakeLock', { value: { request }, configurable: true });

        const dispose = await acquireWebWakeLock();

        await expect(dispose()).resolves.toBeUndefined();
    });
});
