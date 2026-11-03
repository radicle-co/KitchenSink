/**
 * @module tokens/native — React Native-typed design tokens, DERIVED from the single numeric source
 * (`scale.ts`). Where the web tokens emit `rem`/px strings, native consumes raw numbers and structured
 * objects; `nativeTokens` is the RN-facing projection of the exact same scale, so the two platforms
 * cannot drift. This module is pure data (no `react-native` import) and safe under Node/Vitest.
 */
import { devicePixelScale, snapLineHeight } from './iosLineHeight.js';
import type { PerContainerClass } from './layout.js';
import {
    bodyFontFace,
    displayFontFace,
    elevation,
    type ElevationLayer,
    fontSize,
    fontWeight,
    lineHeightPx,
    mediaHeight,
    radius,
    spacing,
} from './scale.js';
import { typeRole, type TypeRole, type TypeRoleSpec } from './typography.js';

/**
 * A React Native shadow, composed from a `scale.elevation` spec. `shadowColor` + `shadowOpacity` are
 * kept separate (iOS), `shadowRadius` is the blur, `shadowOffset` the drop, and `elevation` the Android
 * depth, set per LEVEL (`androidElevation`), never from the offset. CSS `spread` has no RN equivalent and is
 * intentionally dropped, and a view has ONE shadow, so a two-layer web shadow projects its last (diffuse) layer.
 */
export interface NativeShadow {
    readonly shadowColor: string;
    readonly shadowOffset: { readonly width: number; readonly height: number };
    readonly shadowOpacity: number;
    readonly shadowRadius: number;
    readonly elevation: number;
}

function toNativeShadow(layers: readonly [ElevationLayer, ...ElevationLayer[]], androidLevel: number): NativeShadow {
    const spec = layers[layers.length - 1] as ElevationLayer;

    return {
        shadowColor: `rgb(${spec.color})`,
        shadowOffset: { width: spec.offsetX, height: spec.offsetY },
        shadowOpacity: spec.opacity,
        shadowRadius: spec.blur,
        elevation: androidLevel,
    };
}

/**
 * A native type role: ONE registered face (the family's face for the role's weight), a size and an absolute leading
 * in px. ⛔ Never a `fontWeight`: on Android a weight on a registered face resolves to a synthesised or system bold
 * instead of the face (§1.5), which is a candidate cause of the greeting's system-bold fallback.
 */
export interface NativeTypeStyle {
    readonly fontFamily: string;
    readonly fontSize?: number;
    readonly lineHeight?: number;
    // Mutable on purpose: React Native's `TextStyle.fontVariant` is a mutable array, so a readonly tuple here would
    // make every role unusable as a `style`.
    readonly fontVariant?: ['tabular-nums', 'lining-nums'];
}

/** The registered face for a role's family and weight. Throws for a weight the family has no face for. Pure. */
function faceOf(spec: TypeRoleSpec): string {
    const faces: Readonly<Partial<Record<keyof typeof fontWeight, string>>> =
        spec.face === 'display' ? displayFontFace : bodyFontFace;
    const face = faces[spec.weight];

    if (face === undefined) {
        throw new Error(`No registered ${spec.face} face for weight "${spec.weight}".`);
    }

    return face;
}

/**
 * A token leading as the platform draws it (iOS sits a hair above the pixel grid, react/react-native#58970; see
 * `iosLineHeight.native.ts`). The token in `typography.ts` stays exact.
 */
function platformLeading(lineHeight: number): number {
    return snapLineHeight(lineHeight, devicePixelScale());
}

/** A role at one px size (or at the size of its line, for `inherit`). Pure. */
function toNativeTypeStyle(spec: TypeRoleSpec, size: number | 'inherit'): NativeTypeStyle {
    return {
        fontFamily: faceOf(spec),
        ...(size === 'inherit' ? {} : { fontSize: size }),
        ...(size === 'inherit' || spec.lineHeight === 'inherit'
            ? {}
            : { lineHeight: platformLeading(spec.lineHeight) }),
        ...(spec.figure === true
            ? { fontVariant: ['tabular-nums', 'lining-nums'] satisfies NativeTypeStyle['fontVariant'] }
            : {}),
    };
}

/** A role with a size and a leading of its own: every role but inline figures. */
export interface SizedNativeTypeStyle extends NativeTypeStyle {
    readonly fontSize: number;
    readonly lineHeight: number;
}

/** A role at one px size, with its own leading. Throws for a role whose leading is its line's. Pure. */
function toSizedNativeTypeStyle(spec: TypeRoleSpec, size: number): SizedNativeTypeStyle {
    if (spec.lineHeight === 'inherit') {
        throw new Error('A sized type role needs a leading of its own.');
    }

    return { ...toNativeTypeStyle(spec, size), fontSize: size, lineHeight: platformLeading(spec.lineHeight) };
}

/** A role with one size per container class, projected once per class. Pure. */
function perClass(spec: TypeRoleSpec, sizes: PerContainerClass<number>): PerContainerClass<SizedNativeTypeStyle> {
    return {
        narrow: toSizedNativeTypeStyle(spec, sizes.narrow),
        regular: toSizedNativeTypeStyle(spec, sizes.regular),
        wide: toSizedNativeTypeStyle(spec, sizes.wide),
    };
}

/** Every role with a single size of its own, projected once. */
type SizedTypeRole = Exclude<TypeRole, 'largeTitle' | 'figureInline'>;

const sizedTypeRoles = Object.fromEntries(
    (Object.entries(typeRole) as [TypeRole, TypeRoleSpec][]).flatMap(([name, spec]) =>
        typeof spec.size === 'number' ? [[name, toSizedNativeTypeStyle(spec, spec.size)] as const] : [],
    ),
) as Readonly<Record<SizedTypeRole, SizedNativeTypeStyle>>;

/**
 * The native projection of the type roles. Every role is one style, except `largeTitle`, which has one per container
 * class (`type.largeTitle[containerClass]`, the class from `useContainerClass`).
 */
const nativeType = {
    ...sizedTypeRoles,
    // Takes the size and leading of the line it sits in, so it has neither of its own.
    figureInline: toNativeTypeStyle(typeRole.figureInline, 'inherit'),
    largeTitle: perClass(typeRole.largeTitle, typeRole.largeTitle.size),
} as const;

/**
 * Android elevation per level (§1.6), in dp: one meaning per level. Android draws its own shadow from `elevation`
 * alone and ignores the iOS offset/blur, so copying the offset (4, 10, 20 dp) painted a heavy halo round every card.
 */
const androidElevation = { sm: 1, md: 2, lg: 3, xl: 6, glow: 0 } as const satisfies Record<
    keyof typeof elevation,
    number
>;

const nativeElevation = {
    sm: toNativeShadow(elevation.sm, androidElevation.sm),
    md: toNativeShadow(elevation.md, androidElevation.md),
    lg: toNativeShadow(elevation.lg, androidElevation.lg),
    xl: toNativeShadow(elevation.xl, androidElevation.xl),
    glow: toNativeShadow(elevation.glow, androidElevation.glow),
} as const;

/**
 * The React Native projection of the design scale. `spacing`/`radius`/`fontSize` are pixel numbers,
 * `lineHeight` is the px leading for each allowed size, `fontWeight` are numeric weights, and `elevation` are RN shadow objects.
 *
 * Type is projected as `fontFace` — the REGISTERED face names — and NOT as the web `fontFamily` stacks:
 * React Native resolves `fontFamily` to one registered face, so handing it a stack silently renders the
 * system font. Withholding the stack here is what makes that bug unrepresentable on native (guarded by
 * `__tests__/nativeFontFace.test.ts`).
 */
export const nativeTokens = {
    spacing,
    radius,
    mediaHeight,
    fontFace: { display: displayFontFace, body: bodyFontFace },
    type: nativeType,
    fontWeight,
    lineHeight: lineHeightPx,
    fontSize,
    elevation: nativeElevation,
} as const;

export type NativeTokens = typeof nativeTokens;
