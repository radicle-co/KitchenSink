/**
 * @module @commise/ui/motion — the motion props of a Tamagui element, decided from the reduce-motion answer.
 *
 * The config's animation driver does not read the cook's reduce-motion setting, so no Tamagui element may be given a
 * motion prop directly. Every one comes from here, as a spread (`{...motionPropsOf(reduceMotion).sheet}`), and
 * `tamaguiMotionProps.test.ts` fails for any other source of those props. Only a known `false` moves; `undefined` (not
 * read yet) is instant, the rule `Sheet.native.tsx` already held for the Modal's own slide.
 *
 * @pattern Strategy — a pure choice of motion by the reduce-motion answer, over the one named spring in the config
 */

/** The name of the one spring in `tamaguiConfig.native.ts`; `tamaguiConfig.native.test.tsx` pins the config's keys to it. */
const SPRING = 'sheet';

/** An instant move: Tamagui's explicit `transitionConfig` always wins over a named `transition`. */
const INSTANT = { type: 'timing', duration: 0 } as const;

/** The props to spread onto the Sheet and onto its overlay. */
export interface MotionProps {
    /**
     * Which of the two prop sets this is, for an element's `key`. Tamagui runs a component's animation hooks only while it
     * has a `transition` prop, so an element whose props gain or lose one must remount rather than re-render.
     */
    readonly mode: 'moving' | 'still';
    readonly sheet: { readonly transition: typeof SPRING } | { readonly transitionConfig: typeof INSTANT };
    /** A fade: Tamagui 3 writes it as an opacity clause, `value enter:start exit:end`. Instant: nothing to fade. */
    readonly overlay:
        { readonly transition: typeof SPRING; readonly opacity: '1 enter:0 exit:0' } | Record<never, never>;
}

/**
 * The Sheet's and overlay's motion props for a reduce-motion answer. Pure.
 *
 * @param reduceMotion - `useReduceMotion()`'s answer: `false` is known off; `true` and `undefined` are instant.
 * @returns The props for each part.
 */
export function motionPropsOf(reduceMotion: boolean | undefined): MotionProps {
    return reduceMotion === false
        ? {
              mode: 'moving',
              sheet: { transition: SPRING },
              overlay: { transition: SPRING, opacity: '1 enter:0 exit:0' },
          }
        : { mode: 'still', sheet: { transitionConfig: INSTANT }, overlay: {} };
}
