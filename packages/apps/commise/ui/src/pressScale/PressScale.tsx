/**
 * @module @commise/ui/press-scale — the web design-system {@link PressScale} press-feedback primitive.
 *
 * A presentational wrapper: it renders a span carrying the design-system press-scale utility, `inline-flex` by
 * default and a stretching flex box under `width="fill"`. CSS places an activated element's ANCESTORS into the
 * `:active` state, so wrapping an interactive child (a `<button>`, a linked card, the FAB) makes that child's press
 * shrink the span — the child keeps ALL press semantics and accessibility, this leaf contributes only the motion. The
 * scale is gated behind `motion-safe:`, so under `prefers-reduced-motion: reduce` no transition or transform is emitted
 * at all (a clean gate, not a specificity fight with an override utility).
 *
 * @pattern Decorator over its child's press state — CSS puts an activated element's ANCESTORS into `:active`, so
 *     wrapping is enough and the child keeps all of the press semantics.
 */
import type { FC } from 'react';

import type { PressScaleProps, PressScaleWidth } from './props.js';

/**
 * The design-system press-scale utility. The transform + transition apply ONLY when motion is safe, so reduce-motion
 * users get no press motion. No scale while the child is `aria-disabled`: a natively disabled child never matches
 * `:active`, but a busy or refused one does, and shrinking on a press the child refuses would read as the press being
 * accepted.
 */
const PRESS_MOTION =
    'motion-safe:transition-transform motion-safe:duration-100 motion-safe:not-has-aria-disabled:active:scale-[0.98]';

/**
 * The wrapper's box per {@link PressScaleWidth}. `auto` is `inline-flex`, so the wrapper hugs its child (no layout
 * change). `fill` is a block-level flex box that stretches across its parent's cross axis; a block (non-flex) parent
 * such as a sheet footer gives it the full line, which an `inline-flex` span would not.
 */
const WRAPPER_BOX: Record<PressScaleWidth, string> = {
    auto: 'inline-flex',
    fill: 'flex self-stretch',
};

/** The Commise press-feedback wrapper — the wrapped child's `:active` scales this span (motion-safe). */
export const PressScale: FC<PressScaleProps> = ({ children, width = 'auto' }) => (
    <span className={`${WRAPPER_BOX[width]} ${PRESS_MOTION}`}>{children}</span>
);
