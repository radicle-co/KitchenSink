import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { REACT18_BRIDGE_SOURCE } from '../react18Bridge.js';

interface Element {
    readonly type: unknown;
    readonly props: Record<string, unknown>;
    readonly extraChildren: readonly unknown[];
    /** Where React 18 moves `ref`: off the props, onto the element. */
    readonly ref: unknown;
}

const FORWARD_REF = Symbol.for('react.forward_ref');

interface ForwardRefType {
    readonly $$typeof: symbol;
    readonly render: (props: Record<string, unknown>, ref: unknown) => unknown;
}

const CONTEXT = Symbol.for('react.context');

/** A just-enough React: records elements and simulates hook slots for one component across renders. */
function fakeReact(options: { readonly withUseEffectEvent?: (() => string) | undefined } = {}) {
    const slots: unknown[] = [];
    let cursor = 0;
    const R = {
        Fragment: Symbol('fragment'),
        /** Strips `ref` from the props the way React 18 does. */
        createElement(type: unknown, props: Record<string, unknown>, ...extraChildren: unknown[]): Element {
            const { ref, ...rest } = props;

            return { type, props: rest, extraChildren, ref };
        },
        forwardRef(render: ForwardRefType['render']): ForwardRefType {
            return { $$typeof: FORWARD_REF, render };
        },
        useRef<T>(initial: T): { current: T } {
            const slot = (slots[cursor] ??= { current: initial }) as { current: T };
            cursor += 1;

            return slot;
        },
        useInsertionEffect(effect: () => void): void {
            effect();
        },
        useCallback<T>(callback: T): T {
            const slot = (slots[cursor] ??= callback) as T;
            cursor += 1;

            return slot;
        },
        marker: 'kept',
        ...(options.withUseEffectEvent === undefined ? {} : { useEffectEvent: options.withUseEffectEvent }),
    };

    return {
        R,
        render<T>(component: () => T): T {
            cursor = 0;

            return component();
        },
    };
}

interface Bridged {
    readonly __react: Record<string, unknown> & {
        useEffectEvent: (callback: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown;
    };
    readonly __jsx: {
        jsx: (type: unknown, props: Record<string, unknown> | null, key?: string) => Element;
        jsxs: unknown;
        jsxDEV: unknown;
        Fragment: unknown;
    };
}

function install(R: unknown): Bridged {
    const window: Record<string, unknown> = { React: R };
    runInNewContext(REACT18_BRIDGE_SOURCE, { window });

    return window as unknown as Bridged;
}

describe('react18Bridge jsx runtime', () => {
    it('exposes jsx, jsxs, jsxDEV as one function and the Fragment of the host React', () => {
        const { R } = fakeReact();
        const { __jsx } = install(R);

        expect(__jsx.jsxs).toBe(__jsx.jsx);
        expect(__jsx.jsxDEV).toBe(__jsx.jsx);
        expect(__jsx.Fragment).toBe(R.Fragment);
    });

    it('maps <Context value> to the context Provider', () => {
        const { R } = fakeReact();
        const { __jsx } = install(R);
        const Provider = { $$typeof: Symbol.for('react.provider') };
        const context = { $$typeof: CONTEXT, Provider };

        const element = __jsx.jsx(context, { value: 3, children: 'x' });

        expect(element.type).toBe(Provider);
        expect(element.props).toEqual({ value: 3, children: 'x' });
    });

    it('leaves non-context types alone, including strings and components', () => {
        const { R } = fakeReact();
        const { __jsx } = install(R);
        const Component = (): null => null;

        expect(__jsx.jsx('div', {}).type).toBe('div');
        expect(__jsx.jsx(Component, {}).type).toBe(Component);
    });

    it('passes the key as the element key, and never lets props.key leak when none is given', () => {
        const { R } = fakeReact();
        const { __jsx } = install(R);

        expect(__jsx.jsx('li', { id: 'a' }, 'k1').props).toEqual({ id: 'a', key: 'k1' });
        expect(__jsx.jsx('li', { id: 'a' }).props).toEqual({ id: 'a' });
    });

    it('keeps a single child as the children prop, unwrapped', () => {
        const { R } = fakeReact();
        const { __jsx } = install(R);

        expect(__jsx.jsx('p', { children: 'one' }).props['children']).toBe('one');
    });

    it('keeps an array of children as an array in the children prop, even with one item', () => {
        const { R } = fakeReact();
        const { __jsx } = install(R);

        expect(__jsx.jsx('ul', { children: ['a', 'b'] }).props['children']).toEqual(['a', 'b']);
        expect(__jsx.jsx('ul', { children: ['a'] }).props['children']).toEqual(['a']);
    });

    it('passes no varargs children to createElement, so the child array is never flattened', () => {
        const { R } = fakeReact();
        const { __jsx } = install(R);

        expect(__jsx.jsx('ul', { children: ['a', 'b'] }).extraChildren).toEqual([]);
    });

    it('accepts null props', () => {
        const { R } = fakeReact();
        const { __jsx } = install(R);

        expect(__jsx.jsx('br', null).props).toEqual({});
    });

    it('does not mutate the props object it was given', () => {
        const { R } = fakeReact();
        const { __jsx } = install(R);
        const props = { id: 'a' };

        __jsx.jsx('li', props, 'k');

        expect(props).toEqual({ id: 'a' });
    });
});

describe('react18Bridge ref as a prop', () => {
    it('delivers ref to a plain function component as props.ref', () => {
        const { R } = fakeReact();
        const { __jsx } = install(R);
        const seen: unknown[] = [];

        const Field = (props: Record<string, unknown>): null => {
            seen.push(props['ref']);

            return null;
        };

        const ref = { current: null };
        const element = __jsx.jsx(Field, { ref, label: 'x' });

        (element.type as ForwardRefType).render(element.props, element.ref);

        expect(seen).toEqual([ref]);
    });

    it('passes the other props through untouched', () => {
        const { R } = fakeReact();
        const { __jsx } = install(R);
        const seen: Record<string, unknown>[] = [];

        const Field = (props: Record<string, unknown>): null => {
            seen.push(props);

            return null;
        };

        const ref = { current: null };
        const element = __jsx.jsx(Field, { ref, label: 'x', children: 'c' });

        (element.type as ForwardRefType).render(element.props, element.ref);

        expect(seen).toEqual([{ label: 'x', children: 'c', ref }]);
    });

    it('wraps each component type once, so a re-render keeps the same element type', () => {
        const { R } = fakeReact();
        const { __jsx } = install(R);
        const Field = (): null => null;

        const first = __jsx.jsx(Field, { ref: {} }).type;

        expect(first).not.toBe(Field);
        expect(__jsx.jsx(Field, { ref: { current: 1 } }).type).toBe(first);
    });

    it.each([
        ['no ref', { label: 'x' }],
        ['a null ref', { ref: null }],
    ])('leaves a component alone when it is given %s', (_name, props) => {
        const { R } = fakeReact();
        const { __jsx } = install(R);
        const Field = (): null => null;

        expect(__jsx.jsx(Field, props).type).toBe(Field);
    });

    it('leaves host elements, classes, forwardRef, memo and lazy types alone', () => {
        const { R } = fakeReact();
        const { __jsx } = install(R);
        class Klass {}
        Object.assign(Klass.prototype, { isReactComponent: {} });
        const forwarded = { $$typeof: FORWARD_REF, render: () => null };
        const memo = { $$typeof: Symbol.for('react.memo'), type: () => null };
        const lazy = { $$typeof: Symbol.for('react.lazy') };
        const ref = {};

        for (const type of ['div', Klass, forwarded, memo, lazy]) {
            expect(__jsx.jsx(type, { ref }).type).toBe(type);
        }
    });
});

describe('react18Bridge window.__react', () => {
    it('carries every export of the host React alongside the polyfill', () => {
        const { R } = fakeReact();

        expect(install(R).__react['marker']).toBe('kept');
    });

    it('uses the host useEffectEvent when it has one', () => {
        const native = (): string => 'native';
        const { R } = fakeReact({ withUseEffectEvent: native });

        expect(install(R).__react.useEffectEvent).toBe(native);
    });

    it('polyfills useEffectEvent so the returned function is stable and calls the LATEST callback', () => {
        const { R, render } = fakeReact();
        const { useEffectEvent: polyfill } = install(R).__react;
        const calls: string[] = [];

        const first = render(() => polyfill((arg) => calls.push(`first:${String(arg)}`)));
        const second = render(() => polyfill((arg) => calls.push(`second:${String(arg)}`)));
        second('x');

        expect(second).toBe(first);
        expect(calls).toEqual(['second:x']);
    });

    it('forwards all arguments and the return value of the latest callback', () => {
        const { R, render } = fakeReact();
        const { useEffectEvent: polyfill } = install(R).__react;

        const event = render(() => polyfill((a, b) => `${String(a)}+${String(b)}`));

        expect(event(1, 2)).toBe('1+2');
    });
});
