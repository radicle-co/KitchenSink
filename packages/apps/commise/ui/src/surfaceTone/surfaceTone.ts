/**
 * @module @commise/ui/surface-tone — the surface-tone table (`componentFixes.md` §10, §10a): a surface states itself
 * once, and every control on it reads that statement. This module is the ONE table. Web paints it as inheriting custom
 * properties (`surfaceToneClass.ts`); native paints it through a React context (`surfaceToneContext.ts`). Both read the
 * rows here, so a control cannot press to one colour on web and another on a phone.
 *
 * A tone names two colour ROLES (D15), so each re-themes through the dark block with no per-site work:
 *  - `fill`: what the surface paints, and the colour of the focus ring's gap around a control on it;
 *  - `chipFill`: what a chip rests on there. Paper on a muted surface, because a muted chip on a muted card would be
 *    invisible; `surfaceMuted` on every other (§10a).
 *
 * The PRESS is not stored: it is the fill with the theme's ink laid over it ({@link pressFillsOf}), so it cannot drift
 * from the fill it presses. A chip's press is the press of the surface whose fill the chip rests on
 * ({@link chipPressToneOf}). The press is not a colour ROLE (a designer does not choose it), so it is not in the role
 * record the design artifact documents; web gets it as `--color-press-<tone>` custom properties (`themeCss.ts`) and
 * native as `Theme.press`.
 *
 * `floating` (a control over a photo or over scrolling content) is NOT a row: it has no single surface and nothing is
 * read from context, so its two-tone ring is a recipe of its own (`focusRing/focusRingClass.ts`). `inverse` is not a
 * row either: no control sits on an inverse surface through the shared controls, and its "wash" is undefined in §10.
 *
 * @pattern Policy — one pure table of which role a surface paints, presses and rests a chip on
 */
import { mixOver, type Role } from '../tokens/colors.js';
import { kebab } from '../tokens/emit.js';

/** The surfaces a control can sit on. `canvas` is the page, and what a control reads outside every surface. */
export type SurfaceTone = 'canvas' | 'paper' | 'paperOverlay' | 'muted';

/** What one surface paints, and the roles a control on it reads. */
export interface SurfaceToneRow {
    /** The surface's own fill; also the focus ring's gap. */
    readonly fill: Role;
    /** What a chip rests on there. */
    readonly chipFill: Role;
}

/** The tone a control reads when no surface states one: the page. */
export const DEFAULT_SURFACE_TONE: SurfaceTone = 'canvas';

/** Every tone's row. Typed over the union, so a tone added without a row does not compile. */
export const SURFACE_TONES: Readonly<Record<SurfaceTone, SurfaceToneRow>> = {
    canvas: { fill: 'canvas', chipFill: 'surfaceMuted' },
    paper: { fill: 'paper', chipFill: 'surfaceMuted' },
    paperOverlay: { fill: 'paperOverlay', chipFill: 'surfaceMuted' },
    muted: { fill: 'surfaceMuted', chipFill: 'paper' },
};

/** The tones, in table order. */
export const SURFACE_TONE_NAMES: readonly SurfaceTone[] = ['canvas', 'paper', 'paperOverlay', 'muted'];

/** The inheriting custom property a web surface sets to its own fill; the focus-ring gap reads it. */
export const SURFACE_VAR = '--cm-surface';

/** The inheriting custom property a web surface sets to its press fill. */
export const PRESS_VAR = '--cm-press';

/** The inheriting custom property a web surface sets to the fill a chip rests on there. */
export const CHIP_FILL_VAR = '--cm-chip-fill';

/** The inheriting custom property a web surface sets to the press fill of a chip resting there. */
export const CHIP_PRESS_VAR = '--cm-chip-press';

/**
 * How much ink a press lays over its surface (`componentFixes.md` §10a): Material 3's pressed state layer. Light ink is
 * the dark charcoal at 10%; the dark theme lays its light ink at 12%, because ink on a dark surface needs more weight
 * to clear the same 1.2:1 floor. The only place either number is written.
 */
export const PRESS_INK_ALPHA = { light: 0.1, dark: 0.12 } as const;

/** A colour scheme's name, as the press alpha is keyed. */
export type PressScheme = keyof typeof PRESS_INK_ALPHA;

/**
 * Each surface's press fill in one theme: the surface's fill with the theme's `ink` laid over it. Pure.
 *
 * @param colors - The theme's role colours (`role` or `roleDark`).
 * @param scheme - Which theme, which decides the ink's share.
 * @returns One opaque `#rrggbb` per tone.
 */
export function pressFillsOf(
    colors: Readonly<Record<Role, string>>,
    scheme: PressScheme,
): Readonly<Record<SurfaceTone, string>> {
    return Object.fromEntries(
        SURFACE_TONE_NAMES.map((tone) => [
            tone,
            mixOver(colors.ink, colors[SURFACE_TONES[tone].fill], PRESS_INK_ALPHA[scheme]),
        ]),
    ) as Record<SurfaceTone, string>;
}

/**
 * The surface a chip's press follows: the one whose fill IS the chip's resting fill on `tone`, found in the table
 * rather than stored beside it, so a chip's press cannot disagree with the surface it rests on. Pure.
 *
 * @param tone - The surface the chip sits on.
 * @returns The tone whose press the chip takes.
 * @throws Error when no surface paints the chip's resting fill (the table was edited into an inconsistent state).
 */
export function chipPressToneOf(tone: SurfaceTone): SurfaceTone {
    const resting = SURFACE_TONES[tone].chipFill;
    const surface = SURFACE_TONE_NAMES.find((name) => SURFACE_TONES[name].fill === resting);

    if (surface === undefined) {
        throw new Error(`No surface paints ${resting}, the fill a chip rests on over "${tone}".`);
    }

    return surface;
}

/** The custom property a tone's press fill is emitted under (`themeCss.ts`): `--color-press-paper-overlay`. */
export function pressVarOf(tone: SurfaceTone): string {
    return `--color-press-${kebab(tone)}`;
}
