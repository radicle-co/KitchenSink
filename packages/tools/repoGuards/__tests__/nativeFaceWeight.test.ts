/**
 * A native face carries its own weight — no native style both names a face and sets `fontWeight`
 * (`docs/design/uiOverhaul/buildSpec.md` §1.3; `docs/architecture/uiOverhaulBlueprint.md` Part B, slice-1 leftovers).
 *
 * On React Native each weight of a custom family is a separate registered face (`Fraunces_700Bold`), so the face
 * already IS the weight. A `fontWeight` beside it asks the platform for a bold of a face that has none: Android then
 * drops the custom family and draws the system bold, which is the defect slice 1's captures showed on the Home
 * greeting. The same holds for a type role spread (`...nativeTokens.type.label`), which names the face for its role.
 *
 * Read with the TypeScript parser, one object literal at a time, so a comment or a string that mentions either key is
 * never mistaken for a style. ⛔ IT ENUMERATES NOTHING: candidates come from the filesystem — every `.native.ts(x)` in
 * the apps, and every module of the native-only mobile app — and the reader is proven against a fixture table first.
 *
 * ✅ THE FIX FOR A FAILURE: delete the `fontWeight`, or pick the face for the weight you meant
 * (`nativeTokens.fontFace.display.semibold`), or use a type role.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

/** A spread that names a face: a type role (`nativeTokens.type.label`, `type.body`, `nativeType.caption`). */
const TYPE_ROLE_SPREAD = /(?:^|\.)(?:type|nativeType)\.[A-Za-z]+/u;

/** The name of a property assignment, when it is a plain identifier or string key. */
function keyOf(property: ts.ObjectLiteralElementLike): string | undefined {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        return undefined;
    }

    const { name } = property;

    return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/**
 * The 1-based lines of every object literal that both names a face and sets `fontWeight`. Pure.
 *
 * @param source - The module's text.
 * @param fileName - Its name, which decides whether it is parsed as TSX.
 * @returns The offending lines, in source order.
 */
function faceWithWeightLines(source: string, fileName: string): readonly number[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const lines: number[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node)) {
            const keys = node.properties.map(keyOf);
            const namesFace =
                keys.includes('fontFamily') ||
                node.properties.some(
                    (property) =>
                        ts.isSpreadAssignment(property) && TYPE_ROLE_SPREAD.test(property.expression.getText(file)),
                );

            if (namesFace && keys.includes('fontWeight')) {
                lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return lines;
}

describe('the face-with-weight reader', () => {
    const cases: readonly { readonly shape: string; readonly source: string; readonly lines: readonly number[] }[] = [
        { shape: 'a face and a weight', source: `const s = { fontFamily: FACE, fontWeight: '700' };`, lines: [1] },
        { shape: 'a string-keyed weight', source: `const s = { fontFamily: FACE, 'fontWeight': '600' };`, lines: [1] },
        {
            shape: 'a type role spread and a weight',
            source: `const s = { ...nativeTokens.type.label, fontWeight: '700' };`,
            lines: [1],
        },
        {
            shape: 'a bare role spread and a weight',
            source: `const s = { ...type.body, fontWeight: 'bold' };`,
            lines: [1],
        },
        {
            shape: 'a nested style',
            source: `const s = StyleSheet.create({\n  a: { color: C },\n  b: { fontFamily: F, fontWeight: '700' },\n});`,
            lines: [3],
        },
        { shape: 'a weight alone', source: `const s = { fontWeight: '700', fontSize: 14 };`, lines: [] },
        { shape: 'a face alone', source: `const s = { fontFamily: FACE, fontSize: 14 };`, lines: [] },
        { shape: 'a role spread alone', source: `const s = { ...nativeTokens.type.label, color: C };`, lines: [] },
        { shape: 'a non-role spread and a weight', source: `const s = { ...base, fontWeight: '700' };`, lines: [] },
        { shape: 'the keys in a comment', source: `// { fontFamily: F, fontWeight: '700' }\nconst s = {};`, lines: [] },
        { shape: 'the keys in a string', source: `const s = "{ fontFamily: F, fontWeight: '700' }";`, lines: [] },
        {
            shape: 'the keys split over sibling objects',
            source: `const s = [{ fontFamily: F }, { fontWeight: '700' }];`,
            lines: [],
        },
    ];

    for (const { shape, source, lines } of cases) {
        it(`reads ${shape}`, () => {
            expect(faceWithWeightLines(source, 'fixture.tsx')).toEqual(lines);
        });
    }
});

/** Every native-rendered app module: `.native.*` anywhere in the apps, and all of the mobile app. */
const nativeModules = (): readonly string[] =>
    [
        ...globSync('packages/apps/**/*.native.{ts,tsx}', {
            cwd: repoRoot,
            ignore: ['**/node_modules/**', '**/dist/**', '**/.expo/**', '**/android/**', '**/ios/**'],
        }),
        ...globSync('packages/apps/commise/mobile/{src,app}/**/*.{ts,tsx}', {
            cwd: repoRoot,
            ignore: ['**/node_modules/**'],
        }),
    ]
        .filter((file, index, all) => all.indexOf(file) === index)
        .sort();

describe('native faces carry their own weight', () => {
    it('discovers the native modules, including the Home greeting (a vacuous pass would hide the rule)', () => {
        expect(nativeModules()).toContain('packages/apps/commise/mobile/src/components/home/HomeGreeting.tsx');
        expect(nativeModules()).toContain('packages/apps/commise/ui/src/button/Button.native.tsx');
    });

    it('lets no native style name a face and also set fontWeight', () => {
        const offenders = nativeModules().flatMap((file) =>
            faceWithWeightLines(readFileSync(path.join(repoRoot, file), 'utf8'), file).map((line) => `${file}:${line}`),
        );

        expect(offenders).toEqual([]);
    });
});
