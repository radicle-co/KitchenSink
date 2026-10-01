/**
 * @module @commise/ui/live-region — package export for the native `LiveRegion`. Native-only: web already has
 * working `role="alert"` / `role="status"` live regions, so the specifier resolves to the native leaf on every
 * platform. Consumed as `@commise/ui/live-region`.
 */
export { LiveRegion } from './LiveRegion.native.js';
export type { LiveRegionPoliteness, LiveRegionProps } from './props.js';
