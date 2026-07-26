/**
 * @module @commise/ui/surface — the web {@link GlassCard} brand primitive.
 *
 * A frosted-glass card: a translucent white surface over a `backdrop-filter` blur (both from the
 * single-source `glass` tokens), with an opaque solid `fallback` when the host cannot blur. The blur is
 * NOT a hardcoded assumption — the composing app passes `blurSupported` (detection is a side effect that
 * belongs in the app, not this pure render leaf); when it is `false` the card renders the readable solid
 * surface with no blur. Layout is the consumer's via `className`.
 */
import type { CSSProperties, FC } from 'react';

import { glass as glassTokens, glassBackdropCss } from '../tokens/gradients.js';
import type { GlassCardProps } from './props.js';

/** The Commise frosted-glass card — translucent-over-blur when supported, opaque solid fallback when not. */
export const GlassCard: FC<GlassCardProps> = ({
    tier = 'card',
    blurSupported = true,
    children,
    className,
    accessibilityLabel,
}) => {
    const spec = glassTokens[tier];
    const style: CSSProperties = blurSupported
        ? {
              backgroundColor: spec.surface,
              backdropFilter: glassBackdropCss(spec),
              WebkitBackdropFilter: glassBackdropCss(spec),
          }
        : { backgroundColor: spec.fallback };

    return (
        <div
            className={className}
            style={style}
            aria-label={accessibilityLabel}
            role={accessibilityLabel ? 'group' : undefined}
        >
            {children}
        </div>
    );
};
