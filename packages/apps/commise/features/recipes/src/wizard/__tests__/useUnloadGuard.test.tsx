// @vitest-environment jsdom
/**
 * Component tests for the WEB half of "warn before losing unsaved work".
 *
 * The native half is a back interceptor that raises the app's own `ConfirmDialog`; the web half is the
 * browser's own `beforeunload` prompt, which is the platform-standard pattern for a tab close, a reload, or a
 * navigation out of the app. Both are keyed on the SAME `isDirty` the in-app discard dialog uses, so the two
 * cannot disagree about whether there is anything to lose.
 *
 * ⚠️ WHAT CANNOT BE ASSERTED HERE, OR ANYWHERE. Browsers have ignored a page-supplied message since 2016 and
 * show their own copy, so there is no string to test. `defaultPrevented` is the whole observable contract:
 * it is what makes the browser prompt at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { FC } from 'react';

import { useUnloadGuard } from '../useUnloadGuard.js';

afterEach(cleanup);

const Guarded: FC<{ readonly isDirty: boolean }> = ({ isDirty }) => {
    useUnloadGuard(isDirty);

    return null;
};

/** Raise a real `beforeunload` and report whether something asked the browser to prompt. */
function fireBeforeUnload(): boolean {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    return event.defaultPrevented;
}

describe('useUnloadGuard', () => {
    it('does NOT prompt while the draft is clean — an unconditional guard is a nuisance, not a guard', () => {
        render(<Guarded isDirty={false} />);

        expect(fireBeforeUnload()).toBe(false);
    });

    it('⛔ prompts while the draft is dirty', () => {
        render(<Guarded isDirty />);

        expect(fireBeforeUnload()).toBe(true);
    });

    it('sets the legacy returnValue too, which is what Chrome still reads', () => {
        // ⚠️ Read back through an own property, not the DOM one. Per spec `returnValue`'s GETTER answers
        // `!canceled`, so once `preventDefault` has run the native property reads `false` whatever was
        // assigned to it — asserting on it directly would fail against a correct handler. This observes the
        // assignment itself, which is the only way the legacy field is visible at all.
        render(<Guarded isDirty />);
        const event = new Event('beforeunload', { cancelable: true });
        let assigned: unknown;
        Object.defineProperty(event, 'returnValue', {
            configurable: true,
            get: () => assigned,
            set: (value: unknown) => {
                assigned = value;
            },
        });

        window.dispatchEvent(event);

        expect(assigned).toBe('');
    });

    it('⛔ DISARMS once the draft goes clean, so a completed save does not prompt on the way out', () => {
        // This is the transition that matters in the app: Publish/Save Draft re-captures the discard guard's
        // baseline and navigates. A guard that stayed armed would prompt the cook after a SUCCESSFUL save.
        const { rerender } = render(<Guarded isDirty />);
        expect(fireBeforeUnload()).toBe(true);

        rerender(<Guarded isDirty={false} />);

        expect(fireBeforeUnload()).toBe(false);
    });

    it('arms when a clean draft is edited', () => {
        const { rerender } = render(<Guarded isDirty={false} />);

        rerender(<Guarded isDirty />);

        expect(fireBeforeUnload()).toBe(true);
    });

    it('removes its listener on unmount', () => {
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = render(<Guarded isDirty />);

        unmount();

        expect(remove).toHaveBeenCalledWith('beforeunload', expect.any(Function));
        // Asserted through the spy AND behaviourally: a leaked listener keeps prompting for a surface the
        // cook has already left.
        expect(fireBeforeUnload()).toBe(false);
        remove.mockRestore();
    });
});
