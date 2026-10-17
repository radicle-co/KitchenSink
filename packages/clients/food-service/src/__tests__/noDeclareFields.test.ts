/**
 * No `declare` class field in this package's sources.
 *
 * The web and mobile apps import this client, and Metro's Babel refuses `declare` on a class field unless
 * `allowDeclareFields` is on, so one such field stops the mobile bundle while `tsc` and vitest stay green. Read through
 * the TypeScript parser, so a comment or a string that says `declare` is not a finding.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/**
 * Every production `.ts` file under `src/`, tests excluded.
 *
 * @param directory - The directory to walk.
 * @returns Absolute paths.
 * @sideEffect Reads the directory tree.
 */
function sourcesUnder(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = join(directory, entry.name);

        if (entry.isDirectory()) {
            return entry.name === '__tests__' || entry.name === '__integration__' ? [] : sourcesUnder(full);
        }

        return entry.name.endsWith('.ts') ? [full] : [];
    });
}

/**
 * The `declare` class fields in one source text. Pure.
 *
 * @param file - The file name, for the parser.
 * @param text - The source.
 * @returns `Class.field` for each.
 */
function declareFields(file: string, text: string): string[] {
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            ts.isPropertyDeclaration(node) &&
            (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
        ) {
            found.push(`${file}: ${node.name.getText()}`);
        }

        ts.forEachChild(node, visit);
    };

    visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));

    return found;
}

describe('no declare class fields (the mobile bundle refuses them)', () => {
    it('finds the field it is looking for, so the scan below is not vacuous', () => {
        expect(declareFields('x.ts', 'class A { declare public readonly x: number; }')).toEqual(['x.ts: x']);
        expect(declareFields('x.ts', '// declare public readonly x\nclass A { public readonly x = 1; }')).toEqual([]);
    });

    it('holds for every source in this package', () => {
        const files = sourcesUnder(SRC);

        expect(files.length).toBeGreaterThan(3);
        expect(files.flatMap((file) => declareFields(file, readFileSync(file, 'utf8')))).toEqual([]);
    });
});
