/**
 * The size of a web touch target, in CSS px so that it keeps its 44 px floor at every text size (designer D64).
 *
 * - `fixed`: a target whose only content is a glyph. It is 44 px square and never grows with the text.
 * - `min`: a target that holds text. It is at least 44 px each way and grows with its text.
 *
 * Each class is written whole, because Tailwind finds a class only when it appears whole in the source.
 *
 * @module @commise/ui/touch-target
 * @pattern Style Recipe — one pure set of size classes per kind of touch target
 */
export const TOUCH_TARGET_CLASS = {
    fixed: 'size-[44px]',
    min: 'min-h-[44px] min-w-[44px]',
} as const;
