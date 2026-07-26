/**
 * @module @commise/ui/press-scale — platform-neutral barrel for the design-system PressScale primitive.
 * The component specifier resolves to its web (`PressScale.tsx`) or native (`PressScale.native.tsx`) leaf
 * at bundle time; the prop contract is platform-agnostic. Consumed as `@commise/ui/press-scale`.
 */
export { PressScale } from './PressScale.js';
export { PRESS_SCALE, pressedScale } from './pressedScale.js';
export type { PressedScaleInput } from './pressedScale.js';
export type { PressScaleProps, PressScaleRole } from './props.js';
