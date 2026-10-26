/**
 * No app writes a font size or a line height as a number (owner ruling, type scale, 2026-10-25; `typeScaleSpec` §4.B).
 * A screen names a type role (`nativeTokens.type.body`, `text-body`), so the one scale in
 * `packages/apps/commise/ui/src/tokens` stays the only place a size lives. Three shapes are refused in app source:
 *
 *  - a `fontSize:` or `lineHeight:` property whose value is a number literal (`{ fontSize: 13 }`);
 *  - a `fontSize={13}` or `lineHeight={22}` JSX attribute;
 *  - a Tailwind arbitrary size class, `text-[13px]` or `text-[0.8rem]`, in a string, template or JSX text.
 *
 * ⛔ THERE IS NO BASELINE AND NO ALLOW-LIST FOR APP FILES. The scale drifted because 67 native styles each spelled a
 * number; a token test cannot see those, and an exemption list is how they would have stayed.
 *
 * SCOPE (a rule about where the guard looks, not an exemption): the files git tracks under `packages/apps/**` with a
 * `.ts` or `.tsx` extension, except the token modules themselves (`ui/src/tokens/`, which DEFINE the numbers), test
 * files and fixtures (`__tests__/`, `__fixtures__/`, `tests/`, `*.test.*`, `*.spec.*`), and build output.
 *
 * READ WITH THE TYPESCRIPT PARSER, not a regex over text, so a comment, or a string that merely mentions
 * `fontSize: 13`, is never a style. The class check reads only string-like nodes for the same reason. The reader is
 * proven against a fixture table first. Known limit: a COMPUTED size (`fontSize: base * 1.2`) is not a literal and is
 * not seen; the type-scale token test covers every value the tokens themselves emit.
 *
 * ✅ THE FIX FOR A FAILURE: spread a role (`...nativeTokens.type.meta`) or use its class (`text-meta`). If no role
 * fits, that is a design question for `staff-ux-engineer`, not a reason to type a number.
 *
 * @pattern Fitness Function over the source of every app
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

/** A Tailwind arbitrary text size: `text-[13px]`, `text-[0.8125rem]`, behind any variant prefix. */
const ARBITRARY_TEXT_SIZE = /(?:^|[\s"'`:])text-\[\d*\.?\d+(?:px|rem)\]/u;

const SIZE_PROPERTIES: ReadonlySet<string> = new Set(['fontSize', 'lineHeight']);

/** The number literal an initializer states, through parentheses, `as`, `satisfies` and a leading minus. */
function numericLiteralOf(expression: ts.Expression): ts.NumericLiteral | undefined {
    if (ts.isNumericLiteral(expression)) {
        return expression;
    }

    if (
        ts.isParenthesizedExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isSatisfiesExpression(expression)
    ) {
        return numericLiteralOf(expression.expression);
    }

    if (ts.isPrefixUnaryExpression(expression)) {
        return numericLiteralOf(expression.operand);
    }

    return undefined;
}

/** The name of a property assignment or JSX attribute, when it is a plain identifier or string key. */
function nameOf(name: ts.PropertyName | ts.JsxAttributeName): string | undefined {
    return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/**
 * The 1-based line and the offending text of every hard-coded type size in a module. Pure.
 *
 * @param fileName - The module's name, which decides whether it is parsed as TSX.
 * @param source - Its text.
 * @returns One entry per literal size or arbitrary size class, in source order.
 */
export function typeScaleLiterals(
    fileName: string,
    source: string,
): readonly { readonly line: number; readonly found: string }[] {
    const kind = /\.tsx$/u.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
    const found: { line: number; found: string }[] = [];

    const report = (node: ts.Node, text: string): void => {
        found.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, found: text });
    };

    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAssignment(node)) {
            const key = nameOf(node.name);
            const literal = key !== undefined && SIZE_PROPERTIES.has(key) ? numericLiteralOf(node.initializer) : undefined;

            if (literal !== undefined) {
                report(node, `${key ?? ''}: ${node.initializer.getText(file)}`);
            }
        } else if (ts.isJsxAttribute(node) && node.initializer !== undefined && ts.isJsxExpression(node.initializer)) {
            const key = nameOf(node.name);
            const literal =
                key !== undefined && SIZE_PROPERTIES.has(key) && node.initializer.expression !== undefined
                    ? numericLiteralOf(node.initializer.expression)
                    : undefined;

            if (literal !== undefined) {
                report(node, `${key ?? ''}={${literal.text}}`);
            }
        } else if (
            (ts.isStringLiteralLike(node) ||
                ts.isTemplateHead(node) ||
                ts.isTemplateMiddle(node) ||
                ts.isTemplateTail(node) ||
                ts.isJsxText(node)) &&
            ARBITRARY_TEXT_SIZE.test(node.text)
        ) {
            report(node, (ARBITRARY_TEXT_SIZE.exec(node.text)?.[0] ?? '').trim());
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return found;
}

describe('the type-scale literal reader', () => {
    const cases: readonly { readonly shape: string; readonly source: string; readonly found: readonly string[] }[] = [
        { shape: 'a literal font size', source: `const s = { fontSize: 13 };`, found: ['fontSize: 13'] },
        { shape: 'a literal line height', source: `const s = { lineHeight: 22 };`, found: ['lineHeight: 22'] },
        { shape: 'a decimal line height', source: `const s = { lineHeight: 1.5 };`, found: ['lineHeight: 1.5'] },
        { shape: 'a string-keyed size', source: `const s = { 'fontSize': 13 };`, found: ["fontSize: 13"] },
        { shape: 'a size behind `as const`', source: `const s = { fontSize: 13 as const };`, found: ['fontSize: 13 as const'] },
        { shape: 'a size behind parentheses', source: `const s = { fontSize: (13) };`, found: ['fontSize: (13)'] },
        { shape: 'a nested style', source: `StyleSheet.create({ a: { color: C }, b: { fontSize: 11 } });`, found: ['fontSize: 11'] },
        { shape: 'a JSX size attribute', source: `const e = <Text fontSize={13} />;`, found: ['fontSize={13}'] },
        { shape: 'an arbitrary px class', source: `const c = 'flex text-[13px] gap-2';`, found: ['text-[13px]'] },
        { shape: 'an arbitrary rem class', source: 'const c = `text-[0.8125rem] ${x}`;', found: ['text-[0.8125rem]'] },
        { shape: 'a variant arbitrary class', source: `const c = "medium:text-[15px]";`, found: ['text-[15px]'] },
        { shape: 'an arbitrary class in JSX text', source: `const e = <p className="text-[12px]">x</p>;`, found: ['text-[12px]'] },
        { shape: 'a token size', source: `const s = { fontSize: nativeTokens.fontSize.bodySm };`, found: [] },
        { shape: 'a role spread', source: `const s = { ...nativeTokens.type.meta };`, found: [] },
        { shape: 'a computed size', source: `const s = { fontSize: base * 2 };`, found: [] },
        { shape: 'an unrelated number', source: `const s = { fontWeight: 600, flexShrink: 1, minWidth: 96 };`, found: [] },
        { shape: 'a size in a comment', source: `// { fontSize: 13 } text-[13px]\nconst s = {};`, found: [] },
        { shape: 'a size in a string', source: `const s = "{ fontSize: 13 }";`, found: [] },
        { shape: 'a role class', source: `const c = 'text-meta text-body-sm';`, found: [] },
        { shape: 'a non-size arbitrary class', source: `const c = 'text-[var(--x)] text-[#fff]';`, found: [] },
    ];

    for (const { shape, source, found } of cases) {
        it(`reads ${shape}`, () => {
            expect(typeScaleLiterals('fixture.tsx', source).map((hit) => hit.found)).toEqual(found);
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
                !file.includes('/ui/src/tokens/') &&
                !/(?:^|\/)(?:__tests__|__fixtures__|tests|node_modules|dist|\.expo|android|ios|\.next)\//u.test(file) &&
                !/\.(?:test|spec)\.tsx?$/u.test(file),
        )
        .sort();
}

describe('apps write no type size as a number', () => {
    it('discovers the app modules, native and web, beside the ones that were hard-coded (a vacuous pass would hide the rule)', () => {
        const modules = appModules();

        expect(modules).toContain('packages/apps/commise/features/recipes/src/photos/RecipePhotoManager.native.tsx');
        expect(modules).toContain('packages/apps/commise/ui/src/sheet/BottomSheetPanel.native.tsx');
        expect(modules).toContain('packages/apps/commise/web/src/app/[locale]/page.tsx');
        expect(modules.some((file) => file.includes('/ui/src/tokens/'))).toBe(false);
    });

    it('lets no app module state a font size, a line height or a `text-[…]` size as a literal', () => {
        const offenders = appModules().flatMap((file) =>
            typeScaleLiterals(file, readFileSync(path.join(repoRoot, file), 'utf8')).map(
                (hit) => `${file}:${String(hit.line)}  ${hit.found}`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
