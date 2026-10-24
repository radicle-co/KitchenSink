import { kebab, pxToRemUnit } from './emit.js';
import { containerThreshold, type PerContainerClass } from './layout.js';
import { fontFamily, fontSize, fontWeight, lineHeightRatio } from './scale.js';

/** Web font families — the shared stacks from the single source. */
export const fonts = fontFamily;

/**
 * Web font sizes — `rem` derived from the single numeric source (`scale.fontSize`, px ÷16). Keys stay in
 * the web's kebab-case (`display-xl` …) convention; the ramp order is largest → smallest.
 */
export const fontSizes = {
    'display-xl': pxToRemUnit(fontSize.displayXl),
    'display-lg': pxToRemUnit(fontSize.displayLg),
    'display-md': pxToRemUnit(fontSize.displayMd),
    'heading-lg': pxToRemUnit(fontSize.headingLg),
    'heading-md': pxToRemUnit(fontSize.headingMd),
    'heading-sm': pxToRemUnit(fontSize.headingSm),
    'body-lg': pxToRemUnit(fontSize.bodyLg),
    'body-md': pxToRemUnit(fontSize.bodyMd),
    'body-sm': pxToRemUnit(fontSize.bodySm),
    caption: pxToRemUnit(fontSize.caption),
    overline: pxToRemUnit(fontSize.overline),
} as const;

/** Web line-heights — the unitless ratios from the single source, as CSS `line-height` multipliers. */
export const lineHeights = {
    heading: `${lineHeightRatio.heading}`,
    body: `${lineHeightRatio.body}`,
    caption: `${lineHeightRatio.caption}`,
} as const;

/** Web font weights — the numeric weights from the single source, as CSS `font-weight` strings. */
export const fontWeights = {
    normal: `${fontWeight.normal}`,
    medium: `${fontWeight.medium}`,
    semibold: `${fontWeight.semibold}`,
    bold: `${fontWeight.bold}`,
} as const;

export type Fonts = typeof fonts;
export type FontSizes = typeof fontSizes;
export type LineHeights = typeof lineHeights;
export type FontWeights = typeof fontWeights;

/** A type role's name (§1.5). */
export type TypeRole =
    | 'largeTitle'
    | 'barTitle'
    | 'sectionTitle'
    | 'cardTitle'
    | 'body'
    | 'readingBody'
    | 'meta'
    | 'label'
    | 'caption'
    | 'overline'
    | 'figureInline'
    | 'figureStat';

/** One type role: its face, size (px, per container class, or the size of its line), weight step and leading. */
export interface TypeRoleSpec {
    readonly face: 'display' | 'body';
    readonly size: number | PerContainerClass<number> | 'inherit';
    readonly weight: keyof typeof fontWeight;
    readonly lineHeight: number | 'inherit';
    /** Set in tabular, lining digits (`tabular-nums lining-nums`). */
    readonly figure?: true;
    /** Tracking in em. */
    readonly letterSpacingEm?: number;
    readonly uppercase?: true;
}

/**
 * The type roles (`docs/design/uiOverhaul/buildSpec.md` §1.5). A screen names a role, never a size; the ramp above
 * stays for the screens that have not moved yet.
 *
 * - Playfair (`display`) sets names only, and never a number: both figure roles are Inter.
 * - `largeTitle` has one size per container class. Web turns that into a bounded `clamp()` in container units
 *   ({@link webTypeRoles}); native picks the size for its class.
 * - `figureInline` takes the size and leading of the line it sits in, so it has neither of its own.
 * - Choices the spec left open, recorded so they are not re-decided per screen: `meta` is 400 (a 500 meta is a
 *   per-element exception); `figureStat`'s leading is 1.2 (the spec says "as its line", and a stat stands alone).
 */
export const typeRole = {
    largeTitle: { face: 'display', size: { narrow: 28, regular: 34, wide: 40 }, weight: 'bold', lineHeight: 1.15 },
    barTitle: { face: 'body', size: 17, weight: 'semibold', lineHeight: 1.2 },
    sectionTitle: { face: 'body', size: 18, weight: 'semibold', lineHeight: 1.25 },
    cardTitle: { face: 'body', size: 16, weight: 'semibold', lineHeight: 1.3 },
    body: { face: 'body', size: 16, weight: 'normal', lineHeight: 1.5 },
    readingBody: { face: 'body', size: 18, weight: 'normal', lineHeight: 1.6 },
    meta: { face: 'body', size: 14, weight: 'normal', lineHeight: 1.4 },
    label: { face: 'body', size: 14, weight: 'semibold', lineHeight: 1.2 },
    caption: { face: 'body', size: 12, weight: 'medium', lineHeight: 1.4 },
    overline: {
        face: 'body',
        size: 11,
        weight: 'semibold',
        lineHeight: 1.4,
        letterSpacingEm: 0.06,
        uppercase: true,
    },
    figureInline: { face: 'body', size: 'inherit', weight: 'semibold', lineHeight: 'inherit', figure: true },
    figureStat: { face: 'body', size: 20, weight: 'semibold', lineHeight: 1.2, figure: true },
} as const satisfies Record<TypeRole, TypeRoleSpec>;

/** A type role as Tailwind's `--text-{role}` and its sub-properties. */
export interface WebTypeRole {
    readonly size: string;
    readonly lineHeight: string;
    readonly fontWeight: string;
    readonly letterSpacing?: string;
}

/** Four decimals: enough for a sub-pixel at any width, short enough to read in the stylesheet. */
function round4(value: number): number {
    return Number(value.toFixed(4));
}

/**
 * A per-class size as `clamp(narrow, base + slope·cqi, wide)`: the line through the regular size at the regular
 * threshold and the wide size at the wide threshold, floored at the narrow size. Container units, never `vw`, so the
 * size follows `<main>` rather than the window. Pure.
 */
function containerClamp(size: PerContainerClass<number>): string {
    const slope = (size.wide - size.regular) / (containerThreshold.wide - containerThreshold.regular);
    const base = size.regular - slope * containerThreshold.regular;

    const preferred = `${round4(base / 16)}rem + ${round4(slope * 100)}cqi`;

    return `clamp(${pxToRemUnit(size.narrow)}, ${preferred}, ${pxToRemUnit(size.wide)})`;
}

/** Project one role to its web form, or `undefined` for a role with no size of its own. Pure. */
function toWebTypeRole(spec: TypeRoleSpec): WebTypeRole | undefined {
    if (spec.size === 'inherit' || spec.lineHeight === 'inherit') {
        return undefined;
    }

    const size = typeof spec.size === 'number' ? pxToRemUnit(spec.size) : containerClamp(spec.size);

    return {
        size,
        lineHeight: `${spec.lineHeight}`,
        fontWeight: `${fontWeight[spec.weight]}`,
        ...(spec.letterSpacingEm === undefined ? {} : { letterSpacing: `${spec.letterSpacingEm}em` }),
    };
}

/**
 * The web projection of {@link typeRole}, keyed by kebab-case role name: what `themeCss.ts` emits as
 * `--text-{role}`, `--text-{role}--line-height`, `--text-{role}--font-weight` and `--text-{role}--letter-spacing`.
 *
 * Tailwind's `--text-*` carries no family and no case, so a display role also takes `font-display`, the overline
 * `uppercase`, and a figure `tabular-nums lining-nums`. `figureInline` has no entry: it is those two utilities on
 * whatever line it sits in.
 */
export const webTypeRoles: Readonly<Record<string, WebTypeRole>> = Object.fromEntries(
    Object.entries(typeRole as Record<TypeRole, TypeRoleSpec>).flatMap(([name, spec]) => {
        const web = toWebTypeRole(spec);

        return web === undefined ? [] : [[kebab(name), web] as const];
    }),
);
