import { kebab, pxToRemUnit } from './emit.js';
import { containerThreshold, type PerContainerClass } from './layout.js';
import { fontFamily, fontSize, fontWeight } from './scale.js';

/** Web font families — the shared stacks from the single source. */
export const fonts = fontFamily;

/**
 * Web font sizes — `rem` derived from the single numeric source (`scale.fontSize`, px ÷16). Keys stay in
 * the web's kebab-case (`display-xl` …) convention; the ramp order is largest → smallest.
 */
export const fontSizes = {
    'display-md': pxToRemUnit(fontSize.displayMd),
    'heading-lg': pxToRemUnit(fontSize.headingLg),
    'heading-md': pxToRemUnit(fontSize.headingMd),
    'heading-sm': pxToRemUnit(fontSize.headingSm),
    'body-lg': pxToRemUnit(fontSize.bodyLg),
    'body-md': pxToRemUnit(fontSize.bodyMd),
    'body-sm': pxToRemUnit(fontSize.bodySm),
    caption: pxToRemUnit(fontSize.caption),
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
export type FontWeights = typeof fontWeights;

/**
 * The only font sizes, in px (owner ruling, 2026-10-25 and 2026-10-26). Every type role and every ramp step takes one
 * of these four, and `__tests__/typeScale.test.ts` pins the list.
 */
export const TYPE_SIZES = [14, 16, 18, 28] as const;

/** A font size the scale allows. */
export type TypeSize = (typeof TYPE_SIZES)[number];

/** A type role's name (§1.5). */
export type TypeRole =
    | 'largeTitle'
    | 'barTitle'
    | 'sectionTitle'
    | 'cardTitle'
    | 'body'
    | 'readingBody'
    | 'meta'
    | 'list'
    | 'label'
    | 'caption'
    | 'figureInline'
    | 'figureStat';

/** One type role: its face, size (px, per container class, or the size of its line), weight step and leading. */
export interface TypeRoleSpec {
    readonly face: 'display' | 'body';
    readonly size: TypeSize | PerContainerClass<TypeSize> | 'inherit';
    readonly weight: keyof typeof fontWeight;
    /** The leading in px, a multiple of 4. The source of truth: native uses it as is, web writes `calc(px / size)`. */
    readonly lineHeight: number | 'inherit';
    /** Set in tabular, lining digits (`tabular-nums lining-nums`). */
    readonly figure?: true;
}

/**
 * The type roles (`docs/design/uiOverhaul/buildSpec.md` §1.5). A screen names a role, never a size; the ramp above
 * stays for the screens that have not moved yet.
 *
 * The owner's type-scale ruling (2026-10-25, and 2026-10-26: body stays 16): a size is one of {@link TYPE_SIZES}, a
 * leading is whole px on a 4 px grid, and no role tracks its letters. The `overline` role (11 px, capitals, tracked)
 * is retired, not moved to 14: a small heading is `label`, in sentence case.
 *
 * - Manrope (`display`) sets names only, and never a number: both figure roles are Inter.
 * - `largeTitle` has one size per container class. Web turns that into a bounded `clamp()` in container units
 *   ({@link webTypeRoles}); native picks the size for its class.
 * - `figureInline` takes the size and leading of the line it sits in, so it has neither of its own.
 * - Four roles share 14 px (`list`, `meta`, `caption`, `label`); weight (400 / 400 / 500 / 600) and colour tell them
 *   apart. `list` and `meta` are one spec on purpose: they change for different reasons (`list` follows the owner's
 *   rule on ingredient lines), so each keeps its name and a list can move without moving every metadata line.
 * - `barTitle` is `cardTitle`'s size and weight; the bar's emphasis, if it needs more, comes from colour or the bar
 *   material, never from size.
 * - `figureStat` is 18 / 24: a standalone number takes a heading's size.
 */
export const typeRole = {
    largeTitle: { face: 'display', size: { narrow: 28, regular: 28, wide: 28 }, weight: 'semibold', lineHeight: 32 },
    barTitle: { face: 'body', size: 16, weight: 'semibold', lineHeight: 20 },
    sectionTitle: { face: 'body', size: 18, weight: 'semibold', lineHeight: 24 },
    cardTitle: { face: 'body', size: 16, weight: 'semibold', lineHeight: 20 },
    body: { face: 'body', size: 16, weight: 'normal', lineHeight: 24 },
    readingBody: { face: 'body', size: 18, weight: 'normal', lineHeight: 28 },
    meta: { face: 'body', size: 14, weight: 'normal', lineHeight: 20 },
    list: { face: 'body', size: 14, weight: 'normal', lineHeight: 20 },
    label: { face: 'body', size: 14, weight: 'semibold', lineHeight: 20 },
    caption: { face: 'body', size: 14, weight: 'medium', lineHeight: 20 },
    figureInline: { face: 'body', size: 'inherit', weight: 'semibold', lineHeight: 'inherit', figure: true },
    figureStat: { face: 'body', size: 18, weight: 'semibold', lineHeight: 24, figure: true },
} as const satisfies Record<TypeRole, TypeRoleSpec>;

/** A type role as Tailwind's `--text-{role}` and its sub-properties. */
export interface WebTypeRole {
    readonly size: string;
    readonly lineHeight: string;
    readonly fontWeight: string;
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
function containerClamp(size: PerContainerClass<TypeSize>): string {
    const slope = (size.wide - size.regular) / (containerThreshold.wide - containerThreshold.regular);
    const base = size.regular - slope * containerThreshold.regular;

    const preferred = `${round4(base / 16)}rem + ${round4(slope * 100)}cqi`;

    return `clamp(${pxToRemUnit(size.narrow)}, ${preferred}, ${pxToRemUnit(size.wide)})`;
}

/**
 * A leading as the unitless multiplier CSS inherits correctly: `calc(px / size)`, as Tailwind writes its own. Unitless
 * so a child that changes its size keeps the ratio, and so a reader's WCAG 1.4.12 override (1.5x) still wins. The
 * division is left to the browser because 28 / 18 does not round to four decimals without moving the px. Pure.
 */
function leadingRatio(lineHeight: number, size: number): string {
    return `calc(${lineHeight} / ${size})`;
}

/** Project one role to its web form, or `undefined` for a role with no size of its own. Pure. */
function toWebTypeRole(spec: TypeRoleSpec): WebTypeRole | undefined {
    if (spec.size === 'inherit' || spec.lineHeight === 'inherit') {
        return undefined;
    }

    const size = typeof spec.size === 'number' ? pxToRemUnit(spec.size) : containerClamp(spec.size);
    // A per-class role (the large title) has one leading for every class: `regular` is the class the ratio is read at.
    const ratioSize = typeof spec.size === 'number' ? spec.size : spec.size.regular;

    return {
        size,
        lineHeight: leadingRatio(spec.lineHeight, ratioSize),
        fontWeight: `${fontWeight[spec.weight]}`,
    };
}

/**
 * The web projection of {@link typeRole}, keyed by kebab-case role name: what `themeCss.ts` emits as
 * `--text-{role}`, `--text-{role}--line-height` and `--text-{role}--font-weight`.
 *
 * Tailwind's `--text-*` carries no family, so a display role also takes `font-display` and a figure
 * `tabular-nums lining-nums`. `figureInline` has no entry: it is those two utilities on
 * whatever line it sits in.
 */
export const webTypeRoles: Readonly<Record<string, WebTypeRole>> = Object.fromEntries(
    Object.entries(typeRole as Record<TypeRole, TypeRoleSpec>).flatMap(([name, spec]) => {
        const web = toWebTypeRole(spec);

        return web === undefined ? [] : [[kebab(name), web] as const];
    }),
);
