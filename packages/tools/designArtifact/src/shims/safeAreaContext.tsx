/**
 * @module safeAreaContext — `react-native-safe-area-context` for the design system: an iPhone's insets with no
 * provider required. The canvas draws no fake status bar, so the inset is left as space, as on a device.
 *
 * @pattern Adapter over react-native-safe-area-context (typed against its props)
 */
import type {
    Edge,
    EdgeInsets,
    EdgeMode,
    Metrics,
    Rect,
    SafeAreaProviderProps,
    SafeAreaViewProps,
} from 'react-native-safe-area-context';
import { createContext, useContext, type FC } from 'react';
import { StyleSheet, View } from 'react-native-web';

import { insetsOverride } from './artifactGlobals.js';

const IPHONE_INSETS: EdgeInsets = { top: 47, right: 0, bottom: 34, left: 0 };
const IPHONE_FRAME: Rect = { x: 0, y: 0, width: 390, height: 844 };

/** The insets of the window a screen is drawn in. */
export const initialWindowMetrics: Metrics = { insets: IPHONE_INSETS, frame: IPHONE_FRAME };

/** The insets a provider holds. Empty means no provider. */
export const SafeAreaInsetsContext = createContext<EdgeInsets | null>(null);

/** The insets this component sits inside: a provider's, else the page's override, else an iPhone's. */
export function useSafeAreaInsets(): EdgeInsets {
    return useContext(SafeAreaInsetsContext) ?? insetsOverride() ?? IPHONE_INSETS;
}

/** The window as the frame. */
export function useSafeAreaFrame(): Rect {
    return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}

/** Holds the insets for the screen below it. */
export const SafeAreaProvider: FC<SafeAreaProviderProps> = ({ children, initialMetrics, style, ...rest }) => (
    <SafeAreaInsetsContext.Provider value={initialMetrics?.insets ?? insetsOverride() ?? IPHONE_INSETS}>
        <View {...rest} style={[{ flex: 1 }, style]}>
            {children}
        </View>
    </SafeAreaInsetsContext.Provider>
);

const EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

/**
 * How one edge combines the inset with the view's own padding. `off` keeps the view's padding, `additive` adds the inset
 * to it, `maximum` takes the larger. Pure.
 */
export function edgePadding(inset: number, mode: EdgeMode, own: number): number {
    if (mode === 'additive') {
        return own + inset;
    }

    return mode === 'maximum' ? Math.max(own, inset) : own;
}

/** The mode of each edge: a list names the additive edges, an object names every edge's mode. */
function modeOf(edges: SafeAreaViewProps['edges'], edge: Edge): EdgeMode {
    if (edges === undefined) {
        return 'additive';
    }

    return Array.isArray(edges)
        ? (edges as readonly Edge[]).includes(edge)
            ? 'additive'
            : 'off'
        : ((edges as Partial<Record<Edge, EdgeMode>>)[edge] ?? 'off');
}

/** The view's own padding on one edge, in points. */
function ownPadding(style: Record<string, unknown>, edge: Edge): number {
    const side = `padding${edge[0]?.toUpperCase()}${edge.slice(1)}`;
    const axis = edge === 'top' || edge === 'bottom' ? 'paddingVertical' : 'paddingHorizontal';
    const value = style[side] ?? style[axis] ?? style['padding'];

    return typeof value === 'number' ? value : 0;
}

/** A view padded by the insets of the edges it names (all four by default). */
export const SafeAreaView: FC<SafeAreaViewProps> = ({ edges, style, ...rest }) => {
    const insets = useSafeAreaInsets();
    const own: Record<string, unknown> = { ...StyleSheet.flatten(style) };
    const padding = Object.fromEntries(
        EDGES.map((edge) => [
            `padding${edge[0]?.toUpperCase()}${edge.slice(1)}`,
            edgePadding(insets[edge], modeOf(edges, edge), ownPadding(own, edge)),
        ]),
    );

    return <View {...rest} style={[style, padding]} />;
};
