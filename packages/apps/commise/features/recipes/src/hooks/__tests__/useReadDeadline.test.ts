/**
 * {@link useReadDeadline}: one deadline per key (`docs/design/rowEditorOpenDecisions.md`, S5 list contract L1, "one
 * deadline per text covers every attempt of a half"). A new key is a new text, so it gets a fresh deadline, and a text
 * the cook comes back to is asked again on a fresh one rather than reading as already out of time.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReadDeadline } from '../useReadDeadline.js';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

/** Render the hook for `key`, with a spy for `onExpire`. */
function renderDeadline(key: string | undefined, ms = 3_000) {
    const onExpire = vi.fn<() => void>();
    const view = renderHook(
        ({ current, expire }: { current: string | undefined; expire: () => void }) =>
            useReadDeadline(current, ms, expire),
        { initialProps: { current: key, expire: onExpire } },
    );

    return {
        ...view,
        onExpire,
        rekey: (next: string | undefined) => view.rerender({ current: next, expire: onExpire }),
    };
}

/** Advance the fake clock inside `act`. */
const advance = (ms: number): void => {
    act(() => {
        vi.advanceTimersByTime(ms);
    });
};

describe('useReadDeadline', () => {
    it('is not expired before the deadline', () => {
        const { result, onExpire } = renderDeadline('egg');

        advance(2_999);

        expect(result.current).toBe(false);
        expect(onExpire).not.toHaveBeenCalled();
    });

    it('expires at the deadline, and calls onExpire once', () => {
        const { result, onExpire } = renderDeadline('egg');

        advance(3_000);
        advance(10_000);

        expect(result.current).toBe(true);
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('starts again for a new key, so the old key’s time does not count', () => {
        const { result, onExpire, rekey } = renderDeadline('egg');

        advance(2_000);
        rekey('eggs');
        advance(2_000);

        expect(result.current).toBe(false);
        expect(onExpire).not.toHaveBeenCalled();

        advance(1_000);

        expect(result.current).toBe(true);
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('never expires without a key', () => {
        const { result, onExpire } = renderDeadline(undefined);

        advance(60_000);

        expect(result.current).toBe(false);
        expect(onExpire).not.toHaveBeenCalled();
    });

    it('is not expired for a new key the moment the key changes', () => {
        const { result, rekey } = renderDeadline('egg');

        advance(3_000);
        rekey('eggs');

        expect(result.current).toBe(false);
    });

    it('gives a key the cook comes back to a fresh deadline', () => {
        const { result, onExpire, rekey } = renderDeadline('egg');

        advance(3_000);
        rekey('eggs');
        rekey('egg');

        expect(result.current).toBe(false);

        advance(3_000);

        expect(result.current).toBe(true);
        expect(onExpire).toHaveBeenCalledTimes(2);
    });

    it('calls the latest onExpire without restarting the deadline', () => {
        const first = vi.fn<() => void>();
        const latest = vi.fn<() => void>();
        const { rerender } = renderHook(({ expire }: { expire: () => void }) => useReadDeadline('egg', 3_000, expire), {
            initialProps: { expire: first },
        });

        advance(2_000);
        rerender({ expire: latest });
        advance(1_000);

        expect(first).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledTimes(1);
    });

    it('calls nothing once unmounted', () => {
        const { onExpire, unmount } = renderDeadline('egg');

        unmount();
        advance(3_000);

        expect(onExpire).not.toHaveBeenCalled();
    });
});
