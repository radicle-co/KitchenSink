/**
 * @module fonts/fontFaces — which font faces the product registers, derived from `@commise/ui`'s scale.
 *
 * Pure. The face names (`displayFontFace`, `bodyFontFace`) and the family stacks are the product's own; this
 * module only reads them, so a new face or a renamed family reaches the artifact without an edit here.
 */
import { bodyFontFace, displayFontFace, fontFamily, fontWeight } from '@commise/ui/scale';

/** One registration of a face: a `@font-face` rule, and the package file it points at. */
export interface FontFaceRegistration {
    /** The CSS family: `Inter`, `Playfair Display`, or the native face name. */
    readonly family: string;
    /** The CSS weight. */
    readonly weight: number;
    /** The `.ttf` file name. */
    readonly fileName: string;
    /** The module specifier of the `.ttf` inside its `@expo-google-fonts` package. */
    readonly specifier: string;
}

/** The licence of one font package. */
export interface FontLicenceSource {
    /** The name the licence is published under. */
    readonly file: string;
    /** The module specifier of the licence text inside its package. */
    readonly specifier: string;
}

interface FamilySource {
    /** The product's CSS stack, whose first family is the name a component writes. */
    readonly stack: string;
    /** Native face name per weight step. */
    readonly faces: Readonly<Record<string, string>>;
    /** The npm package holding the files. */
    readonly packageName: string;
    /** The licence file name prefix. */
    readonly licenceName: string;
}

const FAMILIES: readonly FamilySource[] = [
    { stack: fontFamily.body, faces: bodyFontFace, packageName: '@expo-google-fonts/inter', licenceName: 'Inter' },
    {
        stack: fontFamily.display,
        faces: displayFontFace,
        packageName: '@expo-google-fonts/playfair-display',
        licenceName: 'PlayfairDisplay',
    },
];

/** The first family of a CSS stack, unquoted: `"Playfair Display", Georgia, serif` gives `Playfair Display`. */
function primaryFamily(stack: string): string {
    const first = stack.split(',')[0] ?? '';

    return first.trim().replace(/^["']|["']$/g, '');
}

/** Whether a string is a key of the weight scale. */
function isWeightStep(step: string): step is keyof typeof fontWeight {
    return step in fontWeight;
}

/**
 * Every font registration the artifact needs: each face under its family at its weight, and under its own native
 * name at 400 (React Native names a face, the web names a family and a weight; the artifact serves both).
 *
 * @returns The registrations, body family first.
 * @throws Error when a face is keyed by a step that is not on the weight scale.
 */
export function fontFaces(): readonly FontFaceRegistration[] {
    return FAMILIES.flatMap(({ stack, faces, packageName }) =>
        Object.entries(faces).flatMap(([step, native]) => {
            if (!isWeightStep(step)) {
                throw new Error(`Font face "${native}" is keyed by "${step}", which is not a weight step.`);
            }

            const directory = native.slice(native.indexOf('_') + 1);
            const fileName = `${native}.ttf`;
            const specifier = `${packageName}/${directory}/${fileName}`;

            return [
                { family: primaryFamily(stack), weight: fontWeight[step], fileName, specifier },
                { family: native, weight: 400, fileName, specifier },
            ];
        }),
    );
}

/**
 * The licence texts that must ship with the fonts.
 *
 * @returns One entry per font package.
 */
export function fontLicenceSources(): readonly FontLicenceSource[] {
    return FAMILIES.map(({ packageName, licenceName }) => ({
        file: `OFL-${licenceName}.txt`,
        specifier: `${packageName}/LICENSE_FONT`,
    }));
}
