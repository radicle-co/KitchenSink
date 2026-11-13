/**
 * @module @commise/ui/check-box-glyph — the shared contract of the design-system `CheckBoxGlyph`: the drawn box of a
 * whole-row checkbox (`docs/design/uiOverhaul/buildSpec.md` §6.3). The row is the control and carries the role, the
 * checked state and the name; the glyph only draws it, and carries the one signature motion (§1.9).
 *
 * The box follows the text it labels: its size comes from the row text's type role ({@link checkBoxSideOf}), and both
 * leaves centre it on that text's FIRST line, so a wrapped row keeps its box beside the line it starts.
 *
 * @pattern Policy — one pure rule for the box's size, read by both leaves
 */
import { grownScale } from '../text/scaledType.js';
import { typeRole, type TypeRole } from '../tokens/typography.js';

/**
 * The corner of the 18 px box, in px (owner decisions C5/T1: a rounded square, never the 8 px step, which reads as a
 * radio). The radius scale has no step this small and gets none: the glyph owns its corner here, and
 * `offScaleRadius.test.ts` lets only a module whose `@pattern` names it a Glyph read a `GLYPH_` constant. A larger box
 * keeps the same proportion, 4/18 of its side. Web and native both read it.
 */
export const GLYPH_CORNER = 4;

/** The box's side at 1x beside body-sized text, and the floor no role draws it under. */
export const CHECK_BOX_MIN_SIDE = 18;

/** The corner as a share of the side: 4 of 18. A box of any size keeps today's proportion with `side * this`. */
export const GLYPH_CORNER_PER_SIDE = GLYPH_CORNER / CHECK_BOX_MIN_SIDE;

/** The same share as a CSS percentage, for the web box, whose side is in `rem`. */
export const GLYPH_CORNER_PERCENT = `${String(GLYPH_CORNER_PER_SIDE * 100)}%`;

/** The scale the check springs in from (§1.9: 0.9 to 1 with a small overshoot). */
export const CHECK_MARK_FROM_SCALE = 0.9;

/** The named spring of the one signature motion, registered in the native Tamagui config. */
export const CHECK_MARK_ANIMATION = 'check';

/** How the native check mark enters: the named spring from 0.9 of its size, or nothing at all. */
export type CheckMarkMotion =
    | { readonly animation: typeof CHECK_MARK_ANIMATION; readonly enterStyle: { readonly scale: number } }
    | Record<string, never>;

/**
 * How the native check mark enters. Only when the OS has said motion is allowed does it spring in from 0.9; under
 * reduced motion, and while the preference is still being read, it appears at once. Pure.
 *
 * @param reduceMotion - The OS preference (`useReduceMotion`): `true`, `false`, or `undefined` while it is being read.
 * @param scale - The mark's resting scale, so the spring starts from 0.9 of the size it lands on.
 * @returns The Tamagui props to spread on the mark.
 */
export function checkMarkMotion(reduceMotion: boolean | undefined, scale: number): CheckMarkMotion {
    return reduceMotion === false
        ? { animation: CHECK_MARK_ANIMATION, enterStyle: { scale: CHECK_MARK_FROM_SCALE * scale } }
        : {};
}

/** The check's side as a share of the box: 16 of 18, today's drawing. */
export const CHECK_MARK_SHARE = 16 / 18;

/** A role the row text can take: every sized role (`figureInline` takes its line's size and has none of its own). */
export type CheckBoxTextRole = Exclude<TypeRole, 'figureInline'>;

/** The role the box labels when the caller names none. */
export const DEFAULT_CHECK_BOX_TEXT_ROLE: CheckBoxTextRole = 'body';

/**
 * The box's side at 1x beside a role: `max(18, round_even(roleSize × 0.8))`. So 14, 16 and 18 px text keep the 18 px box,
 * and 28 px text gets 22. Pure.
 *
 * @param role - The row text's type role. Defaults to `body`.
 * @returns The side in px (web) or points (native), before any text scaling.
 */
export function checkBoxSideOf(role: CheckBoxTextRole = DEFAULT_CHECK_BOX_TEXT_ROLE): number {
    const { size } = typeRole[role];
    const px = typeof size === 'number' ? size : size.regular;

    return Math.max(CHECK_BOX_MIN_SIDE, 2 * Math.round((px * 0.8) / 2));
}

/**
 * The box's native side under the system text scale: its 1x side times its role's own growth (`grownScale`), so it
 * never outgrows that text's cap. The native leaf draws this, and a row that places anything past the box reads it too.
 * Pure.
 *
 * @param role - The row text's type role.
 * @param textScale - The system text scale (`fontScale`).
 * @returns The side in points.
 */
export function checkBoxSideAt(role: CheckBoxTextRole, textScale: number): number {
    return checkBoxSideOf(role) * grownScale(role, textScale);
}

/** Props for the `CheckBoxGlyph` leaves (web and native). */
export interface CheckBoxGlyphProps {
    /** Whether the row is checked: the box fills and the check springs in. */
    readonly checked: boolean;
    /**
     * The type role of the row text the box sits beside. It sets the box's size and the line the box is centred on.
     * Defaults to `body`.
     */
    readonly textRole?: CheckBoxTextRole;
}
