/**
 * @module @commise/ui/icon — the shared contract of the design-system `Icon`: the closed list of meanings a screen may
 * draw, the ones that mirror in right-to-left, and the props both platform leaves implement.
 *
 * A screen names a MEANING (`trash`), never a glyph (`trash-2`) and never a library: "one glyph list, no screen picks
 * its own glyph" (`docs/design/uiOverhaul/buildSpec.md` §1.7). Each leaf maps every meaning to a Lucide glyph in its
 * own table (`glyphs.ts`, `glyphs.native.ts`), because the two packages cannot be imported from one module.
 *
 * ⚠️ The spec's §1.7 table and the blueprint's slice-2 list name 30 meanings. The rest below are the meanings the apps
 * already drew with Feather and hand-drawn SVGs when slice 2 moved them onto this Registry. Each keeps the glyph it had
 * (Lucide is the Feather lineage, so most names are unchanged), and each is an implementer's choice that
 * `staff-ux-engineer` has not yet reviewed. `bell`, `chartColumn` and `menu` serve navigation that slice 3 deletes.
 */
import type { Role } from '../tokens/colors.js';

/** Every meaning the Registry can draw. */
export const ICON_NAMES = [
    // Spec §1.7 and the blueprint's slice-2 list.
    'house',
    'bookOpen',
    'compass',
    'plus',
    'clipboardPaste',
    'ellipsis',
    'chevronLeft',
    'x',
    'search',
    'copyPlus',
    'trash',
    'clock',
    'users',
    'flame',
    'star',
    'lock',
    'globe',
    'pencilLine',
    'timer',
    'sun',
    'check',
    'arrowUp',
    'imagePlus',
    'listPlus',
    'chevronsLeft',
    'slidersHorizontal',
    'rotateCcw',
    'chevronDown',
    'eye',
    'user',
    // Meanings the apps already drew, moved onto the Registry in slice 2 (see the module note).
    'minus',
    'chevronRight',
    'chevronUp',
    'refreshCw',
    'logIn',
    'logOut',
    'userPlus',
    'userX',
    'save',
    'settings',
    'camera',
    'image',
    'triangleAlert',
    'info',
    'calendar',
    'shoppingCart',
    'chartColumn',
    'bell',
    'menu',
    // The library's list/grid switch (slice 4, `buildSpec.md` §4.3).
    'list',
    'layoutGrid',
] as const;

/** A meaning the Registry can draw. */
export type IconName = (typeof ICON_NAMES)[number];

/**
 * The meanings whose glyph points left or right, and so is drawn mirrored in a right-to-left layout. The clock, the
 * timer and numerals never mirror (spec §2.2).
 */
export const MIRROR_IN_RTL: ReadonlySet<IconName> = new Set<IconName>(['chevronLeft', 'chevronRight', 'chevronsLeft']);

/**
 * The glyph sizes: 20 inline beside 14–16 px text, 24 for an icon button or a tab (§1.7), 16 inside a chip (§1.10), and
 * 48 for an empty state's glyph (§8, "a 48 px `clock` glyph"; not in the blueprint's list, which missed it).
 */
export type IconSize = 16 | 20 | 24 | 48;

/** The cross-platform `Icon` contract shared by the web and native leaves. */
export interface IconProps {
    /** The meaning to draw. */
    readonly name: IconName;
    /** The glyph size in px (web) or points (native). Defaults to 24. */
    readonly size?: IconSize;
    /**
     * The colour role to draw in. On web the glyph inherits its text's colour when this is absent; a native glyph
     * inherits nothing, so the native leaf draws in `ink` when it is absent.
     */
    readonly tone?: Role;
    /** Fill the glyph with its own colour. Only the active tab is filled, always with its label weight and bar (§1.7). */
    readonly filled?: boolean;
    /**
     * The glyph's accessible name. Absent, the glyph is decorative and hidden from assistive tech, which is right
     * whenever the control it sits in already has a name (almost always).
     */
    readonly label?: string;
}
