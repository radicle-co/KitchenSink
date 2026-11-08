/**
 * @module @commise/ui/chip — the web class recipes for a chip and a chip row (the "style recipe" pattern of
 * `button/surfaceClass.ts`), shared by `Chip` and the options `ChipRow` draws in choice mode.
 *
 * The chip (spec §1.6/§1.10, and `componentFixes.md` §4, owner ruling 2026-10-26): a 32 px pill (`rounded-full`: a
 * chip is pressable, so it is a pill), hit at 44 px on a coarse pointer by a transparent `::before` overlay. Buttons are
 * pills too, so a chip is told apart from a secondary button by its fill, its height and its type, not its shape: at
 * rest a `surfaceMuted` fill and no visible edge, and the `caption` role (14/500) in `ink`, never the 14/600 `label` a
 * button sets. A chip rests on the fill its surface gives chips (`surfaceMuted`; `paper` on a muted surface, where a muted chip would be invisible) and presses to that fill's row of the surface table (`componentFixes.md` §10a).
 *
 * The overlay reaches 8 px past the padding box. It is placed from inside the edge, and the edge is 1.5 px at rest and
 * selected alike (2 px while a selected chip is hovered or pressed), so the target is 32 - 3 + 16 = 45 px; at 6 px it
 * would be 41 px.
 * Selected: the `selectedFill` tint, a 1.5 px `selectedEdge` and an `actionText` label (5.18:1 on the tint) — the check
 * glyph the leaf draws is what keeps selection from resting on colour alone.
 *
 * The row: one line, 16 px of trailing room, or wrapped lines. A scrolling row sits inside the design-system
 * `HorizontalScroller` (`ChipRow.tsx`), which owns the overflow, the snapping, the hidden scrollbar and the hint at the
 * trailing edge. A row that scrolls sideways clips vertically too, which cut each chip's coarse-pointer overlay back to
 * its pill (measured: a 37 px tap band at 36 px); on a coarse pointer the line therefore keeps 8 px of room above and
 * below for it, and the wrapper `ChipRow` draws around the scroller cancels it with a negative margin so the layout
 * does not move.
 */
import type { ChipRowOverflow } from './props.js';
import { FOCUS_RING_CLASS } from '../focusRing/focusRingClass.js';
import { CHIP_REST_FILL_CLASS, PRESS_FILL_CLASS } from '../surfaceTone/surfaceToneClass.js';

/** Tier-independent chip geometry and states. */
const CHIP_BASE =
    "relative inline-flex min-h-8 max-w-full shrink-0 snap-start items-center gap-1 rounded-full px-3 text-caption transition before:absolute before:inset-x-0 before:content-[''] pointer-coarse:before:-inset-y-2 " +
    `${FOCUS_RING_CLASS.offset} ` +
    'disabled:cursor-not-allowed disabled:opacity-40';

/**
 * A chip's label: at most two lines, then an ellipsis, breaking inside a word if it must. A label is already cut to 24
 * characters (`chipLabel.ts`); this is what keeps that cut chip inside a 320 px row at a 200% font size, where it can
 * be wider than the row, rather than pushing the page sideways (SC 1.4.10). Never `nowrap`.
 */
export const CHIP_LABEL_CLASS = 'line-clamp-2 min-w-0 text-start [overflow-wrap:anywhere]';

/** The resting and selected surfaces. */
const CHIP_REST = `border-[1.5px] border-transparent ${CHIP_REST_FILL_CLASS} text-ink ${PRESS_FILL_CLASS.chip}`;
/**
 * Selected holds the SAME 1.5 px edge as rest, so selecting changes a colour and not a size. Hover and press show a 2 px
 * `selectedEdge` (`componentFixes.md` §6); the extra half pixel comes out of the inline padding, so the box stays put.
 */
const CHIP_SELECTED =
    'border-[1.5px] border-selected-edge bg-selected-fill text-action-text hover:border-2 active:border-2 ' +
    'hover:px-[calc(var(--spacing)*3_-_0.5px)] active:px-[calc(var(--spacing)*3_-_0.5px)]';

/**
 * A chip's classes. Pure.
 *
 * @param selected - Whether the chip shows a selected state.
 * @returns The `className`.
 */
export function chipClass(selected: boolean): string {
    return `${CHIP_BASE} ${selected ? CHIP_SELECTED : CHIP_REST}`;
}

/**
 * The box around the scroller: `min-w-0` so a flex or grid parent can shrink it below its chips, and the negative margin
 * that cancels a scrolling line's coarse-pointer padding.
 */
export const SCROLL_BOX_CLASS = 'min-w-0 pointer-coarse:-my-2';

/** Each overflow's row layout. */
const ROW: Readonly<Record<ChipRowOverflow, string>> = {
    scroll: 'flex flex-nowrap gap-2 pe-4 pointer-coarse:py-2',
    wrap: 'flex flex-wrap gap-2',
};

/**
 * A chip row's classes. Pure.
 *
 * @param overflow - Scroll one line, or wrap.
 * @returns The `className`.
 */
export function chipRowClass(overflow: ChipRowOverflow): string {
    return ROW[overflow];
}
