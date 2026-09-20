/**
 * @module fixtures/IconGlyph — a presentational leaf whose props EXTEND React's own `SVGProps`.
 *
 * Without a prop filter this one component contributes ~250 inherited DOM props — every SVG attribute and
 * every DOM event handler — and its own single prop is buried. Measured on `@commise/features-recipes`,
 * inheriting props of this kind took the package from 640 documented props to 1,127, the majority of them
 * `ReactEventHandler<SVGSVGElement>`. React's props are React's documentation; this fixture pins that the
 * catalogue carries the component's OWN contract.
 */
import type { FC, SVGProps } from 'react';

/** Props for {@link IconGlyph}. */
export interface IconGlyphProps extends SVGProps<SVGSVGElement> {
    /** Which glyph to draw. */
    readonly glyph: 'check' | 'plus';
}

/** A decorative glyph. */
export const IconGlyph: FC<IconGlyphProps> = ({ glyph, ...rest }) => <svg {...rest} data-glyph={glyph} />;
