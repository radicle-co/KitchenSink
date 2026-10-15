// @vitest-environment node
/**
 * Repo-wide guard: `superuser`'s scopes are EXACTLY the scopes the services check, and `admin`'s are among them
 * (plan `docs/plans/2026-10-14-009-feat-roles-and-paid-gate-plan.md` D4; owner ruling 2026-10-13: "superuser → all
 * scopes").
 *
 * `ROLE_SCOPES` (`@kitchensink/clerk-verify/roles`) names scope literals the services OWN — identity's
 * `@RequireScopes('admin:users')`, food's `FOOD_ADMIN_SCOPE`, recipe's three curator scopes. A copy of a list cannot
 * detect that the list is incomplete, so the set the services check is DISCOVERED from their source, never written
 * down here, and compared in BOTH directions:
 *
 * - a new scope a service starts checking that superuser lacks fails (superuser would silently lose a power);
 * - a scope superuser carries that no service checks fails (a grant with no meaning, or a renamed literal left behind).
 *
 * ## The shapes a scope check takes (read from the TypeScript AST of every non-test service source)
 *
 * - a string argument to `RequireScopes(...)`;
 * - a `const` whose name ends in `_SCOPE` and whose initializer is a string literal;
 * - a string argument to `hasScope(...)`;
 * - a string argument to `<…>scopes.includes(...)`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ROLE_SCOPES } from '@kitchensink/clerk-verify/roles';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { isInfraFile, isTestFile, parse, presentFiles, repoRoot, visit, type SourceFile } from './serviceSources.js';

/** Every scope literal one file checks, by the four shapes above. Pure. */
function checkedScopes(source: SourceFile): readonly string[] {
    const found: string[] = [];
    const literalArguments = (call: ts.CallExpression): void => {
        for (const argument of call.arguments) {
            if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
                found.push(argument.text);
            }
        }
    };

    const tree = parse(source);

    visit(tree, (node) => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression;

            if (ts.isIdentifier(callee) && (callee.text === 'RequireScopes' || callee.text === 'hasScope')) {
                literalArguments(node);
            }

            if (
                ts.isPropertyAccessExpression(callee) &&
                callee.name.text === 'includes' &&
                /scopes$/u.test(callee.expression.getText(tree))
            ) {
                literalArguments(node);
            }
        }

        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text.endsWith('_SCOPE') &&
            node.initializer !== undefined &&
            (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
        ) {
            found.push(node.initializer.text);
        }
    });

    return found;
}

/** Every scope literal the services' production sources check. */
function discoveredScopes(): ReadonlySet<string> {
    const files = presentFiles(['packages/services/*/src/**/*.ts']).filter(
        (file) => !isTestFile(file) && !isInfraFile(file),
    );

    return new Set(
        files.flatMap((file) => checkedScopes({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') })),
    );
}

describe('the scope-check matcher (fixture table over every shape, and what it must not read)', () => {
    it.each([
        ['a RequireScopes decorator', "@RequireScopes('admin:users')\nclass A {}", ['admin:users']],
        ['a _SCOPE constant', "export const FOOD_ADMIN_SCOPE = 'food:admin';", ['food:admin']],
        ['a hasScope call', "if (hasScope(principal, 'x:y')) {}", ['x:y']],
        ['a scopes.includes call', "principal.scopes.includes('a:b');", ['a:b']],
        ['a comment naming a scope', "// @RequireScopes('ghost:scope')", []],
        ['a string that is not a scope check', "const label = 'admin:users';", []],
        ['an includes on something that is not scopes', "tags.includes('admin:users');", []],
    ] as const)('%s', (_label, contents, expected) => {
        expect(checkedScopes({ file: 'fixture.ts', contents })).toStrictEqual(expected);
    });
});

describe('ROLE_SCOPES against the scopes the services check', () => {
    const discovered = discoveredScopes();

    it('finds the services’ scope checks (non-vacuity)', () => {
        expect(discovered.size).toBeGreaterThanOrEqual(5);
    });

    it('⛔ superuser holds EXACTLY every scope a service checks', () => {
        expect(new Set(ROLE_SCOPES.superuser)).toStrictEqual(discovered);
    });

    it('admin holds only scopes a service checks', () => {
        for (const scope of ROLE_SCOPES.admin) {
            expect(discovered.has(scope), scope).toBe(true);
        }
    });
});
