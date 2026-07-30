/**
 * @module @commise/ui/motion — the web design-system {@link EnterTransition} primitive.
 *
 * A presentational wrapper: it renders a block carrying the design-system section-enter utility (the same
 * rise + fade the Home gradient hero uses), optionally delayed so a run of sections staggers in.
 *
 * Two deliberate properties:
 *  - **No JavaScript in the gesture.** The keyframe is pure CSS, so the content is visible in the server
 *    render and never depends on hydration — a mount-toggle implementation would hide the section until JS
 *    landed, which is a worse failure than having no animation.
 *  - **The gate, not an override.** The animation utility sits behind `motion-safe:`, so under
 *    `prefers-reduced-motion: reduce` no animation (and therefore no hidden from-state) is emitted at all.
 */
import type { FC } from 'react';

import type { EnterTransitionProps } from './props.js';

/**
 * The design-system section-enter utility: a short rise + fade, applied ONLY when motion is safe. Registered
 * as the `--animate-section-enter` theme token, so reduce-motion viewers get the settled section directly.
 */
export const enterTransitionClassName = 'motion-safe:animate-section-enter';

/** The Commise enter-transition wrapper — a section that rises + fades in when motion is safe. */
export const EnterTransition: FC<EnterTransitionProps> = ({ children, delayMs = 0, className }) => (
    <div
        className={className === undefined ? enterTransitionClassName : `${enterTransitionClassName} ${className}`}
        // The stagger is per-instance data, not a design token, so it is an inline custom delay rather than
        // one arbitrary-value utility class per rail.
        style={delayMs === 0 ? undefined : { animationDelay: `${delayMs}ms` }}
    >
        {children}
    </div>
);
