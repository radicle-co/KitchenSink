/**
 * Every focus ring that opens an offset gap names the colour of that gap (parity item 14, `componentFixes.md`).
 *
 * `ring-offset-2` paints the gap between a control and its focus ring in `--tw-ring-offset-color`, which Tailwind
 * defaults to WHITE. In dark mode that is a white halo around every focus ring. Tailwind registers the property with
 * `inherits: false`, so a `:root` override in the dark block never reaches a control, and the design-artifact compiler
 * refuses a non-`:root` rule in a dark block and a second `@layer base`; so each control names `ring-offset-canvas`
 * beside its width, and the `canvas` role follows the theme. The rule, per string-like node:
 *
 *  - a `ring-offset-<width>` token behind any variant prefix (`focus-visible:`, `has-[:focus-visible]:`) needs a
 *    `ring-offset-<colour>` token behind the SAME prefix in the same string.
 *
 * ⛔ NO BASELINE AND NO ALLOW-LIST. SCOPE: git-tracked `.ts`/`.tsx` under `packages/apps/**`, minus tests, fixtures and
 * build output. READ WITH THE TYPESCRIPT PARSER, string-like nodes only, so a comment that names the class is not a use.
 *
 * @pattern Fitness Function over the source of every app
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

/** `<prefix>ring-offset-<digits>`: a width token, with its variant prefix (possibly empty) captured. */
const OFFSET_WIDTH = /(?<=^|[\s"'`])((?:[\w-]+(?:\[[^\]\s]*\])?:)*)ring-offset-\d+(?=$|[\s"'`])/gu;

/** The tokens of a string that name an offset colour (`ring-offset-canvas`, not a width), with their prefix. */
function offsetColourPrefixes(text: string): ReadonlySet<string> {
    const found = new Set<string>();

    for (const match of text.matchAll(
        /(?<=^|[\s"'`])((?:[\w-]+(?:\[[^\]\s]*\])?:)*)ring-offset-(?!\d)[a-z][\w-]*(?=$|[\s"'`])/gu,
    )) {
        found.add(match[1] ?? '');
    }

    return found;
}

/**
 * The 1-based line and the prefix of every offset width with no colour beside it, in a module. Pure.
 *
 * @param fileName - The module's name, which decides whether it is parsed as TSX.
 * @param source - Its text.
 * @returns One entry per colourless width, in source order.
 */
export function colourlessRingOffsets(
    fileName: string,
    source: string,
): readonly { readonly line: number; readonly found: string }[] {
    const kind = /\.tsx$/u.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
    const found: { line: number; found: string }[] = [];

    const visit = (node: ts.Node): void => {
        if (
            ts.isStringLiteralLike(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node) ||
            ts.isJsxText(node)
        ) {
            const colours = offsetColourPrefixes(node.text);

            for (const match of node.text.matchAll(OFFSET_WIDTH)) {
                if (!colours.has(match[1] ?? '')) {
                    found.push({
                        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
                        found: `${match[1] ?? ''}ring-offset-…`,
                    });
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return found;
}

describe('the ring-offset colour reader', () => {
    const cases: readonly { readonly shape: string; readonly source: string; readonly found: readonly string[] }[] = [
        { shape: 'a bare width', source: `const c = 'ring-offset-2';`, found: ['ring-offset-…'] },
        {
            shape: 'a focus-visible width',
            source: `const c = 'focus-visible:ring-2 focus-visible:ring-offset-2';`,
            found: ['focus-visible:ring-offset-…'],
        },
        {
            shape: 'a has-[] width',
            source: `const c = 'has-[:focus-visible]:ring-offset-2 pointer-fine:hover:shadow-md';`,
            found: ['has-[:focus-visible]:ring-offset-…'],
        },
        {
            shape: 'a width in a template part',
            source: 'const c = `focus-visible:ring-offset-2 ${x}`;',
            found: ['focus-visible:ring-offset-…'],
        },
        {
            shape: 'a colour behind a DIFFERENT prefix',
            source: `const c = 'focus-visible:ring-offset-2 hover:ring-offset-canvas';`,
            found: ['focus-visible:ring-offset-…'],
        },
        {
            shape: 'a width with its colour',
            source: `const c = 'focus-visible:ring-offset-2 focus-visible:ring-offset-canvas';`,
            found: [],
        },
        {
            shape: 'a has-[] width with its colour',
            source: `const c = 'has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-canvas';`,
            found: [],
        },
        { shape: 'a colour before its width', source: `const c = 'ring-offset-paper ring-offset-4';`, found: [] },
        { shape: 'a ring with no offset', source: `const c = 'focus-visible:ring-2 ring-focus-ring';`, found: [] },
        { shape: 'a width named in a comment', source: `// ring-offset-2 is the gap\nconst c = 1;`, found: [] },
    ];

    for (const { shape, source, found } of cases) {
        it(`reads ${shape}`, () => {
            expect(colourlessRingOffsets('fixture.tsx', source).map((hit) => hit.found)).toEqual(found);
        });
    }
});

/** Every app module the guard reads: git-tracked source under `packages/apps/**`, minus the scope exclusions. */
function appModules(): readonly string[] {
    return execFileSync('git', ['ls-files', '--', 'packages/apps'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter((file) => /\.tsx?$/u.test(file) && !file.endsWith('.d.ts'))
        .filter(
            (file) =>
                !/(?:^|\/)(?:__tests__|__fixtures__|tests|node_modules|dist|\.expo|android|ios|\.next)\//u.test(file) &&
                !/\.(?:test|spec)\.tsx?$/u.test(file),
        )
        .sort();
}

describe('apps give every focus-ring offset a colour', () => {
    it('discovers the modules that open an offset (a vacuous pass would hide the rule)', () => {
        const withOffsets = appModules().filter((file) =>
            /ring-offset-\d/u.test(readFileSync(path.join(repoRoot, file), 'utf8')),
        );

        expect(withOffsets).toContain('packages/apps/commise/ui/src/button/surfaceClass.ts');
        expect(withOffsets).toContain('packages/apps/commise/ui/src/chip/chipClass.ts');
        expect(withOffsets.length).toBeGreaterThanOrEqual(9);
    });

    it('lets no app module state a `ring-offset-<width>` without a `ring-offset-<colour>` beside it', () => {
        const offenders = appModules().flatMap((file) =>
            colourlessRingOffsets(file, readFileSync(path.join(repoRoot, file), 'utf8')).map(
                (hit) => `${file}:${String(hit.line)}  ${hit.found}`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
