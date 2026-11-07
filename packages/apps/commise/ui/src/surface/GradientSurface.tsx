/**
 * @module @commise/ui/surface — the web {@link GradientSurface} brand primitive.
 *
 * Paints a brand gradient (from the single-source `gradient` tokens) behind its children via a CSS
 * `linear-gradient` inline background, so the web and native (`expo-linear-gradient`) legs can never drift
 * on colour or direction. Presentational: it owns no state and applies no motion (a gradient background is
 * static), so there is nothing to gate on reduced motion. Layout is the consumer's via `className`.
 *
 * @pattern Adapter projecting the single-source `gradient` tokens onto a CSS `linear-gradient` — the projection is
 *     the whole unit, so the web and native legs cannot drift on colour or direction.
 */
import type { FC } from 'react';

import { coverGradient, gradient as gradientTokens, gradientCss } from '../tokens/gradients.js';
import type { GradientSurfaceProps } from './props.js';

/** The cover wash on web: the theme's own cover tint properties, so it follows light and dark without a second path. */
const COVER_CSS = gradientCss(coverGradient({ sky: 'var(--color-cover-sky)', cream: 'var(--color-cover-cream)' }));

/** The Commise gradient background surface — a brand gradient painted behind arbitrary hero content. */
export const GradientSurface: FC<GradientSurfaceProps> = ({
    gradient = 'hero',
    children,
    className,
    accessibilityLabel,
}) => (
    <div
        // The canvas wash is the `bg-hero` utility, which the dark block re-themes (D15); the other ramps are the same
        // in both themes, so they stay inline.
        className={gradient === 'hero' ? `bg-hero ${className ?? ''}`.trim() : className}
        style={
            gradient === 'hero'
                ? undefined
                : { backgroundImage: gradient === 'cover' ? COVER_CSS : gradientCss(gradientTokens[gradient]) }
        }
        aria-label={accessibilityLabel}
        // A labelled surface is a named grouping (keeps its children in the a11y tree, unlike role=img).
        role={accessibilityLabel ? 'group' : undefined}
    >
        {children}
    </div>
);
