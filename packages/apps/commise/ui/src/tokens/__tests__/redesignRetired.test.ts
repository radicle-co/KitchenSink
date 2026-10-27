/**
 * The teal-and-sand look cannot come back. The redesign (steel on a cool base, dusk dark mode) replaced it, and a
 * hard-coded literal is exactly how teal survived a token change before (six `rgba(...)` literals frozen at the
 * pre-#113 seafoam). This scans the source of every app and feature package for the retired values, in hex AND in
 * the decimal `rgba(r, g, b)` spelling, so a literal that skips the token module fails here.
 *
 * It also refuses the old NAMES, because a token key outlives its value: `seafoam`, `Playfair`, `honey`, `cover-seafoam`
 * and `sand` (as a token name) were renamed with every consumer, and a stale `bg-sand` or `palette.seafoam` is a
 * dead reference that reads as a colour. Names are read from the PARSED source of a TypeScript file (identifiers and
 * string literals), never from its comments, because the files that explain the rename have to say the old words.
 *
 * The scanned trees include `packages/tools/designArtifact/content/designSystem`, the content the design-system
 * artifact ships. It is read only; a fix to it belongs to the design session.
 *
 * Mutation lens: paste `#31807A` or `rgba(49, 128, 122, 0.2)` into any file under the scanned trees and this fails
 * naming the file and the value; write `className="bg-sand"` or `palette.seafoam` and the name test fails.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { palette, role, roleDark } from '../colors.js';
import { coverTint, coverTintDark } from '../covers.js';

/** Retired value, with the name it had. Hex without the `#`, upper case. */
const RETIRED: Readonly<Record<string, string>> = {
    '31807A': 'seafoam (the teal action)',
    '5BA8A0': 'seafoam-light',
    '2A6B65': 'ocean-dark (teal)',
    '3D8B85': 'the pre-#113 seafoam',
    E2EDEC: 'the teal selected fill',
    '7DC7C0': 'the dark teal action text',
    '65B5AE': 'the dark teal edge',
    '243935': 'the dark teal selected fill',
    FAF6F0: 'sand (the warm canvas)',
    '141210': 'the warm dark canvas',
    '1E1B18': 'the warm dark paper',
    '2D3436': 'the old charcoal',
    '6B645C': 'the warm slate',
    C9C1B6: 'the warm mist',
    F3EEE6: 'linen (the warm pearl)',
    '8A847C': 'the warm pewter',
    A86A12: 'honey (the amber star)',
    '2EC4B6': 'the stray teal of the pre-#113 chips',
};

const HERE = dirname(fileURLToPath(import.meta.url));
/** `packages/apps/commise`. */
const APPS = join(HERE, '../../../..');
const SCANNED = ['ui/src', 'web/src', 'mobile/src', 'features'];
/** `packages/tools/designArtifact/content/designSystem`: shipped design-system content, read only. */
const DESIGN_ARTIFACT = join(APPS, '../../tools/designArtifact/content/designSystem');
/** Files that must say the old words, because they ARE the record of the rename. */
const RENAME_RECORDS = new Set(['redesignPin.test.ts', 'redesignRetired.test.ts']);
const CODE_FILE = /\.(ts|tsx|css|json)$/;
/** The design-system content also ships HTML and the READMEs a reader opens, so those are scanned there. */
const ARTIFACT_FILE = /\.(ts|tsx|css|json|html|md)$/;
const SKIPPED = new Set(['node_modules', 'dist', '.next', '__fixtures__', 'generated']);

/** Every source file under a directory. */
function files(directory: string, accepts: RegExp = CODE_FILE): readonly string[] {
    return readdirSync(directory).flatMap((entry) => {
        const path = join(directory, entry);

        if (SKIPPED.has(entry)) {
            return [];
        }

        return statSync(path).isDirectory() ? files(path, accepts) : accepts.test(entry) ? [path] : [];
    });
}

/** The forms one retired hex can be spelled in. */
function spellings(hex: string): readonly RegExp[] {
    const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return [new RegExp(`#${hex}\\b`, 'i'), new RegExp(`\\b${r}\\s*,\\s*${g}\\s*,\\s*${b}\\b`)];
}

/** The hits for every retired hex in one file's text. */
function hexHits(text: string): readonly string[] {
    return Object.entries(RETIRED)
        .filter(([hex]) => spellings(hex).some((pattern) => pattern.test(text)))
        .map(([hex, name]) => `#${hex} (${name})`);
}

/** `seafoam` and `Playfair` are retired in any spelling: no current token, family or recipe word contains either. */
const RETIRED_WORDS = /seafoam|playfair/i;
/**
 * `sand` and `honey` are ordinary English (an ingredient, a beach), so only their use AS A TOKEN NAME is retired:
 * a Tailwind utility (`bg-sand`), a CSS custom property (`--brand-honey`) or a palette lookup (`palette.sand`).
 */
const RETIRED_TOKEN_NAMES =
    /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|decoration|shadow)-(?:sand|honey)\b|--(?:color-|brand-)?(?:sand|honey)\b|\bpalette(?:\.|\[\s*['"])(?:sand|honey)\b/;

/** Whether text names a retired token. */
function namesRetired(text: string): string | undefined {
    return RETIRED_WORDS.exec(text)?.[0] ?? RETIRED_TOKEN_NAMES.exec(text)?.[0];
}

/** The retired names a TypeScript file USES: identifiers, string and template literals. Comments and JSX text are not read. */
function tsNameHits(file: string, text: string): readonly string[] {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const hits: string[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
            const hit = namesRetired(node.text);
            const key = ts.isPropertyAccessExpression(node.parent) || ts.isPropertyAssignment(node.parent);

            if (hit !== undefined) {
                hits.push(hit);
            } else if (key && /^(?:sand|honey)$/.test(node.text)) {
                hits.push(node.text);
            }
        } else if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
            const hit = namesRetired(node.text);
            const key = ts.isPropertyAssignment(node.parent) && node.parent.name === node;

            if (hit !== undefined) {
                hits.push(hit);
            } else if (key && /^(?:sand|honey)$/.test(node.text)) {
                hits.push(node.text);
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(source);

    return hits;
}

/** The retired names a file uses, by its kind. Only TypeScript is parsed; any other file is read as written. */
function nameHits(file: string, text: string): readonly string[] {
    if (/\.tsx?$/.test(file)) {
        return tsNameHits(file, text);
    }

    const hit = namesRetired(text);

    return hit === undefined ? [] : [hit];
}

/** Scan a tree for retired hexes and, when `names` is set, retired names. */
function scan(root: string, accepts: RegExp, names: boolean): readonly string[] {
    return files(root, accepts).flatMap((file) => {
        if (RENAME_RECORDS.has(file.split('/').pop() ?? '')) {
            return [];
        }

        const text = readFileSync(file, 'utf8');
        const found = [...hexHits(text), ...(names ? nameHits(file, text).map((name) => `name "${name}"`) : [])];

        return found.map((hit) => `${relative(APPS, file)}: ${hit}`);
    });
}

describe('the retired teal-and-sand values', () => {
    it('are not in any token', () => {
        const tokens = [palette, role, roleDark, coverTint, coverTintDark].flatMap((table) =>
            Object.values(table).map((value) => value.toUpperCase()),
        );

        for (const hex of Object.keys(RETIRED)) {
            expect(tokens, `#${hex} is back in a token`).not.toContain(`#${hex}`);
        }
    });

    it('are not in any token key', () => {
        const keys = [palette, role, roleDark, coverTint, coverTintDark].flatMap((table) => Object.keys(table));

        expect(keys.filter((key) => namesRetired(key) !== undefined || /^(?:sand|honey)$/.test(key))).toEqual([]);
    });

    it('are not hard-coded, by value or by name, in app or feature source', () => {
        expect(SCANNED.flatMap((root) => scan(join(APPS, root), CODE_FILE, true))).toEqual([]);
    });

    // Reads another package's shipped content. It FAILS until the design session's fix to that content lands; that is
    // expected and this test is deliberately not skipped.
    it('are not in the design-system artifact content (designArtifact/content/designSystem)', () => {
        expect(scan(DESIGN_ARTIFACT, ARTIFACT_FILE, true)).toEqual([]);
    });
});

describe('the retired-name reader', () => {
    // Mutation lens for the scanner itself: a reader that matched nothing would pass every tree above.
    it('finds a retired name used in code and ignores the same word in a comment or in JSX copy', () => {
        const code = [
            '// seafoam was the old action',
            "const a = 'bg-sand';",
            'const b = palette.honey;',
            'const c = { seafoam: 1 };',
            'const d = <p>a bowl of sand</p>;',
            "const e = 'cover-seafoam';",
            'const f = `font ${x} Playfair Display`;',
            "const ok = 'honey';",
        ].join('\n');

        expect(tsNameHits('x.tsx', code)).toEqual(['bg-sand', 'honey', 'seafoam', 'seafoam', 'Playfair']);
    });
});
