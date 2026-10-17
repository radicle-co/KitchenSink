// @vitest-environment node
/**
 * Repo-wide guard: every exported function in a shared package RESOLVES a JSDoc block.
 *
 * ## The class of defect this exists for
 *
 * ⛔ IT IS NOT "SOMEONE FORGOT TO WRITE A DOCSTRING." It is that a docstring can be SILENTLY DETACHED from
 * the thing it documents, by an edit that touches neither. JSDoc binds to the NEAREST preceding comment
 * block, so inserting a constant or a helper between an existing block and its function discards the block
 * outright — it then documents nothing, and the function documents nothing.
 *
 * That happened twice in one commit, in `@kitchensink/observability-scrubbers`, and neither instance was
 * visible to lint, to `tsc`, or to any test:
 *
 *  - `PSEUDONYM_SHAPE` was inserted above `pseudonymizeId`, stranding the only written record of that
 *    function's contract — deterministic but one-way, high-entropy input so the truncated SHA-256 is not
 *    brute-forceable, a keyed HMAC named as the hardening path. That is the GDPR Art. 17 rationale of an
 *    exported crypto helper, in the one package whose whole value is that such reasoning is written down.
 *  - `redactAll` was inserted above `scrubText`, stranding the decision that a ULID in free text is
 *    deliberately NOT matched.
 *
 * ## Why the TypeScript API and not a lint rule
 *
 * ⚠️ `eslint-plugin-jsdoc` is not installed in this repository, and adding a plugin to close one class is a
 * larger change than the class warrants. `ts.getJSDocCommentsAndTags` answers the exact question — does the
 * compiler bind a block to this declaration — which is a stronger check than "is there a comment above it",
 * because a detached block IS a comment above it, three lines up.
 *
 * ⚠️ Scoped to `packages/shared`, deliberately. Those packages are consumed across service boundaries, so
 * their exported surface is the one where a reader has no call site nearby to learn from. Widening this to
 * the services is a bigger decision with a bigger backlog, and `docs/CODING_STANDARDS.md` §8 already
 * requires the block everywhere — this makes it enforceable where it matters most, rather than everywhere
 * at once.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { presentFiles, repoRoot } from './serviceSources.js';

/** Every non-test TypeScript source in a shared package. */
function sharedSources(): readonly string[] {
    return presentFiles(['packages/shared']).filter(
        (file) =>
            file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.includes('__tests__') && !file.includes('/tests/'),
    );
}

/** One exported function and whether the compiler binds a JSDoc block to it. */
interface ExportedFunction {
    readonly key: string;
    readonly documented: boolean;
}

/**
 * Every exported function in a file, with whether its declaration resolves a JSDoc block.
 *
 * @param file - Repo-relative path.
 * @param contents - The file's source.
 * @returns One entry per exported function or arrow-function constant.
 */
function exportedFunctions(file: string, contents: string): readonly ExportedFunction[] {
    const source = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true);
    const found: ExportedFunction[] = [];

    const walk = (node: ts.Node): void => {
        const exported = ts.canHaveModifiers(node)
            ? ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
            : false;

        if (exported === true && ts.isFunctionDeclaration(node) && node.name !== undefined) {
            found.push({
                key: `${file}#${node.name.getText(source)}`,
                documented: ts.getJSDocCommentsAndTags(node).length > 0,
            });
        }

        // ⚠️ The BLOCK is what carries the JSDoc for `export const f = () => …`, not the declaration, so the
        // statement is what must be asked. Asking the declaration reports every arrow constant as undocumented.
        if (exported === true && ts.isVariableStatement(node)) {
            const documented = ts.getJSDocCommentsAndTags(node).length > 0;

            for (const declaration of node.declarationList.declarations) {
                const initializer = declaration.initializer;

                if (
                    initializer !== undefined &&
                    (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
                ) {
                    found.push({ key: `${file}#${declaration.name.getText(source)}`, documented });
                }
            }
        }

        ts.forEachChild(node, walk);
    };

    walk(source);

    return found;
}

describe('every exported function in a shared package resolves a JSDoc block', () => {
    const all = sharedSources().flatMap((file) =>
        exportedFunctions(file, readFileSync(path.join(repoRoot, file), 'utf8')),
    );

    it('⛔ leaves none undocumented, and none detached from its docstring', () => {
        expect(all.filter((entry) => !entry.documented).map((entry) => entry.key)).toEqual([]);
    });

    /** Non-vacuity: a guard that found no exported functions would be green having examined nothing. */
    it('has a real population to check', () => {
        expect(all.length).toBeGreaterThanOrEqual(200);
    });

    describe('the guard actually fires', () => {
        it('⛔ reports a block DETACHED by an inserted constant, not just a missing one', () => {
            // This is the exact shape that shipped: the comment is still there, three lines above, and the
            // compiler binds it to the constant instead. A "is there a comment above" check passes on it.
            const detached = `
                /** The contract of the function below, which no longer resolves it. */
                const SOMETHING = /^x$/;

                export const scrub = (value: string): string => value;
            `;

            expect(exportedFunctions('fake.ts', detached)).toEqual([{ key: 'fake.ts#scrub', documented: false }]);
        });

        it('accepts the same code once the block sits against its function', () => {
            const attached = `
                const SOMETHING = /^x$/;

                /** The contract of the function below. */
                export const scrub = (value: string): string => value;
            `;

            expect(exportedFunctions('fake.ts', attached)).toEqual([{ key: 'fake.ts#scrub', documented: true }]);
        });

        it('⚠️ ignores a NON-exported function — the rule is about the surface others consume', () => {
            expect(exportedFunctions('fake.ts', 'const helper = (): void => {};')).toEqual([]);
        });

        it('covers a `function` declaration as well as an arrow constant', () => {
            expect(exportedFunctions('fake.ts', 'export function bare(): void {}')).toEqual([
                { key: 'fake.ts#bare', documented: false },
            ]);
        });
    });
});
