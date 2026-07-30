/**
 * @module @commise/ui/input — barrel for the design-system native Input. This primitive is native-only (the
 * web surfaces own a field idiom), so the specifier resolves to `Input.native.tsx` on every platform.
 * Consumed as `@commise/ui/input`.
 */
export { Input } from './Input.native.js';
export type { InputProps } from './props.js';
