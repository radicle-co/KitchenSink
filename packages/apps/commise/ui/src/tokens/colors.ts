/**
 * The brand palette: storm-ocean steel on a cool, mist-grey base (the redesign, workshop 5 round 9).
 *
 * ## Rules that govern every colour here, MEASURED rather than a matter of taste
 *
 * Every pair a component paints is declared and measured against WCAG 2.2 AA in
 * `__tests__/redesignContrast.test.ts` (4.5:1 for text, SC 1.4.3; 3:1 for large text, component edges and graphics,
 * SC 1.4.11), in both themes; the values are pinned to the design session's sources in `__tests__/redesignPin.test.ts`.
 * The ratios are NOT restated here: a number in a comment is a second copy that goes stale when a tier moves.
 *
 * Three rules the tests cannot state for you:
 *
 *  1. **A tier is a FILL or it is TEXT, and a tier that is both has a darker text sibling.** `error` fills a
 *     destructive control under a light label and `error-dark` is the red a reader reads; `warning` is the caution
 *     fill and `warning-dark` its text. `steel` is both a fill and, on the cool canvas, text and an edge.
 *  2. **Steel is an ACCENT, never a large fill.** A filled `action` is for buttons, the floating action button, the
 *     selected segment, checked boxes and the current step number. A large selected area (a row, a tile, a
 *     panel) uses `selectedFill`, never `action`.
 *  3. **`mist` is a hairline tone, never text**, and an ALPHA-tinted text colour is not a text colour: the token
 *     passes while the rendered pixel does not. A dimmed label uses the opaque muted role.
 *
 * ## Names
 *
 * `steel`, `steel-light` and `fog` were `seafoam`, `seafoam-light` and `sand` before the redesign; a key that still
 * said teal or sand would mislead the next reader, so they were renamed with every consumer (`bg-steel`,
 * `from-steel`, `palette['steel-light']` ...). `honey` (the amber star) and `premium` (the PRO tan) are gone: the
 * redesign made each a copy of another entry (`charcoal`, `slate`), and a duplicate that keeps a stale name is a trap.
 * Two more keys were renamed to say what they are: `coral` (a pale cream, not a coral) is `cream`, and `white` (the
 * card colour, a hair off pure white) is `cloud`, so Tailwind's own `white` stays pure #FFFFFF and `snow` is the pure
 * white we name.
 * `__tests__/redesignRetired.test.ts` fails if a retired value comes back.
 */
export const palette = {
    steel: '#325C7F',
    'steel-light': '#96BCDE',
    // The pale cream and pale blue are fills under `charcoal`, and the cover tints of the same names.
    cream: '#F7E9D7',
    sky: '#DDEEFC',
    // The page. A mist-grey, cool: the redesign's canvas.
    fog: '#EFF3F6',
    // The pressed end of the steel fill and the dark stop of the brand gradient.
    'ocean-dark': '#264A68',
    charcoal: '#171B20',
    slate: '#5C646E',
    mist: '#DFE3E8',
    pearl: '#E9EDF2',
    // The card surface: a hair off pure white so it does not glare on the cool canvas. Not called `white`: that key
    // would emit `--color-white` and repaint Tailwind's own pure `white` (#FFFFFF).
    cloud: '#FCFDFF',
    // Pure white: raised and overlay surfaces and the label on a filled control.
    snow: '#FFFFFF',
    success: '#4CAF7C',
    // The caution FILL, under a charcoal label. NOT a text colour: see `warning-dark`.
    warning: '#F5B041',
    // The caution FOREGROUND: the same amber, darker, measured against the surface beneath it.
    'warning-dark': '#8C5A00',
    // The destructive FILL, under a light label. NOT a text colour: see `error-dark`.
    error: '#C05238',
    // The destructive FOREGROUND: the same red, one lightness step darker, for text on a light surface.
    'error-dark': '#A53E27',
    // The control EDGE (`lineControl`): input, unselected chip, checkbox and secondary-button outlines.
    pewter: '#80878F',
} as const;

// Each nutrition series gets a DISTINCT hue (B25a), and each reaches 3:1 against `paper` in its theme (SC 1.4.11) so a
// bar or a line is seen without relying on a neighbour. Colour is never the only key (SC 1.4.1): a chart labels its
// series directly. No teal. These are the designer's literals, not palette tiers: a series is data, not brand.
export const chart = {
    calories: '#325C7F',
    protein: '#B07000',
    carbs: '#3A8A4F',
    fat: '#C0506E',
    fiber: '#7A5AA6',
} as const;

/** The nutrition series on the dark `paper`, each at least 3:1 against it. */
export const chartDark = {
    calories: '#96BCDE',
    protein: '#E3A43A',
    carbs: '#6CBF86',
    fat: '#EC8EA4',
    fiber: '#B9A2E6',
} as const satisfies Record<keyof typeof chart, string>;

/** Matches an opaque 6-digit hex colour — the only form {@link tint} can decompose into channels. */
const OPAQUE_HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * A palette colour at an alpha, as the `rgba(r, g, b, a)` string React Native understands.
 *
 * React Native has no alpha-suffix colour syntax (the web's `bg-steel/10`), so a native leaf that wants a tinted
 * chip has to spell one out. Every hand-written `rgba(...)` literal is a SECOND representation of a palette colour
 * that no longer moves when the token does, and this repo shipped that failure: literals frozen at an old tier of
 * the palette, and one colour that was never in the palette at all, painted on three screens. Spelling a tint out in
 * decimal is exactly what makes such a colour unsearchable (`__tests__/redesignRetired.test.ts` now searches).
 *
 * The emitted spacing matches what `getComputedStyle` reports, so a native contrast test can compare a
 * rendered background against `tint(...)` directly.
 *
 * @param color - An opaque `#RRGGBB` palette colour.
 * @param alpha - The tint's alpha, 0..1.
 * @returns The colour as `rgba(r, g, b, a)`.
 * @throws Error when `color` is not an opaque hex colour — a tint of a tint has no single backdrop, so it
 *   cannot be composited or measured.
 * @throws Error when `alpha` is outside 0..1. A percentage passed by mistake (`10` for 10%) would otherwise
 *   clamp to a fully OPAQUE fill, which is both invisible in review and unmeasurable.
 */
export function tint(color: string, alpha: number): string {
    const match = OPAQUE_HEX.exec(color);

    if (match === null) {
        throw new Error(`tint expects an opaque #RRGGBB palette colour, received "${color}".`);
    }

    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
        throw new Error(`tint expects an alpha in 0..1, received ${alpha}.`);
    }

    const [red, green, blue] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part as string, 16));

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * The colour ROLES (`docs/design/uiOverhaul/buildSpec.md` §1.4). A screen names a role — what the colour is FOR —
 * and never a palette tier, so a re-theme moves one line here instead of every call site.
 *
 * Each role points at a palette entry, except the fills that are derived or a designer's literal and say so:
 *  - `selectedFill` is a pale steel wash, written as the opaque result because a chip is filled over many surfaces
 *    and must read the same on each.
 *  - `attentionTint` is 20% `warning`, kept translucent, under an `ink` or an `attention` label.
 *  - `photoChip` and `scrim` are translucent over a photo, so they are `tint()` of the colour they are made from.
 *
 * ⚠️ Additions are expand-contract (A19): do not repurpose an existing key; a key that changes meaning breaks its
 * readers silently.
 *
 * The contrast of every pairing is asserted in `__tests__/redesignContrast.test.ts`.
 *
 * @pattern Registry — a closed set of role names over the palette; the web emission (`themeCss.ts`) and native read
 *   the same record
 */
export const role = {
    canvas: palette.fog,
    paper: palette.cloud,
    ink: palette.charcoal,
    inkMuted: palette.slate,
    lineControl: palette.pewter,
    lineDivider: palette.mist,
    action: palette.steel,
    actionText: palette.steel,
    selectedFill: '#E4EEF7',
    selectedEdge: palette.steel,
    hereBar: palette.steel,
    focusRing: palette.steel,
    // Stars are ink, never an amber (redesign).
    rating: palette.charcoal,
    attention: palette['warning-dark'],
    attentionTint: tint(palette.warning, 0.2),
    danger: palette.error,
    dangerText: palette['error-dark'],
    paperRaised: palette.snow,
    paperOverlay: palette.snow,
    surfaceMuted: palette.pearl,
    inverse: palette.charcoal,
    inverseInk: palette.snow,
    inverseAction: palette['steel-light'],
    photoChip: tint(palette.cloud, 0.94),
    scrim: tint('#0A1018', 0.42),
    // The label on the `action` and `danger` fills. Named here so that nothing reads a palette white directly.
    onAction: palette.snow,
    // The `action` fill under a press or a fine-pointer hover.
    actionPressed: palette['ocean-dark'],
    // The `danger` fill under a press or a fine-pointer hover (white label 6.36:1; a visible step from `danger`).
    dangerPressed: '#A33F2A',
} as const;

/** A colour role's name. */
export type Role = keyof typeof role;

/**
 * Every role's value in the DARK theme (dusk: a deep blue-black with steel-light for the accent), beside {@link role}
 * so that the two cannot drift. Typed `Record<Role, string>`: a role added to `role` without a dark value here does
 * not compile. Web emits these as a `prefers-color-scheme: dark` override of the same custom properties
 * (`themeCss.ts`); native reads them through `useTheme()`. The values are the designer's; none is derived here.
 */
export const roleDark: Readonly<Record<Role, string>> = {
    canvas: '#0E161E',
    paper: '#172029',
    paperRaised: '#212B36',
    paperOverlay: '#26313D',
    surfaceMuted: '#212B36',
    ink: '#EBEFF2',
    inkMuted: '#A3ACB6',
    lineControl: '#7D8792',
    lineDivider: '#262F38',
    action: palette['steel-light'],
    actionText: palette['steel-light'],
    // The label on a filled action is the canvas-dark ink: it is the label on the light steel-light fill.
    onAction: '#0E161E',
    actionPressed: '#B4CFE8',
    // Darker than the dark `danger` fill, so the near-black `onAction` label holds 4.99:1 on it.
    dangerPressed: '#CC6A52',
    selectedFill: '#1F3548',
    selectedEdge: palette['steel-light'],
    hereBar: palette['steel-light'],
    focusRing: palette['steel-light'],
    rating: '#EBEFF2',
    attention: '#EFBA64',
    attentionTint: tint(palette.warning, 0.2),
    // The dark theme's destructive fill is LIGHTER than the light one, so the dark `onAction` label (near-black) clears
    // the text floor on it. It is not a palette entry: the light `error` fill carries a light label.
    danger: '#E07A60',
    dangerText: '#EC8E76',
    inverse: '#EBEFF2',
    inverseInk: palette.charcoal,
    inverseAction: palette.steel,
    photoChip: tint('#172029', 0.86),
    scrim: tint('#000000', 0.66),
};

/**
 * The legacy shadcn-style names (`bg-background`, `text-foreground`, `border-border` ...) as the roles they follow,
 * so a utility written in either vocabulary paints the same colour. One mapping, applied to both themes.
 */
const SEMANTIC_ROLES = {
    background: 'canvas',
    foreground: 'ink',
    card: 'paper',
    primary: 'action',
    secondary: 'surfaceMuted',
    muted: 'surfaceMuted',
    accent: 'selectedFill',
    destructive: 'danger',
    border: 'lineDivider',
    ring: 'focusRing',
} as const satisfies Record<string, Role>;

/** The semantic names resolved in one theme. Pure. */
function semanticIn(theme: Readonly<Record<Role, string>>): { readonly [K in keyof typeof SEMANTIC_ROLES]: string } {
    return Object.fromEntries(Object.entries(SEMANTIC_ROLES).map(([name, roleName]) => [name, theme[roleName]])) as {
        readonly [K in keyof typeof SEMANTIC_ROLES]: string;
    };
}

export const semantic = semanticIn(role);

/** The semantic names in the dark theme, emitted as the dark block's override of the same properties. */
export const semanticDark = semanticIn(roleDark);

export type Palette = typeof palette;
export type Semantic = typeof semantic;
export type Chart = typeof chart;
export type ChartDark = typeof chartDark;
