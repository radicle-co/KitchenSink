/**
 * @module @commise/ui/testing/measure-text — the width a line of text takes in one of the app's registered faces, read
 * from the same font file the app loads (`@expo-google-fonts/inter` and `/manrope`). A fit test uses it to ask whether
 * a label fits its slot at a given text scale, which jsdom cannot answer: it lays nothing out.
 *
 * Only the faces the app loads are measured: the face registry (`tokens/scale.ts`) types the parameter and is checked
 * again at run time, because the font packages ship every weight and a face the device never draws must not measure.
 * Kerning is applied, as React Native applies it by default. Test-only: it reads files from disk.
 *
 * @pattern Adapter over opentype.js — a registered face name in, the font's own advance widths out
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import opentype from 'opentype.js';

import { bodyFontFace, displayFontFace, type BodyFontFace, type DisplayFontFace } from '../tokens/scale.js';

const require = createRequire(import.meta.url);

/** A face the app loads: one of the registry's body or display faces. */
export type LoadedFace = BodyFontFace[keyof BodyFontFace] | DisplayFontFace[keyof DisplayFontFace];

/** The package that holds each registry's files, as `designArtifact`'s font table also reads them. */
const PACKAGE_OF: readonly { readonly faces: Readonly<Record<string, string>>; readonly packageName: string }[] = [
    { faces: bodyFontFace, packageName: '@expo-google-fonts/inter' },
    { faces: displayFontFace, packageName: '@expo-google-fonts/manrope' },
];

const fonts = new Map<LoadedFace, opentype.Font>();

/** Whether a face name is one the app loads. Pure. */
function isLoadedFace(face: string): face is LoadedFace {
    return PACKAGE_OF.some(({ faces }) => Object.values(faces).includes(face));
}

/**
 * A face name the tokens type as a plain string, checked against the registry. Pure.
 *
 * @param face - A face name, for example a type role's `fontFamily`.
 * @returns The same name, typed as a face the app loads.
 * @throws Error when the app does not load that face.
 */
export function asLoadedFace(face: string): LoadedFace {
    if (!isLoadedFace(face)) {
        throw new Error(`"${face}" is not a face the app loads (tokens/scale.ts lists them).`);
    }

    return face;
}

/**
 * The parsed font for a registered face, read once.
 * @sideEffect Reads the face's font file from disk, and caches the parsed font.
 * @param face - A face the app loads, for example `Inter_500Medium`.
 * @returns The parsed font.
 * @throws Error when the face is not one the app loads.
 */
function fontOf(face: LoadedFace): opentype.Font {
    const cached = fonts.get(face);

    if (cached !== undefined) {
        return cached;
    }

    const family = PACKAGE_OF.find(({ faces }) => Object.values(faces).includes(face));

    if (family === undefined) {
        throw new Error(`"${face}" is not a face the app loads (tokens/scale.ts lists them).`);
    }

    // A package keeps each face in a folder named for its weight: `Inter_500Medium` is in `500Medium/`.
    const weight = face.slice(face.indexOf('_') + 1);
    const packageRoot = path.dirname(require.resolve(`${family.packageName}/package.json`));
    const file = path.join(packageRoot, weight, `${face}.ttf`);
    let bytes: Buffer;

    try {
        bytes = readFileSync(file);
    } catch {
        throw new Error(`The app loads "${face}", but its font file is missing at ${file}.`);
    }

    const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    fonts.set(face, font);

    return font;
}

/**
 * The width a single line of text takes, in px, in a registered face at a font size.
 * @sideEffect Reads the face's font file on its first use.
 * @param text - The words, on one line.
 * @param face - A registered face name, for example `Inter_500Medium`.
 * @param fontSize - The size in px.
 * @returns The line's width in px, kerning applied.
 */
export function measureTextWidth(text: string, face: LoadedFace, fontSize: number): number {
    const font = fontOf(face);

    return text === '' ? 0 : font.getAdvanceWidth(text, fontSize, { kerning: true });
}
