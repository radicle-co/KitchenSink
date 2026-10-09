/**
 * @module home/chrome/chromeGlyphs — the meaning each web chrome control draws that is not a destination.
 *
 * A meaning from `@commise/ui/icon` per control; the `Icon` primitive owns the glyph and the drawing (the shell's
 * hand-drawn SVG set retired in slice 2 of the overhaul). The destinations' glyphs are the shared nav model's own
 * (`NAV_ITEM_GLYPH`, `@commise/features-core`), read by both apps. Slice 3 replaces this shell.
 *
 * @pattern Registry — a table keyed by the control ids
 */
import type { IconName } from '@commise/ui/icon';

/** The top bar's and the sidebar's own controls. */
export const CONTROL_GLYPH = {
    search: 'search',
    notifications: 'bell',
    menu: 'menu',
    collapse: 'chevronsLeft',
    profile: 'user',
} as const satisfies Readonly<Record<string, IconName>>;
