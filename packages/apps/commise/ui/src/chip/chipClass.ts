/**
 * @module @commise/ui/chip — the web class recipes for a chip and a chip row (the "style recipe" pattern of
 * `button/surfaceClass.ts`), shared by `Chip` and the options `ChipRow` draws in choice mode.
 *
 * The chip (spec §1.6/§1.10): a 36 px pill (`rounded-full`: a chip is pressable, so it is a pill), hit at 44 px on a
 * coarse pointer by a transparent `::before` overlay. At rest `paper`, a 1 px `lineControl` edge and an `ink` label;
 * `pearl` on hover and press. Selected: the `selectedFill` tint, a 1.5 px `selectedEdge` and an `actionText` label
 * (5.18:1 on the tint) — the check glyph the leaf draws is what keeps selection from resting on colour alone.
 *
 * The row: one line that scrolls inside itself with proximity snapping, 16 px of trailing room and a 24 px fade at the
 * trailing edge, or wrapped lines. ⚠️ The fade is a static mask, so it also shows when the row is scrolled to its end;
 * a fade that tracks "more exists" needs a scroll-driven animation, which the theme does not emit yet.
 */
import type { ChipRowOverflow } from './props.js';

/** Tier-independent chip geometry and states. */
const CHIP_BASE =
    "relative inline-flex min-h-9 shrink-0 snap-start items-center gap-1 rounded-full px-3 text-label transition before:absolute before:inset-x-0 before:content-[''] pointer-coarse:before:-inset-y-1 " +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ' +
    'disabled:cursor-not-allowed disabled:opacity-40';

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

/** Each overflow's row layout. */
const ROW: Readonly<Record<ChipRowOverflow, string>> = {
    scroll:
        'flex flex-nowrap gap-2 overflow-x-auto snap-x snap-proximity pe-4 ' +
        '[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] ' +
        'rtl:[mask-image:linear-gradient(to_left,black_calc(100%-24px),transparent)]',
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
