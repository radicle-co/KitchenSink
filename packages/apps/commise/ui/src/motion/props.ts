/**
 * @module @commise/ui/motion — shared, platform-neutral prop contract for the design-system
 * `EnterTransition` primitive.
 *
 * `EnterTransition` gives a section the brand enter gesture — a short rise + fade as it appears — and owns
 * the reduce-motion gate so no consumer has to. The two leaves reach the same gesture differently, and the
 * asymmetry is intrinsic:
 *  - **web** (`EnterTransition.tsx`) is PRESENTATIONAL: it wraps its children in a element carrying the
 *    `motion-safe:animate-section-enter` utility. CSS runs the keyframe without JavaScript, so the content is
 *    never hidden behind hydration, and under `prefers-reduced-motion: reduce` the utility is not emitted at
 *    all — a clean gate rather than a specificity fight.
 *  - **native** (`EnterTransition.native.tsx`) OWNS the animation: React Native has no CSS, so it drives an
 *    `Animated.Value` and must first read the OS preference asynchronously (see `enterMotion.ts`).
 *
 * Callers get one import and one mental model ("wrap the section that should enter"); each leaf honours it in
 * the only way its platform allows.
 */
import type { ReactNode } from 'react';

/** The cross-platform contract shared by the web and native `EnterTransition` leaves. */
export interface EnterTransitionProps {
    /** The content that enters. */
    readonly children: ReactNode;
    /**
     * Milliseconds to hold before this section enters, for staggering a list of sections. Defaults to `0`
     * (enter immediately).
     */
    readonly delayMs?: number;
    /** Extra utility classes for the wrapper. WEB only — the native leaf has no class names. */
    readonly className?: string;
}
