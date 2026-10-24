/**
 * @module browser/reactLike — the part of React the React 18 bridge uses, as a structural type. The bundle never
 * imports `react`; the host page provides it as `window.React`, so this names what the bridge needs of it and a test
 * can hand in a fake without a cast.
 */

/** A hook-style handle. */
export interface MutableRef<T> {
    current: T;
}

/** A callback that never changes identity but calls the latest function it was given. */
export type EffectEventHook = <Args extends readonly unknown[], Result>(
    callback: (...args: Args) => Result,
) => (...args: Args) => Result;

/** What `forwardRef` returns, as far as the bridge cares. */
export interface ForwardRefType {
    displayName?: string;
}

/** The slice of React the bridge reads. */
export interface ReactLike {
    readonly Fragment: unknown;
    createElement(type: unknown, props: Record<string, unknown>): unknown;
    forwardRef(render: (props: Record<string, unknown>, ref: unknown) => unknown): ForwardRefType;
    useRef<T>(initial: T): MutableRef<T>;
    useInsertionEffect(effect: () => void): void;
    useCallback<Args extends readonly unknown[], Result>(
        callback: (...args: Args) => Result,
        deps: readonly unknown[],
    ): (...args: Args) => Result;
    readonly useEffectEvent?: EffectEventHook;
}

/** `window.__react`: the host React with `useEffectEvent` guaranteed. */
export type BridgedReact = ReactLike & { readonly useEffectEvent: EffectEventHook };

/** `window.__jsx`: the automatic JSX runtime the bundle's `jsx-runtime` imports resolve to. */
export interface JsxRuntime {
    readonly jsx: (type: unknown, props: Record<string, unknown> | null, key?: string) => unknown;
    readonly jsxs: JsxRuntime['jsx'];
    readonly jsxDEV: JsxRuntime['jsx'];
    readonly Fragment: unknown;
}
