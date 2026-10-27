/**
 * @module @commise/ui/surface-tone — the surface-tone table (`componentFixes.md` §10, §10a): a surface states itself
 * once, and every control on it reads that statement. This module is the ONE table. Web paints it as inheriting custom
 * properties (`surfaceToneClass.ts`); native paints it through a React context (`surfaceToneContext.ts`). Both read the
 * rows here, so a control cannot press to one colour on web and another on a phone.
 *
 * A tone names two colour ROLES (D15), so each re-themes through the dark block with no per-site work:
 *  - `fill`: what the surface paints, and the colour of the focus ring's gap around a control on it;
 *  - `chipFill`: what a chip rests on there, PER THEME. Paper on a muted surface, because a muted chip on a muted card
 *    would be invisible; `surfaceMuted` on every other (§10a), except that on `paperRaised` it is `paper` in dark, where
 *    `paperRaised` IS `surfaceMuted` (#212B36) and a `surfaceMuted` chip would vanish (§10b).
 *
 * The PRESS is not stored: it is the fill with the theme's ink laid over it ({@link pressFillsOf}), so it cannot drift
 * from the fill it presses. A chip's press is the press of the surface whose fill the chip rests on
 * ({@link chipPressToneOf}). The press is not a colour ROLE (a designer does not choose it), so it is not in the role
 * record the design artifact documents; web gets it as `--color-press-<tone>` custom properties (`themeCss.ts`) and
 * native as `Theme.press`.
 *
 * `floating` (a control over a photo or over scrolling content) is NOT a row: it has no single surface and nothing is
 * read from context, so its two-tone ring is a recipe of its own (`focusRing/focusRingClass.ts`). `inverse` IS a row since
 * the design session's §10b ruling (the Undo snackbar puts an action on it); it rings flush in `inverseAction`
 * (`FOCUS_RING_CLASS.inverse`) because it has no gap to colour.
 *
 * @pattern Policy — one pure table of which role a surface paints, presses and rests a chip on
 */
import { mixOver, type Role } from '../tokens/colors.js';
import { kebab } from '../tokens/emit.js';

/** The surfaces a control can sit on. `canvas` is the page, and what a control reads outside every surface. */
export type SurfaceTone = 'canvas' | 'paper' | 'paperRaised' | 'paperOverlay' | 'muted' | 'inverse';

/** What one surface paints, and the roles a control on it reads. */
export interface SurfaceToneRow {
    /** The surface's own fill; also the focus ring's gap. */
    readonly fill: Role;
    /** The ink laid over the fill to make its press: the page's `ink`, or the surface's own on an inverse one. */
    readonly ink: Role;
    /** What a chip rests on there, in each theme. Read through {@link chipFillRoleOf}. */
    readonly chipFill: Readonly<Record<PressScheme, Role>>;
}

/** The tone a control reads when no surface states one: the page. */
export const DEFAULT_SURFACE_TONE: SurfaceTone = 'canvas';

/** A chip on `surfaceMuted` in both themes: the resting fill of every tone but `muted` and `paperRaised`. */
const REST_ON_MUTED: Readonly<Record<PressScheme, Role>> = { light: 'surfaceMuted', dark: 'surfaceMuted' };

/** Every tone's row. Typed over the union, so a tone added without a row does not compile. */
export const SURFACE_TONES: Readonly<Record<SurfaceTone, SurfaceToneRow>> = {
    canvas: { fill: 'canvas', ink: 'ink', chipFill: REST_ON_MUTED },
    paper: { fill: 'paper', ink: 'ink', chipFill: REST_ON_MUTED },
    paperRaised: { fill: 'paperRaised', ink: 'ink', chipFill: { light: 'surfaceMuted', dark: 'paper' } },
    paperOverlay: { fill: 'paperOverlay', ink: 'ink', chipFill: { light: 'surfaceMuted', dark: 'paper' } },
    muted: { fill: 'surfaceMuted', ink: 'ink', chipFill: { light: 'paper', dark: 'paper' } },
    // `inverse` presses with `inverseInk`: the page ink is the same colour as the fill there and would show nothing
    // (`componentFixes.md` §10b). Nothing rests a chip on it; the entry keeps the table total.
    inverse: { fill: 'inverse', ink: 'inverseInk', chipFill: REST_ON_MUTED },
};

/** The tones, in table order. */
export const SURFACE_TONE_NAMES: readonly SurfaceTone[] = [
    'canvas',
    'paper',
    'paperRaised',
    'paperOverlay',
    'muted',
    'inverse',
];

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
            mixOver(colors[SURFACE_TONES[tone].ink], colors[SURFACE_TONES[tone].fill], PRESS_INK_ALPHA[scheme]),
        ]),
    ) as Record<SurfaceTone, string>;
}

/**
 * The role a chip rests on over `tone` in one theme. Pure.
 *
 * @param tone - The surface the chip sits on.
 * @param scheme - Which theme.
 * @returns The chip's resting fill role.
 */
export function chipFillRoleOf(tone: SurfaceTone, scheme: PressScheme): Role {
    return SURFACE_TONES[tone].chipFill[scheme];
}

/**
 * The surface a chip's press follows: the one whose fill IS the chip's resting fill on `tone` in `scheme`, found in the
 * table rather than stored beside it, so a chip's press cannot disagree with the surface it rests on. Pure.
 *
 * @param tone - The surface the chip sits on.
 * @param scheme - Which theme.
 * @returns The tone whose press the chip takes.
 * @throws Error when no surface paints the chip's resting fill (the table was edited into an inconsistent state).
 */
export function chipPressToneOf(tone: SurfaceTone, scheme: PressScheme): SurfaceTone {
    const resting = chipFillRoleOf(tone, scheme);
    const surface = SURFACE_TONE_NAMES.find((name) => SURFACE_TONES[name].fill === resting);

    if (surface === undefined) {
        throw new Error(`No surface paints ${resting}, the fill a chip rests on over "${tone}" in ${scheme}.`);
    }

    return surface;
}

/** The custom property a tone's press fill is emitted under (`themeCss.ts`): `--color-press-paper-overlay`. */
export function pressVarOf(tone: SurfaceTone): string {
    return `--color-press-${kebab(tone)}`;
}

/** The custom property a tone's chip fill is emitted under (`themeCss.ts`): `--color-chip-fill-paper-raised`. */
export function chipFillVarOf(tone: SurfaceTone): string {
    return `--color-chip-fill-${kebab(tone)}`;
}

/** The custom property a tone's chip press fill is emitted under (`themeCss.ts`): `--color-chip-press-paper-raised`. */
export function chipPressVarOf(tone: SurfaceTone): string {
    return `--color-chip-press-${kebab(tone)}`;
}
