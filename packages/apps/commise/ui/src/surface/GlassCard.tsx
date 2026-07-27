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

import { glass as glassTokens, toWebGlass } from '../tokens/gradients.js';
import type { GlassCardProps } from './props.js';

/** The Commise frosted-glass card — translucent-over-blur when supported, opaque solid fallback when not. */
export const GlassCard: FC<GlassCardProps> = ({
    tier = 'card',
    blurSupported = true,
    children,
    className,
    accessibilityLabel,
}) => {
    // The tier → CSS projection lives in the tokens (`toWebGlass`), NOT here, so a component whose shell must
    // stay a particular element (an `<article>`/`<button>` card that cannot be wrapped in this primitive
    // without changing its DOM semantics) paints the identical surface from the identical source.
    const style: CSSProperties = toWebGlass(glassTokens[tier], blurSupported);

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
