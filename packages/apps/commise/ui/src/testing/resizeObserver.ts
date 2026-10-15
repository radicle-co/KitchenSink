/**
 * @module @commise/ui/testing/resize-observer: the one recording `ResizeObserver` for native tests, and the record it
 * keeps.
 *
 * react-native-web reports `onLayout` through one `ResizeObserver` and reads each node's `offsetHeight` / `offsetWidth`
 * / `offsetTop`; jsdom has none of them. A test that needs a layout therefore needs two things: to see which nodes are
 * watched, and to report a size for them through the observer's callback. Six test files each carried their own copy of
 * this stub; they now import this module instead.
 *
 * ⚠️ IMPORT IT FIRST, as a bare side-effect import, so the observer exists before any react-native-web module is
 * evaluated:
 *
 * ```ts
 * import { resizeObserver } from '@commise/ui/testing/resize-observer';
 * ```
 *
 * The record is shared module state: clear `observed` in `afterEach`, because a node of one test is not a node of the
 * next. `callback` is the LAST observer's, which is the one react-native-web creates (it creates exactly one).
 *
 * @pattern Test Double (Spy) — a `ResizeObserver` that records what it was asked to watch
 */

/** What the recording observer has been asked, readable and clearable by a test. */
export interface ResizeObserverRecord {
    /** The callback of the observer most recently constructed — the one react-native-web reports layout through. */
    callback: ResizeObserverCallback | undefined;
    /** The nodes currently watched. */
    readonly observed: Set<Element>;
}

/** The record. */
export const resizeObserver: ResizeObserverRecord = { callback: undefined, observed: new Set<Element>() };

globalThis.ResizeObserver = class {
    public constructor(callback: ResizeObserverCallback) {
        resizeObserver.callback = callback;
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
} as unknown as typeof ResizeObserver;
