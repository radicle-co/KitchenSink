/**
 * @module runtime/designSystemScope — puts every native component the artifact exposes inside the design system's
 * Tamagui provider (ADR-0080).
 *
 * The native leaves read their theme, fonts and portal host from `DesignSystemProvider`, which the app mounts once at
 * its root. The artifact has no such root: a card column and every `x-import` on a board mount the components
 * themselves. So each component on `Commise.Native` is replaced by a wrapper that mounts the provider when it is the
 * outermost scoped component in its tree, and renders the component bare when an ancestor already did. A card column
 * mounts {@link DESIGN_SYSTEM_SCOPE} around everything it renders, so sibling components share one provider (and one
 * portal root). A board's `x-import` is its own React root, so each one gets its own provider; that is accepted.
 * `DesignSystemProvider` and `DesignSystemTheme` are not given a second provider: they only mark their tree as scoped,
 * so a theme placed by hand is not overridden by the device scheme below it.
 *
 * Browser code with no imports of its own: React and the JSX runtime are handed in, so the page's bridged React runs
 * it and a test can run it on real React.
 *
 * @pattern Decorator — each component gains the provider without its contract changing; a context marks the tree as
 *     already scoped, so one tree gets one provider, and the root scope is the marker a card column mounts.
 */

/** The provider every other native component needs above it. */
const PROVIDER = 'DesignSystemProvider';

/** Native exports that ARE a provider: they mark their tree as scoped instead of gaining a second provider. */
const PROVIDER_NAMES: ReadonlySet<string> = new Set([PROVIDER, 'DesignSystemTheme']);

/** The key of the root scope: one provider for everything under it. A card column mounts it. */
export const DESIGN_SYSTEM_SCOPE = 'DesignSystemScope';

/** The slice of React the scope calls. `C` is the context type the host React makes. */
export interface ScopeReact<C> {
    createContext(defaultValue: boolean): C;
    useContext(context: C): unknown;
}

/** The automatic JSX runtime, which on the page is the React 18 bridge's (it handles `ref` and `<Context>`). */
export interface ScopeJsx {
    jsx(type: unknown, props: Record<string, unknown>): unknown;
}

/**
 * The native exports with every named component scoped to the design-system provider.
 *
 * @param native - The native bundle's exports.
 * @param components - Which exports are components. Hooks and values are not listed and are returned unchanged.
 * @param react - React's `createContext` and `useContext`.
 * @param runtime - The JSX runtime the wrappers render through.
 * @returns A new object with the same keys plus {@link DESIGN_SYSTEM_SCOPE}, which takes the provider's props; each
 *     listed component is a wrapper.
 * @throws Error when `native` has no `DesignSystemProvider`: every component would then render without a theme.
 */
export function scopeDesignSystem<T extends Readonly<Record<string, unknown>>, C>(
    native: T,
    components: readonly string[],
    react: ScopeReact<C>,
    runtime: ScopeJsx,
): T & Readonly<Record<typeof DESIGN_SYSTEM_SCOPE, T[typeof PROVIDER]>> {
    const provider = native[PROVIDER];

    if (provider === undefined) {
        throw new Error(`The native bundle exports no ${PROVIDER}, so its components cannot be themed.`);
    }

    const inScope = react.createContext(false);
    const named = (name: string, render: (props: Record<string, unknown>) => unknown): unknown =>
        Object.assign(render, { displayName: name });
    const marked = (children: unknown): unknown => runtime.jsx(inScope, { value: true, children });
    const scope = (name: string, component: unknown): unknown =>
        named(name, (props) =>
            react.useContext(inScope) === true
                ? runtime.jsx(component, props)
                : marked(runtime.jsx(provider, { children: runtime.jsx(component, props) })),
        );
    const markOnly = (name: string, component: unknown): unknown =>
        named(name, (props) => marked(runtime.jsx(component, props)));
    const root = named(DESIGN_SYSTEM_SCOPE, (props) =>
        react.useContext(inScope) === true ? props['children'] : marked(runtime.jsx(provider, props)),
    );
    const listed = new Set(components);
    const wrapped = Object.entries(native).map(([name, value]): [string, unknown] => {
        if (!listed.has(name)) {
            return [name, value];
        }

        return [name, PROVIDER_NAMES.has(name) ? markOnly(name, value) : scope(name, value)];
    });

    // `Object.fromEntries` types its result as a plain record. Its keys are `native`'s own plus the root, and no native
    // export carries static members, so each wrapper stands in for its component.
    return Object.fromEntries([...wrapped, [DESIGN_SYSTEM_SCOPE, root]]) as T &
        Readonly<Record<typeof DESIGN_SYSTEM_SCOPE, T[typeof PROVIDER]>>;
}
