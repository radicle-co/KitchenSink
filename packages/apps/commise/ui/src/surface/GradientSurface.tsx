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

import { gradient as gradientTokens, gradientCss } from '../tokens/gradients.js';
import type { GradientSurfaceProps } from './props.js';

/** The Commise gradient background surface — a brand gradient painted behind arbitrary hero content. */
export const GradientSurface: FC<GradientSurfaceProps> = ({
    gradient = 'hero',
    children,
    className,
    accessibilityLabel,
}) => (
    <div
        className={className}
        style={{ backgroundImage: gradientCss(gradientTokens[gradient]) }}
        aria-label={accessibilityLabel}
        // A labelled surface is a named grouping (keeps its children in the a11y tree, unlike role=img).
        role={accessibilityLabel ? 'group' : undefined}
    >
        {children}
    </div>
);
