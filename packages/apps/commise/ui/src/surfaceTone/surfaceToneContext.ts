/**
 * @module @commise/ui/surface-tone — the native half of "a surface states itself once" (`componentFixes.md` §10): a React
 * context holding the tone of the nearest surface above a control. Web needs no context (the cascade carries the tone as
 * inherited custom properties, `surfaceToneClass.ts`); only native leaves import this, and it is NOT in the barrel.
 *
 * The default is the canvas, so a control outside every surface reads the page and a missed container falls back to
 * the page, never to a wrong colour. The context is the React tree, not the native view tree, so it passes through a
 * `Modal`: a popup root therefore states its own tone, and what is behind it is never read by what is in it.
 *
 * @pattern Ambient Context — native React Context carrying the nearest surface's tone, over the one tone table
 */
import { createContext, createElement, useContext, type FC, type ReactNode } from 'react';

import { DEFAULT_SURFACE_TONE, type SurfaceTone } from './surfaceTone.js';

const SurfaceToneContext = createContext<SurfaceTone>(DEFAULT_SURFACE_TONE);

/**
 * States a tone to everything inside, painting nothing. For a root that paints itself (an animated sheet) and so cannot
 * be a `Surface`; it paints its fill with `surfaceFill`, so the paint and the statement still come from one row.
 */
export const SurfaceToneScope: FC<{ readonly tone: SurfaceTone; readonly children?: ReactNode }> = ({
    tone,
    children,
}) => createElement(SurfaceToneContext.Provider, { value: tone }, children);

/**
 * The tone of the nearest surface above the caller.
 *
 * @returns The tone; the canvas outside every surface.
 */
export function useSurfaceTone(): SurfaceTone {
    return useContext(SurfaceToneContext);
}
