/**
 * @module @commise/ui/testing/measure-text — the width a line of text takes in one of the app's registered faces, read
 * from the same font file the app loads (`@expo-google-fonts/inter` and `/manrope`). A fit test uses it to ask whether
 * a label fits its slot at a given text scale, which jsdom cannot answer: it lays nothing out.
 *
 * Kerning is applied, as React Native applies it by default. Test-only: it reads files from disk.
 *
 * @pattern Adapter over opentype.js — a registered face name in, the font's own advance widths out
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import opentype from 'opentype.js';

const require = createRequire(import.meta.url);

/** A registered face name is `<Family>_<weight dir>`, for example `Inter_500Medium`. */
const FACE = /^(Inter|Manrope)_(\d{3}[A-Za-z]+)$/u;

const fonts = new Map<string, opentype.Font>();

/**
 * The parsed font for a registered face, read once.
 * @sideEffect Reads the face's font file from disk, and caches the parsed font.
 * @param face - A registered face name, for example `Inter_500Medium`.
 * @returns The parsed font.
 */
function fontOf(face: string): opentype.Font {
    const cached = fonts.get(face);

    if (cached !== undefined) {
        return cached;
    }

    const match = FACE.exec(face);

    if (match === null) {
        throw new Error(`"${face}" is not a face the app loads (expected Inter_… or Manrope_…).`);
    }

    const [, family = '', weight = ''] = match;
    const packageRoot = path.dirname(require.resolve(`@expo-google-fonts/${family.toLowerCase()}/package.json`));
    const file = path.join(packageRoot, weight, `${face}.ttf`);
    let bytes: Buffer;

    try {
        bytes = readFileSync(file);
    } catch {
        throw new Error(`"${face}" is not a face the app loads: no font file at ${file}.`);
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
export function measureTextWidth(text: string, face: string, fontSize: number): number {
    const font = fontOf(face);

    return text === '' ? 0 : font.getAdvanceWidth(text, fontSize, { kerning: true });
}
