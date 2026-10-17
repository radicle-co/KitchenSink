/**
 * @module @commise/ui/chip — the web class recipes for a chip and a chip row (the "style recipe" pattern of
 * `button/surfaceClass.ts`), shared by `Chip` and the options `ChipRow` draws in choice mode.
 *
 * The chip (spec §1.6/§1.10): a 36 px pill (`rounded-full`: a chip is pressable, so it is a pill), hit at 44 px on a
 * coarse pointer by a transparent `::before` overlay. The overlay reaches 6 px past the padding box, not 4: it is
 * placed from inside the edge, and a selected chip's 1.5 px edge left a 4 px reach one pixel short (measured: a 43 px
 * band). At rest `paper`, a 1 px `lineControl` edge and an `ink` label; `pearl` on hover and press. Selected: the
 * `selectedFill` tint, a 1.5 px `selectedEdge` and an `actionText` label (5.18:1 on the tint) — the check glyph the
 * leaf draws is what keeps selection from resting on colour alone.
 *
 * The row: one line, 16 px of trailing room, or wrapped lines. A scrolling row sits inside the design-system
 * `HorizontalScroller` (`ChipRow.tsx`), which owns the overflow, the snapping, the hidden scrollbar and the hint at the
 * trailing edge. A row that scrolls sideways clips vertically too, which cut each chip's coarse-pointer overlay back to
 * its 36 px pill (measured: a 37 px tap band); on a coarse pointer the line therefore keeps 6 px of room above and
 * below for it, and the wrapper `ChipRow` draws around the scroller cancels it with a negative margin so the layout
 * does not move.
 */
import type { ChipRowOverflow } from './props.js';

/** Tier-independent chip geometry and states. */
const CHIP_BASE =
    "relative inline-flex min-h-9 max-w-full shrink-0 snap-start items-center gap-1 rounded-full px-3 text-label transition before:absolute before:inset-x-0 before:content-[''] pointer-coarse:before:-inset-y-1.5 " +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ' +
    'disabled:cursor-not-allowed disabled:opacity-40';

/**
 * A chip's label: at most two lines, then an ellipsis, breaking inside a word if it must. A label is already cut to 24
 * characters (`chipLabel.ts`); this is what keeps that cut chip inside a 320 px row at a 200% font size, where it can
 * be wider than the row, rather than pushing the page sideways (SC 1.4.10). Never `nowrap`.
 */
export const CHIP_LABEL_CLASS = 'line-clamp-2 min-w-0 text-start [overflow-wrap:anywhere]';

/** The resting and selected surfaces. */
const CHIP_REST = 'border border-line-control bg-paper text-ink hover:bg-ink/6 active:bg-ink/6';
const CHIP_SELECTED = 'border-[1.5px] border-selected-edge bg-selected-fill text-action-text';

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
export const SCROLL_BOX_CLASS = 'min-w-0 pointer-coarse:-my-1.5';

/** Each overflow's row layout. */
const ROW: Readonly<Record<ChipRowOverflow, string>> = {
    scroll: 'flex flex-nowrap gap-2 pe-4 pointer-coarse:py-1.5',
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
