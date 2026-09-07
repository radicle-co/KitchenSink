import { act, cleanup, render, screen } from '@testing-library/react';
import { Suspense, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useReturnFocusOnClose } from '../useReturnFocusOnClose.js';

/**
 * `useReturnFocusOnClose` — the shared open-edge focus snapshot every Radix surface with a SIBLING trigger
 * needs (six components carried a verbatim copy of it before this hook existed).
 *
 * Covers, one state at a time: never opened; the open edge (capture); staying open (no re-capture, which is
 * the whole point of the edge guard — a re-render while open would snapshot a control INSIDE the dialog);
 * closing (restore + `preventDefault`); a second open cycle (the latch re-arms, so the SECOND opener is
 * restored, not the first); mounting already open; and nothing focused at all (restore is a safe no-op).
 *
 * ⛔ The last case is the one that justifies this hook existing rather than the eight lines it replaces:
 * a render React DISCARDS must not consume the edge. The six copies latched in a `useRef`, which is a
 * mutation React never rolls back, so a discarded render advanced the latch and the replayed render — the
 * one that actually commits — captured nothing, silently pinning focus-return to whatever had focus during
 * the abandoned attempt. The latch is now `useState` adjusted during render (React's documented
 * previous-value form), whose update lives on the work-in-progress fiber and dies WITH the discarded render.
 * The scenario is driven through Suspense because that is the one way to discard a render deterministically:
 * the probe renders, a sibling suspends, React throws the whole pass away and replays it on resolve.
 */
afterEach(cleanup);

/** A Suspense gate the test opens by hand. `done` is what lets React's retry render get past the throw. */
interface Gate {
    readonly promise: Promise<void>;
    readonly open: () => void;
    done: boolean;
}

function makeGate(): Gate {
    let release = (): void => undefined;
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });
    const gate: Gate = { promise, open: release, done: false };

    // Registered before React attaches its own retry continuation, so `done` is already true by the time
    // React re-renders the boundary's children.
    void promise.then(() => {
        gate.done = true;
    });

    return gate;
}

/** Suspends the render pass it is part of until {@link Gate.open} is called. */
function Suspender({ gate }: { readonly gate: Gate | null }): null {
    if (gate !== null && !gate.done) {
        throw gate.promise;
    }

    return null;
}

/**
 * The hook under test, with its returned handler published to the enclosing test so a close can be driven
 * without standing up a whole Radix dialog — the handler IS the hook's contract.
 */
let restoreFocus: ((event: Event) => void) | undefined;

function Probe({ open }: { readonly open: boolean }): null {
    restoreFocus = useReturnFocusOnClose(open);

    return null;
}

/** Fire the handler the way Radix fires `onCloseAutoFocus`, and report whether it claimed the event. */
function close(): boolean {
    const event = new Event('closeAutoFocus', { cancelable: true });

    restoreFocus?.(event);

    return event.defaultPrevented;
}

/** Two openers plus the control the dialog itself would focus, so "which one won" is unambiguous. */
function Openers(): JSX.Element {
    return (
        <>
            <button type="button">first opener</button>
            <button type="button">second opener</button>
            <button type="button">inside the dialog</button>
        </>
    );
}

function opener(name: string): HTMLElement {
    return screen.getByRole('button', { name });
}

describe('useReturnFocusOnClose', () => {
    it('has nothing to restore while it has never been open', () => {
        render(
            <>
                <Openers />
                <Probe open={false} />
            </>,
        );

        opener('inside the dialog').focus();

        // Radix still fires `onCloseAutoFocus` on an unmount that never opened; with no snapshot the
        // handler must move focus NOWHERE rather than reset it to the document.
        expect(close()).toBe(true);
        expect(document.activeElement).toBe(opener('inside the dialog'));
    });

    it('captures the element focused at the false→true edge and restores it on close', () => {
        const { rerender } = render(
            <>
                <Openers />
                <Probe open={false} />
            </>,
        );

        opener('first opener').focus();
        rerender(
            <>
                <Openers />
                <Probe open />
            </>,
        );

        // The dialog takes focus, exactly as Radix's own autofocus-on-mount does.
        opener('inside the dialog').focus();

        expect(close()).toBe(true);
        expect(document.activeElement).toBe(opener('first opener'));
    });

    it('does not re-capture while it stays open', () => {
        const { rerender } = render(
            <>
                <Openers />
                <Probe open={false} />
            </>,
        );

        opener('first opener').focus();
        rerender(
            <>
                <Openers />
                <Probe open />
            </>,
        );
        opener('inside the dialog').focus();

        // A re-render while open — a busy/error state change in the real dialogs. Focus is now INSIDE the
        // dialog, so a component that re-snapshotted here would restore focus to its own content.
        rerender(
            <>
                <Openers />
                <Probe open />
            </>,
        );

        close();

        expect(document.activeElement).toBe(opener('first opener'));
    });

    it('re-arms on a second open cycle, restoring the SECOND opener', () => {
        const { rerender } = render(
            <>
                <Openers />
                <Probe open={false} />
            </>,
        );

        opener('first opener').focus();
        rerender(
            <>
                <Openers />
                <Probe open />
            </>,
        );
        close();

        rerender(
            <>
                <Openers />
                <Probe open={false} />
            </>,
        );
        opener('second opener').focus();
        rerender(
            <>
                <Openers />
                <Probe open />
            </>,
        );
        opener('inside the dialog').focus();

        close();

        expect(document.activeElement).toBe(opener('second opener'));
    });

    it('captures at mount when it is rendered already open', () => {
        render(<Openers />);
        opener('first opener').focus();

        render(<Probe open />);
        opener('inside the dialog').focus();

        close();

        expect(document.activeElement).toBe(opener('first opener'));
    });

    it('restores nothing, and does not throw, when no element had focus', () => {
        const { rerender } = render(
            <>
                <Openers />
                <Probe open={false} />
            </>,
        );

        rerender(
            <>
                <Openers />
                <Probe open />
            </>,
        );

        expect(close()).toBe(true);
        expect(document.activeElement).toBe(document.body);
    });

    it('captures on the render that COMMITS, not on one React discards', async () => {
        const { rerender } = render(
            <>
                <Openers />
                <Suspense fallback={<p>loading</p>}>
                    <Probe open={false} />
                    <Suspender gate={null} />
                </Suspense>
            </>,
        );

        opener('first opener').focus();

        // ONE update both opens the surface and suspends a sibling: React renders the probe (which sees the
        // false→true edge), then hits the throw and abandons the entire pass.
        const gate = makeGate();

        rerender(
            <>
                <Openers />
                <Suspense fallback={<p>loading</p>}>
                    <Probe open />
                    <Suspender gate={gate} />
                </Suspense>
            </>,
        );

        expect(screen.getByText('loading')).toBeTruthy();

        // Focus moves while the render is parked — a menu closing, a control unmounting, a click landing
        // elsewhere. The abandoned pass's snapshot is now stale.
        opener('second opener').focus();

        await act(async () => {
            gate.open();
            await gate.promise;
        });

        opener('inside the dialog').focus();

        close();

        expect(document.activeElement).toBe(opener('second opener'));
    });
});
