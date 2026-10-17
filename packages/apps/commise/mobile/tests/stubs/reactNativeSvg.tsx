/**
 * Vitest stand-in for `react-native-svg` (plan 012: the Google mark is the first SVG the app draws itself). The real
 * package has no react-native-web implementation, so under jsdom it renders the same elements as DOM SVG, keeping the
 * fills a suite can assert (Google's branding forbids a recoloured mark).
 */
import { createElement, type JSX, type ReactNode } from 'react';

interface SvgProps {
    readonly children?: ReactNode;
    readonly width?: number;
    readonly height?: number;
    readonly viewBox?: string;
    readonly 'aria-hidden'?: boolean;
}

export function Svg({ children, width, height, viewBox, 'aria-hidden': ariaHidden }: SvgProps): JSX.Element {
    return createElement('svg', { width, height, viewBox, 'aria-hidden': ariaHidden }, children);
}

export function Path({ d, fill }: { readonly d: string; readonly fill?: string }): JSX.Element {
    return createElement('path', { d, fill });
}

export default Svg;
