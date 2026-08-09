import { describe, expect, it, vi } from 'vitest';

import { createWakeLockController, noopWakeLock, type WakeLockPort } from '../wakeLockPort.js';

/**
 * T-004/T-005 shared half — the platform-free wake-lock port (FR-035 / REQ-007, REQ-CN-002).
 *
 * The platform adapters are tested in `@commise/features-cooking`; what is asserted here is the
 * balancing logic that both share, including the StrictMode double-invoke and background/foreground
 * cycles that would otherwise strand a disposer and leak the lock.
 */

/** A fake adapter that counts acquisitions and releases. */
function makeCountingPort(): { port: WakeLockPort; acquired: () => number; released: () => number } {
    let acquired = 0;
    let released = 0;

    return {
        port: async () => {
            acquired += 1;

            return async () => {
                released += 1;
            };
        },
        acquired: () => acquired,
        released: () => released,
    };
}

describe('noopWakeLock', () => {
    it('resolves and returns a disposer that also resolves', async () => {
        const dispose = await noopWakeLock();

        await expect(dispose()).resolves.toBeUndefined();
    });
});

describe('createWakeLockController — balancing', () => {
    it('acquires exactly once and releases exactly once for a normal session', async () => {
        const { port, acquired, released } = makeCountingPort();
        const controller = createWakeLockController(port);

        await controller.acquire();
        expect(controller.isHeld()).toBe(true);
        await controller.release();

        expect(acquired()).toBe(1);
        expect(released()).toBe(1);
        expect(controller.isHeld()).toBe(false);
    });

    it('does not acquire a second lock when acquire is called twice (React StrictMode double-invoke)', async () => {
        const { port, acquired, released } = makeCountingPort();
        const controller = createWakeLockController(port);

        await controller.acquire();
        await controller.acquire();
        await controller.release();

        // Two acquisitions would strand the first disposer — a lock nothing can release.
        expect(acquired()).toBe(1);
        expect(released()).toBe(1);
    });

    it('serializes concurrent acquires so a race cannot double-acquire', async () => {
        const { port, acquired } = makeCountingPort();
        const controller = createWakeLockController(port);

        await Promise.all([controller.acquire(), controller.acquire(), controller.acquire()]);

        expect(acquired()).toBe(1);
    });

    it('is idempotent on release — releasing when nothing is held is a no-op', async () => {
        const { port, released } = makeCountingPort();
        const controller = createWakeLockController(port);

        await controller.release();
        await controller.release();

        expect(released()).toBe(0);
        expect(controller.isHeld()).toBe(false);
    });

    it('supports repeated acquire/release cycles (background then foreground)', async () => {
        const { port, acquired, released } = makeCountingPort();
        const controller = createWakeLockController(port);

        await controller.acquire();
        await controller.release();
        await controller.acquire();
        await controller.release();

        expect(acquired()).toBe(2);
        expect(released()).toBe(2);
    });

    it('does not leave a stale handle behind when the disposer throws', async () => {
        const failing: WakeLockPort = async () => async () => {
            throw new Error('release failed');
        };
        const controller = createWakeLockController(failing);

        await controller.acquire();
        await expect(controller.release()).rejects.toThrow('release failed');

        // The failed release must still clear the handle, or the next acquire would silently no-op
        // and the session would run with no wake lock at all.
        expect(controller.isHeld()).toBe(false);
    });

    it('can re-acquire after a failed release', async () => {
        const dispose = vi.fn(async () => {
            throw new Error('release failed');
        });
        const controller = createWakeLockController(async () => dispose);

        await controller.acquire();
        await expect(controller.release()).rejects.toThrow();
        await controller.acquire();

        expect(controller.isHeld()).toBe(true);
    });
});
