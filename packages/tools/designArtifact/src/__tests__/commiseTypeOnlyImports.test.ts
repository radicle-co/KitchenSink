/**
 * The guard behind this package's `paths` aliases into the Commise product tree (`tsconfig.json`): every file the
 * package compiles may reach them with `import type` only. The file set is the parsed tsconfig's own, and the guarded
 * aliases are the `paths` whose target lands under the product tree, so neither is a list kept by hand.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { COMMISE_ROOT, PACKAGE_ROOT } from '../config.js';
import { aliasMatcherOf, valueImportsOfAlias } from '../tsconfig/valueImportsOfAlias.js';

const read = ts.readConfigFile(join(PACKAGE_ROOT, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PACKAGE_ROOT);
const paths = parsed.options.paths ?? {};

/** The `paths` keys with at least one target inside the product tree. */
const productAliases = Object.entries(paths)
    .filter(([, targets]) =>
        targets.some((target) => {
            const resolved = resolve(PACKAGE_ROOT, target);

            return resolved === COMMISE_ROOT || resolved.startsWith(`${COMMISE_ROOT}/`);
        }),
    )
    .map(([key]) => key);

describe('the product-tree path aliases are type-only', () => {
    it('finds the aliases and the files it must scan (a guard that scans nothing passes for the wrong reason)', () => {
        expect(productAliases).toContain('#commise/*');
        expect(parsed.fileNames.length).toBeGreaterThan(50);
        expect(parsed.fileNames.some((file) => file.endsWith('src/cards/cardComponents.ts'))).toBe(true);
    });

    it('guards every `paths` alias, none of which may point outside the product tree unchecked', () => {
        expect(productAliases.sort()).toEqual(Object.keys(paths).sort());
    });

    it('scans every source the compiler reads inside this package, not only what the include globs list', () => {
        // The include globs are a hand-kept list: a file reached only by an import (a card's fixture module) would be
        // compiled and never scanned. The program's own source list is the compiler's, so it cannot disagree with it.
        const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
        const compiled = program
            .getSourceFiles()
            .map(({ fileName }) => fileName)
            .filter((file) => file.startsWith(`${PACKAGE_ROOT}/`) && !file.includes('/node_modules/'));
        const scanned = new Set(parsed.fileNames);

        expect(compiled.filter((file) => !scanned.has(file))).toEqual([]);
    });

    it('is not one-sided: the registry really does import through the alias, with `import type`', () => {
        const registry = readFileSync(join(PACKAGE_ROOT, 'src/cards/cardComponents.ts'), 'utf8');

        expect(registry).toMatch(/^import type \{[^}]*\} from '#commise\//mu);
        expect(valueImportsOfAlias(registry, aliasMatcherOf(productAliases))).toEqual([]);
    });

    it('has no value import through an alias in any compiled source', () => {
        const matcher = aliasMatcherOf(productAliases);
        const offenders = parsed.fileNames.flatMap((file) =>
            valueImportsOfAlias(readFileSync(file, 'utf8'), matcher, file).map((specifier) => `${file}: ${specifier}`),
        );

        expect(offenders).toEqual([]);
    });
});
