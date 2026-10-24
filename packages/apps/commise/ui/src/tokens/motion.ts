/**
 * @module tokens/motion — the web animation tokens (`--animate-*`) and their `@keyframes`, as the ONE source.
 *
 * Two gestures are used by `@commise/ui` components as `animate-*` utilities, and each is a pair: a theme token
 * naming the animation and a keyframes rule defining it. They are emitted into `theme.css`, so every consumer of
 * `@commise/ui/theme.css` gets them and none restates a number.
 *
 * The values are NOT restated either: the enter pace and rise are the constants the native `EnterTransition` leaf
 * reads (`ENTER_DURATION_MS`, `ENTER_RISE_PX`), so the two platforms cannot drift on one gesture. The pending-bar
 * reveal is a zero-length animation whose `both` fill holds the bar invisible through an `animation-delay` the
 * component sets inline from `PENDING_BAR_DELAY_MS` (single-sourced in `pendingBar/pendingDelay.ts`).
 *
 * ⚠️ The keyframes are emitted OUTSIDE `@theme` on purpose: keyframes inside it are emitted only when the token is
 * used, and these tokens are used by sources the consuming stylesheet may not scan.
 *
 * @pattern Single source of truth — web CSS derived from the constants native already reads
 */
import { ENTER_DURATION_MS, ENTER_RISE_PX } from '../motion/enterMotion.js';

import { pxToRemUnit } from './emit.js';

/** Easing of the enter gesture. */
const ENTER_EASING = 'ease-out';

/** One `@keyframes` step: its selector and declarations. */
interface KeyframeStep {
    readonly at: 'from' | 'to';
    readonly declarations: readonly string[];
}

/** One animation: its token value (`--animate-{name}`) and the keyframes rule of the same name. */
interface MotionAnimation {
    readonly name: string;
    /** Duration, timing function and fill mode, in `animation` shorthand order after the name. */
    readonly timing: string;
    readonly steps: readonly KeyframeStep[];
}

/** A short rise and fade: every discovery section's enter. */
const riseAndFade: readonly KeyframeStep[] = [
    { at: 'from', declarations: ['opacity: 0;', `transform: translateY(${pxToRemUnit(ENTER_RISE_PX)});`] },
    { at: 'to', declarations: ['opacity: 1;', 'transform: none;'] },
];

const enterTiming = `${ENTER_DURATION_MS}ms ${ENTER_EASING} both`;

/** The animations, in emission order. Applied behind `motion-safe:` except the pending-bar reveal, which is a delay. */
const animations: readonly MotionAnimation[] = [
    { name: 'section-enter', timing: enterTiming, steps: riseAndFade },
    {
        name: 'pending-bar-reveal',
        timing: '0s linear both',
        steps: [
            { at: 'from', declarations: ['opacity: 0;'] },
            { at: 'to', declarations: ['opacity: 1;'] },
        ],
    },
];

/**
 * The `--animate-{name}` declarations for the `@theme` block, indented one level. Pure.
 *
 * @returns One line per animation.
 */
export function motionThemeDeclarations(): readonly string[] {
    return animations.map(({ name, timing }) => `    --animate-${name}: ${name} ${timing};`);
}

/**
 * The `@keyframes` rules, for the top level of the stylesheet. Pure.
 *
 * @returns Lines, rules separated by one blank line and no blank line before the first or after the last.
 */
export function motionKeyframes(): readonly string[] {
    return animations.flatMap(({ name, steps }, animationIndex) => [
        ...(animationIndex === 0 ? [] : ['']),
        `@keyframes ${name} {`,
        ...steps.flatMap(({ at, declarations }, stepIndex) => [
            ...(stepIndex === 0 ? [] : ['']),
            `    ${at} {`,
            ...declarations.map((line) => `        ${line}`),
            '    }',
        ]),
        '}',
    ]);
}
