/**
 * Every native vitest lane aliases the Tamagui animation driver to the shared test shim.
 *
 * ⛔ WHY. The config names `@tamagui/animations-react-native`, whose web entry THROWS at `createAnimations` (a device is
 * the only place it runs). A native lane runs Tamagui's web build, so any lane that loads the config without the alias
 * fails at import, and the failure shows up in whichever package was not run before the merge. The shim is one file in
 * the design system (`@commise/ui/testing/animations-shim`); each lane points the driver name at it.
 *
 * ⛔ IT ENUMERATES NOTHING. A lane is any `vitest*native*.config.ts` that aliases `react-native-web`, found by glob, and
 * the alias is read from the parsed config, so a comment that mentions the driver does not count.
 *
 * ✅ THE FIX FOR A FAILURE: add `'@tamagui/animations-react-native': fileURLToPath(import.meta.resolve('@commise/ui/testing/animations-shim'))`
 * to the lane's `resolve.alias`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const DRIVER = '@tamagui/animations-react-native';

/** The string keys of every object literal assigned to a property named `alias`. Pure. */
export function aliasKeys(source: string): readonly string[] {
    const file = ts.createSourceFile('lane.config.ts', source, ts.ScriptTarget.Latest, true);
    const keys: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            ts.isPropertyAssignment(node) &&
            (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
            node.name.text === 'alias' &&
            ts.isObjectLiteralExpression(node.initializer)
        ) {
            for (const property of node.initializer.properties) {
                if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name)) {
                    keys.push(property.name.text);
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return keys;
}

/** Whether a lane aliases `react-native-web` and so loads Tamagui's web build. Pure. */
export const isNativeLane = (source: string): boolean => aliasKeys(source).includes('react-native');

/** Whether a lane aliases the driver. Pure. */
export const aliasesDriver = (source: string): boolean => aliasKeys(source).includes(DRIVER);

const lanes = (): readonly string[] =>
    globSync('packages/**/vitest*native*.config.ts', { cwd: repoRoot, ignore: ['**/node_modules/**'] }).sort();

describe('the lane readers', () => {
    it.each([
        [
            'a lane with both aliases',
            `export default { resolve: { alias: { 'react-native': 'rnw', '${DRIVER}': 'shim' } } };`,
            true,
            true,
        ],
        [
            'a lane with only react-native',
            `export default { resolve: { alias: { 'react-native': 'rnw' } } };`,
            true,
            false,
        ],
        ['a config that is not a native lane', `export default { resolve: { alias: { other: 'x' } } };`, false, false],
        [
            'the driver named only in a comment',
            `// ${DRIVER}\nexport default { resolve: { alias: { 'react-native': 'rnw' } } };`,
            true,
            false,
        ],
        [
            'the driver named only in a string value',
            `export default { resolve: { alias: { 'react-native': '${DRIVER}' } } };`,
            true,
            false,
        ],
        [
            'an alias that is not under a property named alias',
            `export default { define: { '${DRIVER}': 1, 'react-native': 2 } };`,
            false,
            false,
        ],
    ] as const)('%s', (_shape, source, native, driver) => {
        expect(isNativeLane(source)).toBe(native);
        expect(aliasesDriver(source)).toBe(driver);
    });
});

describe('every native vitest lane aliases the Tamagui animation driver', () => {
    it('discovers the lanes (a vacuous pass would hide the rule)', () => {
        expect(lanes().length).toBeGreaterThan(1);
        expect(
            lanes().filter((file) => isNativeLane(readFileSync(path.join(repoRoot, file), 'utf8'))).length,
        ).toBeGreaterThan(1);
    });

    it('finds no lane without the alias', () => {
        const missing = lanes().filter((file) => {
            const source = readFileSync(path.join(repoRoot, file), 'utf8');

            return isNativeLane(source) && !aliasesDriver(source);
        });

        expect(missing).toEqual([]);
    });
});
