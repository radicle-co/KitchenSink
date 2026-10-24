/**
 * @module @commise/ui/container-class — the container and viewport classes as pure functions of a width
 * (`docs/design/uiOverhaul/buildSpec.md` §1.2).
 *
 * Platform-neutral on purpose: `@commise/ui/layout` is native-only, and the web reads the same thresholds through
 * Tailwind's `nav:`, `medium:` and `@regular/main:`/`@wide/main:` variants instead. Native passes the window width to
 * {@link contentWidthOf} and the result to {@link containerClassOf}, which is what `useContainerClass` does.
 *
 * Every threshold is inclusive at its pixel, the same as CSS `(width >= …)`, so both platforms agree at the boundary.
 *
 * @pattern Policy — each function owns one rule over the shared layout tokens; consumers receive the decided class
 */
import {
    containerThreshold,
    gutter,
    viewportThreshold,
    type ContainerClass,
    type ViewportClass,
} from '../tokens/layout.js';

export type { ContainerClass, ViewportClass };

/**
 * The container class of a content width.
 *
 * @param contentPx - The width content actually gets, in px.
 * @returns `narrow` below 600, `regular` from 600, `wide` from 960.
 */
export function containerClassOf(contentPx: number): ContainerClass {
    if (contentPx >= containerThreshold.wide) {
        return 'wide';
    }

    return contentPx >= containerThreshold.regular ? 'regular' : 'narrow';
}

/**
 * The viewport class of a window width.
 *
 * @param windowPx - The window's width, in px.
 * @returns `compact` below 600, `medium` from 600, `expanded` from 840.
 */
export function viewportClassOf(windowPx: number): ViewportClass {
    if (windowPx >= viewportThreshold.expanded) {
        return 'expanded';
    }

    return windowPx >= viewportThreshold.medium ? 'medium' : 'compact';
}

/**
 * The page gutter at a window width.
 *
 * @param windowPx - The window's width, in px.
 * @returns The gutter on each side, in px.
 */
export function gutterOf(windowPx: number): number {
    return gutter[viewportClassOf(windowPx)];
}

/**
 * The width content gets in a window with no sidebar: the window less a gutter on each side. Native never shows a
 * sidebar (§1.2), so this is native's content width at every size.
 *
 * @param windowPx - The window's width, in px.
 * @returns The content width, in px, never negative.
 */
export function contentWidthOf(windowPx: number): number {
    return Math.max(0, windowPx - 2 * gutterOf(windowPx));
}
