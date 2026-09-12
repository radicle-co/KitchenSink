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
 *  5. ⛔ **The cadence is a repeating INTERVAL** (added 2026-09-03). Not a property of the wire, but the one
 *     the ruling is actually about, and the one that shipped wrong — see the interval suite below. This
 *     file can only prove the timer's half of it; the half that broke lives in the composition and is
 *     pinned in `useRecipeEditor.test.tsx`.
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

/** Advance the clock inside `act`, so React flushes the effects a fired timer schedules. */
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

describe('useRecipeAutoSave — the interval', () => {
    it('waits out the full window before the first write', () => {
        const saveDraft = vi.fn();

        render(<Harness isDirty saveDraft={saveDraft} />);

        settle(AUTO_SAVE_INTERVAL_MS - 1);
        expect(saveDraft).not.toHaveBeenCalled();

        settle(1);
        expect(saveDraft).toHaveBeenCalledTimes(1);
    });

    /**
     * ⛔ THE HEADLINE — the ruling this hook exists to implement (owner, 2026-08-26): a REPEATING
     * five-minute cadence for as long as the draft holds unsaved edits.
     *
     * ⚠️ REWRITTEN 2026-09-03, and the case it replaces is the reason the defect survived. That case
     * ("waits out the quiet window before writing") stops after the FIRST write, so it passes identically
     * against a one-shot `setTimeout` — which is what shipped. A one-shot is not merely a smaller interval:
     * once it has fired, nothing re-arms it while `isDirty`/`enabled` hold steady, so a write that FAILED
     * (the draft stays dirty, the editor stays `editing`) is never retried and auto-save is dead for the
     * rest of the session — silently, in exactly the flaky-network case it exists for.
     *
     * Asserts the COUNT and the CADENCE, at the boundary in both directions: nothing at window − 1, one
     * more write at each window thereafter.
     */
    it('keeps writing once per window for as long as the draft stays dirty', () => {
        const saveDraft = vi.fn();

        render(<Harness isDirty saveDraft={saveDraft} />);

        settle(AUTO_SAVE_INTERVAL_MS - 1);
        expect(saveDraft).toHaveBeenCalledTimes(0);

        settle(1);
        expect(saveDraft).toHaveBeenCalledTimes(1);

        settle(AUTO_SAVE_INTERVAL_MS - 1);
        expect(saveDraft).toHaveBeenCalledTimes(1);

        settle(1);
        expect(saveDraft).toHaveBeenCalledTimes(2);

        settle(AUTO_SAVE_INTERVAL_MS);
        expect(saveDraft).toHaveBeenCalledTimes(3);
    });

    /**
     * ⚠️ REWRITTEN 2026-09-03 to prove the NEW behaviour. The case it replaces ("writes ONCE for a burst of
     * edits, not once per keystroke") asserted a total of ONE write across three and a half elapsed windows,
     * which is a claim about a one-shot timer, not about per-keystroke suppression. The property actually
     * owed is stated here instead: the number of writes tracks ELAPSED WINDOWS, never the number of renders
     * inside them — a cook typing a title still issues no PATCH per character.
     */
    it('writes once per elapsed window however many times the editor re-renders inside it', () => {
        const saveDraft = vi.fn();
        const { rerender } = render(<Harness isDirty saveDraft={saveDraft} />);

        // Seven renders spread across three and a half windows.
        for (let i = 0; i < 7; i += 1) {
            settle(AUTO_SAVE_INTERVAL_MS / 2);
            rerender(<Harness isDirty saveDraft={saveDraft} />);
        }

        expect(saveDraft).toHaveBeenCalledTimes(3);
    });

    /**
     * ⛔ THE PROPERTY THAT MAKES FIVE MINUTES SAFE (owner ruling 2026-08-26).
     *
     * This is an INTERVAL from the first unsaved edit, not a debounce from the last one. A cook who keeps
     * typing is still written at the original deadline — under a debounce of the same length they would
     * never be written at all, which is exactly when unsaved work is most at risk.
     *
     * ⚠️ This hook's own tests can only prove the timer's half of that: `saveDraft` is a mock, so a
     * re-render here never changes its identity. The half that actually shipped broken — the editor handing
     * this hook a NEW `saveDraft` on every keystroke, which re-armed the effect and pushed the deadline out
     * — is only visible through the composition, and is pinned in `useRecipeEditor.test.tsx`.
     */
    it('fires on its original deadline even though the cook kept editing', () => {
        const saveDraft = vi.fn();
        const { rerender } = render(<Harness isDirty saveDraft={saveDraft} />);

        settle(AUTO_SAVE_INTERVAL_MS * 0.75);
        rerender(<Harness isDirty saveDraft={saveDraft} />);
        settle(AUTO_SAVE_INTERVAL_MS * 0.25);

        expect(saveDraft).toHaveBeenCalledTimes(1);
    });

    /**
     * ⛔ Unmount CANCELS; it deliberately does NOT flush. A last-gasp write on the way out would issue an
     * unattended PATCH on behalf of a screen the cook has left, into a `useRecipeEditor` that no longer
     * exists — so its 409 could not open the conflict view, and a lost update would have no error path at
     * all. Losing the final window's edits is the lesser harm, and it is the one the discard guard already
     * warns about at the exit the cook actually took.
     */
    it('cancels a pending write when the editor unmounts, and does not flush one on the way out', () => {
        const saveDraft = vi.fn();
        const { unmount } = render(<Harness isDirty saveDraft={saveDraft} />);

        settle(AUTO_SAVE_INTERVAL_MS * 0.9);
        unmount();

        expect(saveDraft).not.toHaveBeenCalled();

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

    /**
     * ⚠️ REWRITTEN 2026-09-03 to prove the NEW behaviour. The case it replaces advanced five windows past
     * the re-enable and asserted ONE write in total — a claim only a one-shot timer can satisfy, and one
     * that would now (correctly) fail. The property actually owed is that suppressed windows are DROPPED,
     * which is a statement about the moment of re-enabling: re-arming must not settle a backlog. That is
     * asserted directly below — nothing at the instant of re-enable, and then the ordinary cadence, with
     * the full window served before the first write.
     */
    it('does not queue up the writes it skipped while disabled — re-enabling starts a fresh window', () => {
        const saveDraft = vi.fn();
        const { rerender } = render(<Harness isDirty enabled={false} saveDraft={saveDraft} />);

        for (let i = 0; i < 5; i += 1) {
            settle(AUTO_SAVE_INTERVAL_MS);
            rerender(<Harness isDirty enabled={false} saveDraft={saveDraft} />);
        }

        rerender(<Harness isDirty enabled saveDraft={saveDraft} />);

        // The instant of re-enable: five suppressed windows have elapsed and NONE of them is owed.
        expect(saveDraft).not.toHaveBeenCalled();

        settle(AUTO_SAVE_INTERVAL_MS - 1);
        expect(saveDraft).not.toHaveBeenCalled();

        settle(1);
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
