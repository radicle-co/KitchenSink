/**
 * @module @commise/ui/surface — platform-neutral barrel for the brand surface primitives. The component
 * specifiers resolve to their web (`*.tsx`) or native (`*.native.tsx`) leaves at bundle time; the prop
 * contracts are platform-agnostic. Consumed as `@commise/ui/surface`.
 */
export { GradientSurface } from './GradientSurface.js';
export { GlassCard } from './GlassCard.js';
export { isBlurSupported } from './blurSupport.js';
export type { GradientSurfaceProps, GlassCardProps, SurfaceStyle } from './props.js';
export type { GradientName, GlassName } from '../tokens/gradients.js';
