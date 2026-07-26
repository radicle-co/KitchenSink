/**
 * @module @commise/ui/motion — platform-neutral barrel for the design-system motion primitives. The
 * component specifier resolves to its web (`EnterTransition.tsx`) or native (`EnterTransition.native.tsx`)
 * leaf at bundle time; the prop contract is platform-agnostic. Consumed as `@commise/ui/motion`.
 */
export { EnterTransition } from './EnterTransition.js';
export { ENTER_DURATION_MS, ENTER_RISE_PX, enterMotionMode } from './enterMotion.js';
export type { EnterMotionInput, EnterMotionMode } from './enterMotion.js';
export type { EnterTransitionProps } from './props.js';
