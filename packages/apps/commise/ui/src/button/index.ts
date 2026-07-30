/**
 * @module @commise/ui/button — platform-neutral barrel for the design-system Button. The component
 * specifier resolves to its web (`Button.tsx`) or native (`Button.native.tsx`) leaf at bundle time; the
 * prop/variant contract is platform-agnostic. Consumed as `@commise/ui/button`.
 */
export { Button } from './Button.js';
export { buttonSurfaceClass } from './surfaceClass.js';
export type { ButtonProps, ButtonVariant } from './props.js';
