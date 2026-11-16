// @vitest-environment node
/**
 * Repo-wide guard: the Public confirmation wording that API writers send (`PUBLIC_CONFIRMATION_FOR_API_WRITERS`) is
 * imported only by code that is not a screen or a client of a screen.
 *
 * ⛔ WHY THIS IS A GUARD. A wording may be sent only when a screen actually showed it: the version is the client's word that
 * the cook saw that line. The constant exists so seeds, tests and load scripts, which show nothing to anyone, can still
 * write a public recipe. A client library or an editor that imported it would send "the cook confirmed" for a cook who was
 * never asked, and every test would stay green, because the server accepts the wording. Two such stand-ins shipped before
 * this guard (the recipe-service client and the editor's wire builders), so the rule is held by a check and not by a note.
 *
 * ⛔ THE FILE IS READ WITH THE TYPESCRIPT PARSER. A comment is not a node, so a doc that names the constant is not a use,
 * and a renamed import, a re-export, a namespace member and an element access are all found by the identifier or the string
 * they must still spell. No comment-stripping text pass is involved.
 *
 * ✅ THE FIX FOR A FAILURE: take the confirmation as an input from the screen that shows the line, and send what you are
 * given. Only a seed, a test or a load script may use the constant.
 *
 * @pattern Fitness Function over the source of every script, test and app file
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import picomatch from 'picomatch';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot, visit } from './serviceSources.js';

const CONSTANT = 'PUBLIC_CONFIRMATION_FOR_API_WRITERS';

/** Where the constant may be named: tooling (the k6 load scripts among it), test code, and `recipe-core`, which defines it. */
const ALLOWED = picomatch([
    'packages/tools/**',
    'packages/services/**/tests/**',
    '**/__tests__/**',
    '**/tests/**',
    'packages/shared/recipe-core/**',
]);

/**
 * Every place a source file spells the constant: an identifier (import, re-export, member access, use) or a string (an
 * element access, a dynamic import's key). Pure.
 *
 * @param source - The file's text.
 * @param fileName - Its name, which decides whether it is read as TSX.
 * @returns One line per use, with its line number.
 */
function constantUses(source: string, fileName: string): readonly string[] {
    const kind = /\.[cm]?jsx?$/u.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TSX;
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
    const uses: string[] = [];

    visit(file, (node) => {
        const spelled =
            (ts.isIdentifier(node) && node.text === CONSTANT) ||
            ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === CONSTANT);

        if (spelled) {
            uses.push(`line ${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`);
        }
    });

    return uses;
}

/** The files outside the allowed places that spell the constant. */
const offenders = (): readonly string[] =>
    presentFiles(['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs'])
        .filter((file) => !ALLOWED(file))
        .flatMap((file) =>
            constantUses(readFileSync(path.join(repoRoot, file), 'utf8'), file).map((use) => `${file}: ${use}`),
        );

describe('the API writers’ Public confirmation is named only by seeds, tests and load scripts', () => {
    it.each([
        ['an import', `import { ${CONSTANT} } from '@kitchensink/recipe-core';`],
        ['a renamed import', `import { ${CONSTANT} as CONFIRM } from '@kitchensink/recipe-core';`],
        ['a re-export', `export { ${CONSTANT} } from '@kitchensink/recipe-core';`],
        ['a namespace member', `import * as core from 'x'; const c = core.${CONSTANT};`],
        ['an element access', `import * as core from 'x'; const c = core['${CONSTANT}'];`],
    ])('reads %s as a use', (_name, source) => {
        expect(constantUses(source, 'a.ts')).not.toHaveLength(0);
    });

    it('does not read a comment or an unrelated name as a use', () => {
        const source = `// ${CONSTANT}\n/** ${CONSTANT} */\nconst PUBLIC_CONFIRMATION = 1; // https://x/${CONSTANT}\n`;

        expect(constantUses(source, 'a.ts')).toEqual([]);
    });

    it('allows the places that show nothing to anyone, and no screen or client', () => {
        expect(ALLOWED('packages/tools/e2e-seed/src/recipeWorld.ts')).toBe(true);
        expect(ALLOWED('packages/tools/loadtest/k6/session.js')).toBe(true);
        expect(ALLOWED('packages/services/recipe-service/tests/e2e/a.e2e.test.ts')).toBe(true);
        expect(ALLOWED('packages/services/recipe-service/__tests__/integration/a.test.ts')).toBe(true);
        expect(ALLOWED('packages/shared/recipe-core/src/statementWordings.ts')).toBe(true);
        expect(ALLOWED('packages/clients/recipe-service/src/client.ts')).toBe(false);
        expect(ALLOWED('packages/apps/commise/features/recipes/src/form/wire.ts')).toBe(false);
        expect(ALLOWED('packages/services/recipe-service/src/recipes/recipes.service.ts')).toBe(false);
    });

    it('finds the constant where it is defined, so the scan reads real files', () => {
        const defined = 'packages/shared/recipe-core/src/statementWordings.ts';

        expect(constantUses(readFileSync(path.join(repoRoot, defined), 'utf8'), defined)).not.toHaveLength(0);
    });

    it('is named nowhere else', () => {
        expect(offenders()).toEqual([]);
    });
});
