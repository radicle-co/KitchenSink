/**
 * @module runtime/installReact18Bridge — lets Commise sources, compiled for React 19, run on the React 18 the host
 * page provides.
 *
 * Three things differ between the versions and the bridge covers all of them:
 *   1. React 19 sources write `<Context value={…}>`; React 18 only renders `<Context.Provider>`. The JSX
 *      runtime below swaps a context object for its `.Provider`.
 *   2. React 19 ships `useEffectEvent`; 18 does not. The polyfill keeps a ref to the latest callback and hands
 *      back one stable function, which is the contract of the real hook.
 *   3. React 19 passes `ref` to a function component as an ordinary prop; React 18's `createElement` strips it
 *      from the props of every element. The native leaves (`TextInput.native`, `HeroButton.native`, `PressScale`)
 *      read `props.ref`, so for a plain function component given a ref the bridge wraps the type, once per type,
 *      in a `forwardRef` that hands the ref back as `props.ref`. Classes, `forwardRef`, `memo` and `lazy` types
 *      are objects or classes with their own ref contract and are left alone.
 *
 * The bundle never imports `react`; `runtimeGlobalsPlugin` rewrites those imports to `window.__react` and
 * `window.__jsx`, which this defines from the host's `window.React`.
 *
 * Browser code: `react18Bridge.ts` compiles `react18BridgeEntry.ts` (which calls this) to the script the bundle
 * prepends.
 *
 * @pattern Adapter — makes the React 19 surface the sources were written against available on React 18.
 */
import type { BridgedReact, EffectEventHook, ForwardRefType, JsxRuntime, ReactLike } from '../browser/reactLike.js';

/** The window members the bridge reads and defines. */
export interface BridgeHost {
    readonly React: ReactLike;
    __react?: BridgedReact;
    __jsx?: JsxRuntime;
}

type FunctionComponent = ((props: Record<string, unknown>) => unknown) & { displayName?: string };

const CONTEXT = Symbol.for('react.context');

function isContext(type: unknown): type is { readonly Provider: unknown } {
    return typeof type === 'object' && type !== null && Reflect.get(type, '$$typeof') === CONTEXT && 'Provider' in type;
}

/** A function that is not a class component (classes carry `prototype.isReactComponent`). */
function isPlainFunctionComponent(type: unknown): type is FunctionComponent {
    if (typeof type !== 'function') {
        return false;
    }

    const prototype: unknown = type.prototype;

    return !(typeof prototype === 'object' && prototype !== null && 'isReactComponent' in prototype);
}

/**
 * Defines `host.__react` and `host.__jsx` from `host.React`.
 *
 * `children` is passed through `props` as given instead of being spread into `createElement`'s varargs: React 19's
 * `jsx` does exactly that, and spreading would turn a one-item array into a bare child.
 *
 * @sideEffect Assigns `host.__react` and `host.__jsx`.
 * @param host - The page's window.
 */
export function installReact18Bridge(host: BridgeHost): void {
    const R = host.React;
    const withRef = new WeakMap<FunctionComponent, ForwardRefType>();

    function acceptingRef(type: FunctionComponent): ForwardRefType {
        let wrapped = withRef.get(type);

        if (wrapped === undefined) {
            wrapped = R.forwardRef((props, ref) => type(Object.assign({}, props, { ref })));
            wrapped.displayName = type.displayName || type.name || 'Component';
            withRef.set(type, wrapped);
        }

        return wrapped;
    }

    function jsx(type: unknown, props: Record<string, unknown> | null, key?: string): unknown {
        let element = isContext(type) ? type.Provider : type;
        const copy = Object.assign({}, props);

        if (copy['ref'] != null && isPlainFunctionComponent(element)) {
            element = acceptingRef(element);
        }

        if (key !== undefined) {
            copy['key'] = key;
        }

        return R.createElement(element, copy);
    }

    const useEffectEvent: EffectEventHook = (callback) => {
        const latest = R.useRef(callback);

        R.useInsertionEffect(() => {
            latest.current = callback;
        });

        return R.useCallback((...args) => latest.current(...args), []);
    };

    host.__react = Object.assign({}, R, { useEffectEvent: R.useEffectEvent ?? useEffectEvent });
    host.__jsx = { jsx, jsxs: jsx, jsxDEV: jsx, Fragment: R.Fragment };
}
