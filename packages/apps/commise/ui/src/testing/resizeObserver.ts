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
    /** The options each watched node was observed with (`undefined` when it was observed with none). */
    readonly options: Map<Element, ResizeObserverOptions | undefined>;
    /** Every live observer with the nodes it watches, for a test that needs the one watching a given node. */
    readonly observers: Set<WatchingObserver>;
}

/** One live observer: its callback, itself, and the nodes it watches. */
export interface WatchingObserver {
    readonly callback: ResizeObserverCallback;
    readonly observer: ResizeObserver;
    readonly nodes: Set<Element>;
}

/** The record. */
export const resizeObserver: ResizeObserverRecord = {
    callback: undefined,
    observer: undefined,
    observed: new Set<Element>(),
    options: new Map<Element, ResizeObserverOptions | undefined>(),
    observers: new Set(),
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

/**
 * Fire, for each given node, the callback of every observer that watches it, as a layout pass would. Unlike
 * {@link reportResize}, which reaches only the observer constructed last, this reaches an observer another library
 * constructed after it. Wrap it in `act`.
 *
 * @sideEffect Calls the callbacks of the observers watching the nodes.
 * @param targets - The nodes that resized.
 */
export function reportResizeOf(targets: Iterable<Element>): void {
    const nodes = [...targets];

    resizeObserver.observers.forEach((watching) => {
        const hit = nodes.filter((node) => watching.nodes.has(node));

        if (hit.length > 0) {
            watching.callback(hit.map(resizeEntryOf), watching.observer);
        }
    });
}

/** Drops a node from the record once no live observer watches it: another observer may still hold it. */
function forgetUnwatched(node: Element): void {
    const held = [...resizeObserver.observers].some((watching) => watching.nodes.has(node));

    if (!held) {
        resizeObserver.observed.delete(node);
        resizeObserver.options.delete(node);
    }
}

globalThis.ResizeObserver = class {
    private readonly watching: WatchingObserver;

    public constructor(callback: ResizeObserverCallback) {
        resizeObserver.callback = callback;
        resizeObserver.observer = this;
        this.watching = { callback, observer: this, nodes: new Set<Element>() };
        resizeObserver.observers.add(this.watching);
    }

    public observe(target: Element, options?: ResizeObserverOptions): void {
        resizeObserver.observed.add(target);
        resizeObserver.options.set(target, options);
        this.watching.nodes.add(target);
    }

    public unobserve(target: Element): void {
        this.watching.nodes.delete(target);
        forgetUnwatched(target);
    }

    public disconnect(): void {
        const released = [...this.watching.nodes];

        this.watching.nodes.clear();
        resizeObserver.observers.delete(this.watching);
        released.forEach(forgetUnwatched);
    }
};
