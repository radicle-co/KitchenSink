/**
 * A native hit target gets its floor from `touchFloor()` (`@commise/ui/layout`): 44 pt on iOS and 48 dp on Android
 * (`componentFixes.md` §1.6). A literal `44` in a native style is the iOS number alone, so the same control is 4 dp short
 * on Android, and a second copy of the platform ternary (`UndoSnackbar`'s `actionTarget`) is the same knowledge written
 * twice (DRY: one authoritative representation).
 *
 * Refused in `.native.ts(x)` app code, read with the TypeScript parser:
 *  - a `minHeight` or `minWidth` property whose value is the literal `44`;
 *  - an object literal that gives BOTH `width` and `height` the literal `44` (a square hit target);
 *  - the platform ternary `… ? 48 : 44`, which is `touchFloor()` re-spelled.
 *
 * Not refused: a lone `height: 44` (a bar or skeleton, not a hit target), `44` in a comment, and `touchFloor.native.ts`
 * itself, which is where the number is written.
 *
 * ⛔ NO BASELINE AND NO ALLOW-LIST. SCOPE: `packages/apps/**` TypeScript minus tests and fixtures (`appSources.ts`).
 *
 * @pattern Fitness Function over the source of every app
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { appSourceModules, parseModule } from './appSources.js';
import { repoRoot } from './serviceSources.js';

/** The one module that writes the floor. */
const FLOOR_MODULE = 'packages/apps/commise/ui/src/layout/touchFloor.native.ts';

/** The iOS floor, in points. */
const IOS_FLOOR = 44;

/** Whether an expression is the numeric literal `value`. */
const isNumber = (node: ts.Expression, value: number): boolean =>
    ts.isNumericLiteral(node) && Number(node.text) === value;

/** The property name of an assignment, if it is a plain name. */
const nameOf = (node: ts.PropertyAssignment): string | undefined =>
    ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;

/**
 * The 1-based line of every hard-coded 44 hit target in a module. Pure.
 *
 * @param fileName - The module's name.
 * @param source - Its text.
 */
export function literalTouchFloors(fileName: string, source: string): readonly { readonly line: number }[] {
    const file = parseModule(fileName, source);
    const hits: { line: number }[] = [];

    const report = (node: ts.Node): void => {
        hits.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
    };

    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAssignment(node)) {
            const name = nameOf(node);

            if ((name === 'minHeight' || name === 'minWidth') && isNumber(node.initializer, IOS_FLOOR)) {
                report(node);
            }
        } else if (ts.isObjectLiteralExpression(node)) {
            const sized = (key: string): boolean =>
                node.properties.some(
                    (property) =>
                        ts.isPropertyAssignment(property) &&
                        nameOf(property) === key &&
                        isNumber(property.initializer, IOS_FLOOR),
                );

            if (sized('width') && sized('height')) {
                report(node);
            }
        } else if (
            ts.isConditionalExpression(node) &&
            isNumber(node.whenTrue, 48) &&
            isNumber(node.whenFalse, IOS_FLOOR)
        ) {
            report(node);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    // A node reported by two readings (a pair of properties) is one site.
    return hits.filter((hit, at) => hits.findIndex((other) => other.line === hit.line) === at);
}

describe('the literal touch-floor reader', () => {
    const cases: readonly { readonly shape: string; readonly source: string; readonly lines: readonly number[] }[] = [
        { shape: 'a minHeight of 44', source: `const s = { minHeight: 44 };`, lines: [1] },
        { shape: 'a minWidth of 44', source: `const s = { minWidth: 44, alignItems: 'center' };`, lines: [1] },
        { shape: 'a square 44', source: `const s = { width: 44, height: 44 };`, lines: [1] },
        { shape: 'the platform ternary', source: `const f = () => (Platform.OS === 'android' ? 48 : 44);`, lines: [1] },
        {
            shape: 'a style sheet entry',
            source: `const s = StyleSheet.create({\n row: { minHeight: 44 },\n});`,
            lines: [2],
        },
        { shape: 'touchFloor()', source: `const s = { minHeight: touchFloor(), minWidth: touchFloor() };`, lines: [] },
        { shape: 'a lone height of 44', source: `const s = { height: 44, width: '50%' };`, lines: [] },
        { shape: 'a minHeight of 48', source: `const s = { minHeight: 48 };`, lines: [] },
        { shape: 'a 44 in a comment', source: `// minHeight: 44\nconst s = {};`, lines: [] },
        { shape: 'a width of 44 beside a height of 32', source: `const s = { width: 44, height: 32 };`, lines: [] },
    ];

    for (const { shape, source, lines } of cases) {
        it(`reads ${shape}`, () => {
            expect(literalTouchFloors('fixture.native.tsx', source).map((hit) => hit.line)).toEqual(lines);
        });
    }
});

describe('native app code takes its hit-target floor from touchFloor()', () => {
    const modules = appSourceModules().filter((file) => /\.native\.tsx?$/u.test(file));

    it('reads the native modules, the layout module among them (a vacuous pass would hide the rule)', () => {
        expect(modules).toContain(FLOOR_MODULE);
        expect(modules.length).toBeGreaterThan(200);
    });

    it('lets no native module hard-code the iOS floor', () => {
        const offenders = modules
            .filter((file) => file !== FLOOR_MODULE)
            .flatMap((file) =>
                literalTouchFloors(file, readFileSync(path.join(repoRoot, file), 'utf8')).map(
                    (hit) => `${file}:${String(hit.line)}`,
                ),
            );

        expect(offenders).toEqual([]);
    });
});
