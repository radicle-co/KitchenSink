/**
 * @module @commise/ui/surface — platform-neutral barrel for the brand gradient surface. The component
 * specifiers resolve to their web (`*.tsx`) or native (`*.native.tsx`) leaves at bundle time; the prop
 * contracts are platform-agnostic. Consumed as `@commise/ui/surface`.
 */
export { GradientSurface } from './GradientSurface.js';
export type { GradientSurfaceProps, SurfaceStyle } from './props.js';
export type { GradientName } from '../tokens/gradients.js';
