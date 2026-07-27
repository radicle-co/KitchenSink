/**
 * @module @commise/ui/surface — the WEB leg of the backdrop-blur capability probe.
 *
 * A frosted-glass surface is designed to sit OVER a blurred backdrop. Where the host cannot blur, painting
 * the translucent tint anyway produces a washed-out panel that reads as a rendering fault, so the surface
 * must take the tier's more-opaque solid `fallback` instead. This probe is how a surface knows which.
 *
 * On the web that question is settled: `backdrop-filter` is baseline in every browser the app supports, and
 * the web glass projection (`toWebGlass`) emits it unconditionally. So this leg is `true` — a constant, not a
 * feature test. It exists as the platform sibling of `blurSupport.native.ts` (§14.3/§14.4: same public API on
 * both legs) so a consumer can ask the question once, in platform-neutral code.
 */

/**
 * Whether the host can actually blur a backdrop.
 *
 * Reads no DOM and performs no I/O — it is a compile-time constant on this platform, safe to call at module
 * scope. The mirror of {@link import('./blurSupport.native.js').isBlurSupported}.
 *
 * @returns `true` — web hosts render a real `backdrop-filter`.
 */
export function isBlurSupported(): boolean {
    return true;
}
