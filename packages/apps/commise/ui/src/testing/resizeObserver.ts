/**
 * @module @commise/ui/testing/resize-observer: the one recording `ResizeObserver` for native tests, and the record it
 * keeps.
 *
 * react-native-web reports `onLayout` through one `ResizeObserver` and reads each node's `offsetHeight` / `offsetWidth`
 * / `offsetTop`; jsdom has none of them. A test that needs a layout therefore needs two things: to see which nodes are
 * watched, and to report a size for them through the observer's callback. This module is the one stub, so a test does
 * not carry a copy of its own.
 *
 * ⚠️ IMPORT IT FIRST, so the observer exists before any react-native-web module is evaluated. Importing the module
 * installs the observer. A test that reads the record imports the name, which keeps the record in reach:
 *
 * ```ts
 * import { resizeObserver } from '@commise/ui/testing/resize-observer';
 * ```
 *
 * A file that never reads the record (a setup file) writes the bare form,
 * `import '@commise/ui/testing/resize-observer';`, as `mobile/tests/setup.native.ts` does.
 * The bare form is required there: with `isolatedModules` and no `verbatimModuleSyntax`, a named import that is never
 * used is dropped, and the module would then never be evaluated.
 *
 * The record is shared module state: clear `observed` in `afterEach`, because a node of one test is not a node of the
 * next. `callback` is the LAST observer constructed, which is not always react-native-web's: any other
 * library that constructs a `ResizeObserver` (React Navigation does) replaces it.
 *
 * @pattern Test Double (Spy) — a `ResizeObserver` that records what it was asked to watch
 */

/** What the recording observer has been asked, readable and clearable by a test. */
export interface ResizeObserverRecord {
    /** The callback of the observer most recently constructed. */
    callback: ResizeObserverCallback | undefined;
    /** The observer most recently constructed, which `reportResize` hands back to the callback. */
    observer: ResizeObserver | undefined;
    /** The nodes currently watched. */
    readonly observed: Set<Element>;
}

/** The record. */
export const resizeObserver: ResizeObserverRecord = {
    callback: undefined,
    observer: undefined,
    observed: new Set<Element>(),
};

/**
 * A resize entry for a node: its target and its measured box, with the box-size lists empty (jsdom has no layout).
 *
 * @param target - The node that resized.
 * @returns The entry the callback receives.
 */
export function resizeEntryOf(target: Element): ResizeObserverEntry {
    return {
        target,
        contentRect: target.getBoundingClientRect(),
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
    };
}

/**
 * Fire the most recent observer's callback with a real entry for each node, as a layout pass would. It does nothing
 * until an observer exists. Wrap it in `act`.
 *
 * @sideEffect Calls the observer's callback.
 * @param targets - The nodes to report; every watched node when omitted.
 */
export function reportResize(targets: Iterable<Element> = resizeObserver.observed): void {
    const { callback, observer } = resizeObserver;

    if (callback === undefined || observer === undefined) {
        return;
    }

    callback([...targets].map(resizeEntryOf), observer);
}

globalThis.ResizeObserver = class {
    public constructor(callback: ResizeObserverCallback) {
        resizeObserver.callback = callback;
        resizeObserver.observer = this;
    }

    public observe(target: Element): void {
        resizeObserver.observed.add(target);
    }

    public unobserve(target: Element): void {
        resizeObserver.observed.delete(target);
    }

    public disconnect(): void {
        resizeObserver.observed.clear();
    }
};
