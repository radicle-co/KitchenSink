/**
 * @module @commise/ui/surface-tone — the web paint of the surface-tone table (`surfaceTone.ts`): the classes a surface
 * wears to state its tone, and the classes a control wears to read it.
 *
 * ## Why every class is spelled out
 *
 * Tailwind finds class names by scanning SOURCE for literals, so a class assembled from the table at run time is never
 * emitted. Each row below is therefore written out in full, and `__tests__/surfaceToneClass.test.ts` parses the
 * literals back into roles and requires them to equal the table. The spelling is a second representation held equal by
 * that test, not a second source.
 *
 * ## How a control reads its surface
 *
 * A surface sets four INHERITING custom properties (`--cm-surface`, `--cm-press`, `--cm-chip-fill`, `--cm-chip-press`)
 * to colour properties (`var(--color-…)`), which the dark block re-themes. The chip pair names the tone's own
 * `--color-chip-fill-<tone>` and `--color-chip-press-<tone>`, because a chip's fill is chosen per theme (§10b) and the
 * stylesheet gives each its light and dark value from the table. A descendant reads them in its own utility, so a
 * container that states nothing hands its parent's tone down unchanged, and a control outside every surface reads the
 * fallback in its utility: the canvas row. All four are set on every tone, so a surface nested in another never
 * inherits a stale press.
 *
 * @pattern Policy — the table projected onto literal Tailwind classes, held equal to it by test
 */
import type { SurfaceTone } from './surfaceTone.js';

/**
 * Each tone's classes: its fill, then the four properties its controls read. `paperOverlay` is the sheet, dialog, menu
 * and popover surface; a portal leaves the DOM tree, so each popup root states it itself.
 */
export const SURFACE_TONE_CLASS: Readonly<Record<SurfaceTone, string>> = {
    canvas:
        'bg-canvas [--cm-surface:var(--color-canvas)] [--cm-press:var(--color-press-canvas)] ' +
        '[--cm-chip-fill:var(--color-chip-fill-canvas)] [--cm-chip-press:var(--color-chip-press-canvas)]',
    paper:
        'bg-paper [--cm-surface:var(--color-paper)] [--cm-press:var(--color-press-paper)] ' +
        '[--cm-chip-fill:var(--color-chip-fill-paper)] [--cm-chip-press:var(--color-chip-press-paper)]',
    paperRaised:
        'bg-paper-raised [--cm-surface:var(--color-paper-raised)] [--cm-press:var(--color-press-paper-raised)] ' +
        '[--cm-chip-fill:var(--color-chip-fill-paper-raised)] [--cm-chip-press:var(--color-chip-press-paper-raised)]',
    paperOverlay:
        'bg-paper-overlay [--cm-surface:var(--color-paper-overlay)] [--cm-press:var(--color-press-paper-overlay)] ' +
        '[--cm-chip-fill:var(--color-chip-fill-paper-overlay)] [--cm-chip-press:var(--color-chip-press-paper-overlay)]',
    inverse:
        'bg-inverse [--cm-surface:var(--color-inverse)] [--cm-press:var(--color-press-inverse)] ' +
        '[--cm-chip-fill:var(--color-chip-fill-inverse)] [--cm-chip-press:var(--color-chip-press-inverse)]',
    muted:
        'bg-surface-muted [--cm-surface:var(--color-surface-muted)] [--cm-press:var(--color-press-muted)] ' +
        '[--cm-chip-fill:var(--color-chip-fill-muted)] [--cm-chip-press:var(--color-chip-press-muted)]',
};

/**
 * The classes a surface of a tone wears. Pure.
 *
 * @param tone - The tone the surface states.
 * @returns The `className` to add to the surface's element.
 */
export function surfaceToneClass(tone: SurfaceTone): string {
    return SURFACE_TONE_CLASS[tone];
}

/**
 * The press fill of a neutral control, by how it is pressed. Every entry reads the surface's `--cm-press` and falls
 * back to the canvas row when no surface states one. The ONE place a press fill is written: a guard
 * (`pressFillRecipe.test.ts`) refuses a hand-written one anywhere else. Literal for the same reason as the tones.
 *
 *  - `pointer`: a fine-pointer hover and a press (Tailwind's `hover:` already applies only under `(hover: hover)`);
 *  - `highlighted`: a Radix menu or listbox item under the keyboard or pointer (`data-[highlighted]`);
 *  - `focused`: a row that fills while it holds keyboard focus (`focus-visible`), beside `pointer`;
 *  - `chip`: a chip, which rests on its own fill (`--cm-chip-fill`) and so presses to that fill's row.
 */
export const PRESS_FILL_CLASS = {
    pointer: 'hover:bg-(--cm-press,var(--color-press-canvas)) active:bg-(--cm-press,var(--color-press-canvas))',
    highlighted: 'data-[highlighted]:bg-(--cm-press,var(--color-press-canvas))',
    focused: 'focus-visible:bg-(--cm-press,var(--color-press-canvas))',
    chip: 'hover:bg-(--cm-chip-press,var(--color-press-muted)) active:bg-(--cm-chip-press,var(--color-press-muted))',
} as const;

/** What a chip rests on: the surface's chip fill, falling back to the canvas row's (`surfaceMuted`). */
export const CHIP_REST_FILL_CLASS = 'bg-(--cm-chip-fill,var(--color-surface-muted))';
