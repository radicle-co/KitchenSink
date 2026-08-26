/**
 * AUTO-SAVE (U34, owner ruling 2026-08-25 — "build it for real").
 *
 * ⛔ **Nothing shipped before this.** `grep autosav` matched nothing in the repo, and the mockup's
 * "Auto-saved 2 minutes ago" is a hardcoded literal with no handler behind it. So the risk here is not the
 * label and it is not the timer — it is the LOST UPDATE, which is why these tests are shaped around
 * `expectedVersion` and the 409 rather than around elapsed milliseconds.
 *
 * The four properties, in the order they matter:
 *
 *  1. ⛔ **A concurrent edit must SURFACE, never be overwritten.** Auto-save writes with the same optimistic
 *     concurrency token a manual save uses. If it ever wrote without one — or with a stale one it then
 *     retried past — an unattended background write would silently clobber a change made on another device.
 *     A ceiling on how bad that can get is the whole reason this hook delegates its write instead of
 *     issuing one: it calls the SAME `saveDraft` the button calls, and `useRecipeEditor` owns the token and
 *     the 409-to-conflict transition.
 *  2. ⛔ **It writes a DRAFT and never publishes.** It calls `saveDraft`, never `publish`. An unattended
 *     write that flipped a private work-in-progress to `published` would be a disclosure, not a save.
 *  3. ⛔ **It never fires on an untouched form.** Opening a recipe and reading it must not write to it —
 *     that would mint a version row, bump `currentVersion`, and make every other device's draft stale for
 *     nothing.
 *  4. ⛔ **It does not fire while a save is already in flight**, and it does not fire while the editor is
 *     showing a conflict the cook has not resolved. Both would be writes issued INTO an unresolved race.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { FC } from 'react';

import { AUTO_SAVE_INTERVAL_MS, useRecipeAutoSave } from '../useRecipeAutoSave.js';

afterEach(cleanup);

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

interface HarnessProps {
    readonly isDirty: boolean;
    readonly enabled?: boolean;
    readonly saveDraft: () => void;
}

const Harness: FC<HarnessProps> = ({ isDirty, enabled = true, saveDraft }) => {
    useRecipeAutoSave({ isDirty, enabled, saveDraft });

    return null;
};

/** Advance past the debounce window inside `act`, so React flushes the effects the timer schedules. */
const settle = (ms = AUTO_SAVE_INTERVAL_MS): void => {
    act(() => {
        vi.advanceTimersByTime(ms);
    });
};

describe('useRecipeAutoSave — it never fires on an untouched form', () => {
    it('does not write when the draft has no unsaved edits', () => {
        const saveDraft = vi.fn();

        render(<Harness isDirty={false} saveDraft={saveDraft} />);
        settle(AUTO_SAVE_INTERVAL_MS * 5);

        expect(saveDraft).not.toHaveBeenCalled();
    });

    it('does not write merely because the editor mounted', () => {
        // Opening a recipe and reading it must not mint a version row.
        const saveDraft = vi.fn();

        render(<Harness isDirty={false} saveDraft={saveDraft} />);
        settle();

        expect(saveDraft).not.toHaveBeenCalled();
    });

    it('stops writing once the draft is clean again', () => {
        const saveDraft = vi.fn();
        const { rerender } = render(<Harness isDirty saveDraft={saveDraft} />);

        settle();
        expect(saveDraft).toHaveBeenCalledTimes(1);

        rerender(<Harness isDirty={false} saveDraft={saveDraft} />);
        settle(AUTO_SAVE_INTERVAL_MS * 5);

        expect(saveDraft).toHaveBeenCalledTimes(1);
    });
});

describe('useRecipeAutoSave — the debounce', () => {
    it('waits out the quiet window before writing', () => {
        const saveDraft = vi.fn();

        render(<Harness isDirty saveDraft={saveDraft} />);

        settle(AUTO_SAVE_INTERVAL_MS - 1);
        expect(saveDraft).not.toHaveBeenCalled();

        settle(1);
        expect(saveDraft).toHaveBeenCalledTimes(1);
    });

    it('writes ONCE for a burst of edits, not once per keystroke', () => {
        // A cook typing a title must not issue a PATCH per character.
        const saveDraft = vi.fn();
        const { rerender } = render(<Harness isDirty saveDraft={saveDraft} />);

        for (let i = 0; i < 5; i += 1) {
            settle(AUTO_SAVE_INTERVAL_MS / 2);
            rerender(<Harness isDirty saveDraft={saveDraft} />);
        }

        settle();

        expect(saveDraft).toHaveBeenCalledTimes(1);
    });

    /**
     * ⛔ THE PROPERTY THAT MAKES FIVE MINUTES SAFE (owner ruling 2026-08-26).
     *
     * This is an INTERVAL from the first unsaved edit, not a debounce from the last one. A cook who keeps
     * typing is still written at the original deadline — under a debounce of the same length they would
     * never be written at all, which is exactly when unsaved work is most at risk.
     *
     * ⚠️ The neighbouring burst test does NOT prove this: it passes under either behaviour. This one
     * distinguishes them, by editing part-way through the window and asserting the deadline did not move.
     */
    it('fires on its original deadline even though the cook kept editing', () => {
        const saveDraft = vi.fn();
        const { rerender } = render(<Harness isDirty saveDraft={saveDraft} />);

        settle(AUTO_SAVE_INTERVAL_MS * 0.75);
        rerender(<Harness isDirty saveDraft={saveDraft} />);
        settle(AUTO_SAVE_INTERVAL_MS * 0.5);

        expect(saveDraft).toHaveBeenCalledTimes(1);
    });

    it('cancels a pending write when the editor unmounts', () => {
        // A timer that fires after unmount writes on behalf of a screen the cook has left.
        const saveDraft = vi.fn();
        const { unmount } = render(<Harness isDirty saveDraft={saveDraft} />);

        unmount();
        settle(AUTO_SAVE_INTERVAL_MS * 5);

        expect(saveDraft).not.toHaveBeenCalled();
    });
});

describe('useRecipeAutoSave — it is DISABLED whenever a write would land in an unresolved race', () => {
    it('does not write while `enabled` is false', () => {
        // The container passes `enabled: false` while a save is in flight, while the editor is showing a
        // conflict, and while the recipe has not loaded — every case where the version token this write
        // would carry is either already committed to another request or known to be stale.
        const saveDraft = vi.fn();

        render(<Harness isDirty enabled={false} saveDraft={saveDraft} />);
        settle(AUTO_SAVE_INTERVAL_MS * 5);

        expect(saveDraft).not.toHaveBeenCalled();
    });

    it('resumes once it is enabled again, without needing a fresh edit', () => {
        const saveDraft = vi.fn();
        const { rerender } = render(<Harness isDirty enabled={false} saveDraft={saveDraft} />);

        settle(AUTO_SAVE_INTERVAL_MS * 5);
        expect(saveDraft).not.toHaveBeenCalled();

        rerender(<Harness isDirty enabled saveDraft={saveDraft} />);
        settle();

        expect(saveDraft).toHaveBeenCalledTimes(1);
    });

    it('does not queue up the writes it skipped while disabled', () => {
        // A burst of suppressed timers must not all fire at once on re-enable.
        const saveDraft = vi.fn();
        const { rerender } = render(<Harness isDirty enabled={false} saveDraft={saveDraft} />);

        for (let i = 0; i < 5; i += 1) {
            settle(AUTO_SAVE_INTERVAL_MS);
            rerender(<Harness isDirty enabled={false} saveDraft={saveDraft} />);
        }

        rerender(<Harness isDirty enabled saveDraft={saveDraft} />);
        settle(AUTO_SAVE_INTERVAL_MS * 5);

        expect(saveDraft).toHaveBeenCalledTimes(1);
    });
});

describe('useRecipeAutoSave — WHAT it calls', () => {
    it('calls the DRAFT save, and is given no way to publish', () => {
        // ⛔ Structural, not behavioural: the hook's options carry `saveDraft` and nothing else that writes.
        // There is no `publish` in scope for it to reach, so an unattended write cannot flip publication
        // state however the hook is later changed.
        const saveDraft = vi.fn();

        render(<Harness isDirty saveDraft={saveDraft} />);
        settle();

        expect(saveDraft).toHaveBeenCalledTimes(1);
        expect(saveDraft).toHaveBeenCalledWith();
    });
});
