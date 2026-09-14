/**
 * @module components/AppCanvas — the app-wide brand background wash (native; issue #145).
 *
 * ## Pattern
 *
 * Decorator over the shared {@link GradientSurface} surface-treatment adapter: it adds the app's canvas
 * treatment to an arbitrary subtree without knowing anything about it. Pure and presentational — `props →
 * JSX`, no state, no effects, no data.
 *
 * ## Why it exists, and why it is mounted ONCE at the root
 *
 * All nine wireframes paint their page with the SAME named token, `--gradient-beach-glow`, which is
 * `@commise/ui`'s `gradient.hero`. Mobile instead painted a flat `palette.sand` on each screen's own
 * container, so every surface read as a plain sand page. Mounting the wash here — above the navigator, below
 * the providers — is the native mirror of web's single `body` rule in `globals.css`: one gradient, one
 * definition (the token), one consumer per platform. Painting it per-screen instead would put the same
 * knowledge in a dozen places and guarantee the next screen forgets it.
 *
 * Because the canvas lives at the root, screen containers MUST stay transparent — an opaque full-bleed fill
 * occludes the ramp completely and silently restores the old flat look. `tests/canvasSurfaces.native.test.tsx`
 * enforces that.
 *
 * There is no motion here (a background wash is static), so there is nothing to gate on reduced motion.
 */
import { GradientSurface } from '@commise/ui/surface';
import type { FC, ReactNode } from 'react';
import { StyleSheet } from 'react-native';

/** Props for {@link AppCanvas}. */
export interface AppCanvasProps {
    /** The app subtree painted over the canvas. */
    readonly children?: ReactNode;
}

/**
 * The Commise app canvas — the brand beach-glow gradient behind the entire app.
 *
 * @param props - The app subtree to paint over the canvas.
 * @returns The subtree on the brand gradient background.
 */
export const AppCanvas: FC<AppCanvasProps> = ({ children }) => (
    <GradientSurface gradient="hero" style={styles.canvas}>
        {children}
    </GradientSurface>
);

const styles = StyleSheet.create({
    // `flex: 1` makes the gradient fill the host view, so the ramp spans the whole screen exactly as the
    // wireframes' full-viewport `body` background does.
    canvas: { flex: 1 },
});
