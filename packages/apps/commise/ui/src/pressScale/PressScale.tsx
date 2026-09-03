/**
 * @module @commise/ui/press-scale — the web design-system {@link PressScale} press-feedback primitive.
 *
 * A presentational wrapper: it renders an `inline-flex` span carrying the design-system press-scale
 * utility. CSS places an activated element's ANCESTORS into the `:active` state, so wrapping an
 * interactive child (a `<button>`, a linked card, the FAB) makes that child's press shrink the span — the
 * child keeps ALL press semantics and accessibility, this leaf contributes only the motion. The scale is
 * gated behind `motion-safe:`, so under `prefers-reduced-motion: reduce` no transition or transform is
 * emitted at all (a clean gate, not a specificity fight with an override utility).
 *
 * @pattern Decorator over its child's press state — CSS puts an activated element's ANCESTORS into `:active`, so
 *     wrapping is enough and the child keeps all of the press semantics.
 */
import type { FC } from 'react';

import type { PressScaleProps } from './props.js';

/**
 * The design-system press-scale utility. `inline-flex` so the wrapper hugs its child (no layout change);
 * the transform + transition apply ONLY when motion is safe, so reduce-motion users get no press motion.
 */
export const pressScaleClassName =
    'inline-flex motion-safe:transition-transform motion-safe:duration-100 motion-safe:active:scale-[0.98]';

/** The Commise press-feedback wrapper — the wrapped child's `:active` scales this span (motion-safe). */
export const PressScale: FC<PressScaleProps> = ({ children }) => (
    <span className={pressScaleClassName}>{children}</span>
);
