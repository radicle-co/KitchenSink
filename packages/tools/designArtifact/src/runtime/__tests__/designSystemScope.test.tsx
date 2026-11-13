// @vitest-environment jsdom
/**
 * The scope runs on the page through the React 18 bridge's JSX runtime, which turns `<Context>` into
 * `<Context.Provider>` and hands refs to plain function components. So the wrappers here render through the real
 * bridge, installed over the React this test runs, and not through React's own `jsx`.
 */
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { createContext, createRef, useContext } from 'react';
import type { Context, ReactElement, ReactNode, Ref } from 'react';
import { describe, expect, it } from 'vitest';

import type { BridgeHost } from '../installReact18Bridge.js';
import { installReact18Bridge } from '../installReact18Bridge.js';
import { DESIGN_SYSTEM_SCOPE, scopeDesignSystem } from '../designSystemScope.js';

/** Stands in for the Tamagui provider: counts how deep its own instances nest. */
const Depth = createContext(0);

function DesignSystemProvider({ children }: { readonly children: ReactNode }): ReactElement {
    const depth = useContext(Depth) + 1;

    return (
        <Depth value={depth}>
            <div data-testid={`provider-${String(depth)}`}>{children}</div>
        </Depth>
    );
}

/** Stands in for the themed provider a board could place by hand. */
function DesignSystemTheme({ children }: { readonly children: ReactNode }): ReactElement {
    return <DesignSystemProvider>{children}</DesignSystemProvider>;
}

/** Reads the provider it renders inside, as a Tamagui component reads its theme. */
function Badge({ label }: { readonly label: string }): ReactElement {
    return <span>{`${label} at depth ${String(useContext(Depth))}`}</span>;
}

function Card({ children }: { readonly children: ReactNode }): ReactElement {
    return <section>{children}</section>;
}

function Field({ ref }: { readonly ref?: Ref<HTMLInputElement> }): ReactElement {
    return <input aria-label="field" ref={ref} />;
}

const useThing = (): string => 'hook';

const native = { DesignSystemProvider, DesignSystemTheme, Badge, Card, Field, useThing, TOKENS: { gap: 4 } };
const names = ['DesignSystemProvider', 'DesignSystemTheme', 'Badge', 'Card', 'Field'];
const react = {
    createContext: (defaultValue: boolean): Context<boolean> => createContext(defaultValue),
    useContext: (context: Context<boolean>): boolean => useContext(context),
};

/** The bridge's JSX runtime, installed over this test's React exactly as the page installs it over its own. */
function bridgedRuntime(): NonNullable<BridgeHost['__jsx']> {
    const host: BridgeHost = {
        React: {
            ...React,
            // React types a forwardRef render as returning a ReactNode; the bridge's slice says `unknown`. The render
            // the bridge passes returns whatever the wrapped component returns, which is a ReactNode here.
            forwardRef: (renderWithRef) => React.forwardRef((props, ref) => renderWithRef(props, ref) as ReactNode),
        },
    };

    installReact18Bridge(host);

    if (host.__jsx === undefined) {
        throw new Error('The bridge installed no JSX runtime.');
    }

    return host.__jsx;
}

describe('scopeDesignSystem', () => {
    const scoped = scopeDesignSystem(native, names, react, bridgedRuntime());
    const Scoped = {
        Badge: scoped.Badge,
        Card: scoped.Card,
        Field: scoped.Field,
        Theme: scoped.DesignSystemTheme,
        Root: scoped[DESIGN_SYSTEM_SCOPE],
    };

    it('renders a component inside the design-system provider', () => {
        render(<Scoped.Badge label="alone" />);

        expect(screen.getByText('alone at depth 1')).toBeTruthy();
    });

    it('mounts one provider for a tree of scoped components, not one per component', () => {
        render(
            <Scoped.Card>
                <Scoped.Badge label="nested" />
            </Scoped.Card>,
        );

        expect(screen.getByText('nested at depth 1')).toBeTruthy();
        expect(screen.queryByTestId('provider-2')).toBeNull();
    });

    it('gives siblings under the root scope one shared provider', () => {
        render(
            <Scoped.Root>
                <Scoped.Badge label="first" />
                <Scoped.Badge label="second" />
            </Scoped.Root>,
        );

        expect(screen.getAllByTestId('provider-1')).toHaveLength(1);
        expect(screen.getByText('second at depth 1')).toBeTruthy();
    });

    it('lets a hand-placed DesignSystemTheme stand as the scope, so no second provider overrides it', () => {
        render(
            <Scoped.Theme>
                <Scoped.Badge label="themed" />
            </Scoped.Theme>,
        );

        expect(screen.getByText('themed at depth 1')).toBeTruthy();
    });

    it('hands a ref through to the component', () => {
        const ref = createRef<HTMLInputElement>();

        render(<Scoped.Field ref={ref} />);

        expect(ref.current).toBe(screen.getByLabelText('field'));
    });

    it('leaves hooks and values as they are, and adds only the root scope', () => {
        expect(scoped.useThing).toBe(useThing);
        expect(scoped.TOKENS).toBe(native.TOKENS);
        expect(Object.keys(scoped).sort()).toEqual([...Object.keys(native), DESIGN_SYSTEM_SCOPE].sort());
    });

    it('names each wrapper after its component, so a React error names the real component', () => {
        expect(Reflect.get(scoped.Badge, 'displayName')).toBe('Badge');
        expect(Reflect.get(scoped.DesignSystemTheme, 'displayName')).toBe('DesignSystemTheme');
    });

    it('fails loudly when the native bundle has no provider to scope with', () => {
        expect(() => scopeDesignSystem({ Badge }, ['Badge'], react, bridgedRuntime())).toThrow(/DesignSystemProvider/u);
    });
});
