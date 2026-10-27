/**
 * No app writes an ad-hoc ink-alpha wash as a press or hover fill (parity item 15, `componentFixes.md` issue 3).
 *
 * About 25 feature files hovered with `hover:bg-ink/6`, each its own copy of "ink at 6%". The design system has ONE
 * press fill: the `surfaceMuted` role (`bg-surface-muted`), and `lineDivider` over a muted parent (`bg-line-divider`).
 * The native twin is `theme.wash`. A translucent ink is a third fill that looks like the first on paper, vanishes on
 * the second, and gives dark mode its own surprise, so it is refused:
 *
 *  - `bg-ink/6`, `bg-ink-muted/10` and `bg-ink/[0.06]`, behind ANY variant prefix (`hover:`, `active:`,
 *    `focus-visible:`, `data-[highlighted]:`, `md:hover:`), in a string, template or JSX text.
 *
 * Not refused: a tinted status fill such as `bg-danger/10` (a tone, not a press), `text-ink/60`, and `bg-ink` itself.
 *
 * ⛔ THERE IS NO BASELINE AND NO ALLOW-LIST. The fix is `bg-surface-muted` (or `bg-line-divider` where the parent is
 * already `surfaceMuted`), never an exemption.
 *
 * SCOPE: the files git tracks under `packages/apps/**` with a `.ts` or `.tsx` extension, except test files and
 * fixtures (`__tests__/`, `__fixtures__/`, `tests/`, `*.test.*`, `*.spec.*`) and build output. READ WITH THE TYPESCRIPT
 * PARSER, string-like nodes only, so a comment that explains the old wash is never a violation. The reader is proven
 * against a fixture table before it is trusted on the tree (stage new files first: the scope is `git ls-files`).
 *
 * @pattern Fitness Function over the source of every app
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

/** A Tailwind background in the ink family at a fractional opacity, after the start of a token. */
const INK_ALPHA_FILL = /(?:^|[\s"'`])(?:[^\s"'`]*:)?(bg-ink(?:-muted)?\/(?:\d+(?:\.\d+)?|\[[^\]\s]+\]))(?=$|[\s"'`])/u;

/**
 * The 1-based line and the offending class of every ink-alpha fill in a module. Pure.
 *
 * @param fileName - The module's name, which decides whether it is parsed as TSX.
 * @param source - Its text.
 * @returns One entry per offending class, in source order.
 */
export function pressWashLiterals(
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
            // A token can sit at either end of a template part, so each part is read with a space on both sides.
            for (const token of ` ${node.text} `.split(/\s+/u)) {
                const hit = INK_ALPHA_FILL.exec(` ${token} `);

                if (hit?.[1] !== undefined) {
                    found.push({
                        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
                        found: token,
                    });
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return found;
}

describe('the ink-alpha wash reader', () => {
    const cases: readonly { readonly shape: string; readonly source: string; readonly found: readonly string[] }[] = [
        { shape: 'a bare ink wash', source: `const c = 'bg-ink/6';`, found: ['bg-ink/6'] },
        { shape: 'a hover wash', source: `const c = 'flex hover:bg-ink/6 gap-2';`, found: ['hover:bg-ink/6'] },
        { shape: 'an active wash', source: `const c = "active:bg-ink/10";`, found: ['active:bg-ink/10'] },
        {
            shape: 'a stacked-variant wash',
            source: `const c = 'md:hover:bg-ink/6';`,
            found: ['md:hover:bg-ink/6'],
        },
        {
            shape: 'a data-attribute variant wash',
            source: `const c = 'data-[highlighted]:bg-ink/6';`,
            found: ['data-[highlighted]:bg-ink/6'],
        },
        {
            shape: 'a focus-visible wash',
            source: `const c = 'focus-visible:bg-ink/6';`,
            found: ['focus-visible:bg-ink/6'],
        },
        { shape: 'an ink-muted wash', source: `const c = 'hover:bg-ink-muted/10';`, found: ['hover:bg-ink-muted/10'] },
        { shape: 'an arbitrary opacity', source: `const c = 'hover:bg-ink/[0.06]';`, found: ['hover:bg-ink/[0.06]'] },
        {
            shape: 'a wash in a template head',
            source: 'const c = `flex hover:bg-ink/6 ${x}`;',
            found: ['hover:bg-ink/6'],
        },
        { shape: 'a wash in a template tail', source: 'const c = `${x} hover:bg-ink/6`;', found: ['hover:bg-ink/6'] },
        {
            shape: 'a wash in JSX text',
            source: `const e = <p className="hover:bg-ink/6">x</p>;`,
            found: ['hover:bg-ink/6'],
        },
        {
            shape: 'two washes in one string',
            source: `const c = 'hover:bg-ink/6 active:bg-ink/10';`,
            found: ['hover:bg-ink/6', 'active:bg-ink/10'],
        },
        { shape: 'the surfaceMuted press', source: `const c = 'hover:bg-surface-muted';`, found: [] },
        { shape: 'the lineDivider press', source: `const c = 'active:bg-line-divider';`, found: [] },
        { shape: 'a status tint', source: `const c = 'bg-danger/10 bg-attention-tint';`, found: [] },
        { shape: 'an ink text opacity', source: `const c = 'text-ink/60';`, found: [] },
        { shape: 'a solid ink fill', source: `const c = 'bg-ink text-canvas';`, found: [] },
        { shape: 'a longer colour name that merely starts with ink', source: `const c = 'bg-inkwell/6';`, found: [] },
        { shape: 'a wash named in a comment', source: `// hover:bg-ink/6 was the old one\nconst c = 1;`, found: [] },
        { shape: 'a wash named in a block comment', source: `/* bg-ink/6 */ const c = 1;`, found: [] },
    ];

    for (const { shape, source, found } of cases) {
        it(`reads ${shape}`, () => {
            expect(pressWashLiterals('fixture.tsx', source).map((hit) => hit.found)).toEqual(found);
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

describe('apps write no ink-alpha press wash', () => {
    it('discovers the app modules, web and native, where the washes were (a vacuous pass would hide the rule)', () => {
        const modules = appModules();

        expect(modules).toContain('packages/apps/commise/web/src/components/home/chrome/HomeSidebar.tsx');
        expect(modules).toContain('packages/apps/commise/features/recipes/src/detail/IngredientCheckRow.tsx');
        expect(modules).toContain('packages/apps/commise/ui/src/button/surfaceClass.ts');
        expect(modules.length).toBeGreaterThan(500);
    });

    it('lets no app module state a `bg-ink/<n>` fill behind any variant', () => {
        const offenders = appModules().flatMap((file) =>
            pressWashLiterals(file, readFileSync(path.join(repoRoot, file), 'utf8')).map(
                (hit) => `${file}:${String(hit.line)}  ${hit.found}`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
