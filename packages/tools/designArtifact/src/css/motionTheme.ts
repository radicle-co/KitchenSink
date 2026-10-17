/**
 * @module css/motionTheme — the three animation tokens the product components rely on, for the artifact stylesheet.
 *
 * ⛔ This is a COPY, and `packages/apps/commise/web/src/app/globals.css` is the authority: `motionTheme.test.ts`
 * parses both and fails when a token or a keyframe drifts. The components that need them live in `@commise/ui`
 * (`enterMotion.ts` and `PendingBar.tsx` use `animate-section-enter` and `animate-pending-bar-reveal`), so the
 * blocks belong in `@commise/ui/theme.css` beside them; until they move there, this file keeps the artifact's
 * stylesheet complete without a second hand-maintained definition that nothing checks.
 */

/** The `@theme` animation tokens and their `@keyframes`, verbatim from the web app. */
export const MOTION_THEME_CSS = `@theme {
    --animate-home-hero-enter: home-hero-enter 400ms ease-out both;
}

@keyframes home-hero-enter {
    from {
        opacity: 0;
        transform: translateY(0.5rem);
    }

    to {
        opacity: 1;
        transform: none;
    }
}

@theme {
    --animate-section-enter: section-enter 400ms ease-out both;
}

@keyframes section-enter {
    from {
        opacity: 0;
        transform: translateY(0.5rem);
    }

    to {
        opacity: 1;
        transform: none;
    }
}

@theme {
    --animate-pending-bar-reveal: pending-bar-reveal 0s linear both;
}

@keyframes pending-bar-reveal {
    from {
        opacity: 0;
    }

    to {
        opacity: 1;
    }
}
`;
