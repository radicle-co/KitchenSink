// @vitest-environment node
/**
 * Repo-wide guard: EVERY CDK app stamps the commit it was built from.
 *
 * ## The failure this pins
 *
 * `docs/architecture/2026-08-28-ingredient-pipeline-state.md` §1 claimed `verifyLine` and thirteen other
 * handlers were deployed. Measured against the account: `kitchensink-recipe-workers-prod` held SIX Lambdas
 * and had last been updated on 2026-08-02, with the branch 600+ commits ahead. The table was wrong, but the
 * table is not the defect — **nothing recorded which commit produced a deployed stack**, so no mechanism
 * could have noticed. A document generated from the CDK source would have made the same claim, because CDK
 * describes INTENT and only the account holds REALITY.
 *
 * `stampCommitProvenance` closes that, and it is only closed for the apps that CALL it. An app that lands
 * tomorrow without the call would deploy stacks whose age is unknowable again — silently, since every other
 * check it passes is about the stack rather than about the commit behind it.
 *
 * ## Why the app set is DISCOVERED
 *
 * "A copy of a list cannot detect that the list is incomplete" (ADR-0025 §3, on the handle-sync-worker
 * outage). The apps come from {@link cdkApps}, which finds them by CONTENT — any tracked `bin/app.ts` that
 * constructs a CDK `App` — the same derivation `cdkAppDeployCoverage.test.ts` and
 * `deployVerificationCoverage.test.ts` already share. A new app is covered the day it is committed and
 * cannot opt out by not being mentioned here.
 *
 * ## Why the call is read from the AST and not by `includes`
 *
 * The call is also NAMED in prose: this suite's own subject appears in each entrypoint's explanatory comment
 * ("A stack tag, never `Tags.of(app)`…"), and a textual gate that accepts a comment as evidence would pass an
 * app whose only mention of the stamp is the paragraph explaining it. Parsing means a call is a call. Same
 * reasoning as `serviceSources.ts`'s docstring on why the guards use the TypeScript parser.
 *
 * ## Mutation evidence
 *
 * Run against the tree with the call removed from `packages/apps/commise/web/infra/bin/app.ts`: fails,
 * naming that file. Run with the call replaced by the comment alone: fails. Run with the argument changed
 * from `app` to another identifier: fails.
 *
 * DESIGN PATTERN: Specification module over a derived set — the same shape as `natEgressConsumers.test.ts`
 * and `cdkAppDeployCoverage.test.ts`, asserted by set equality in both directions so neither side can shrink
 * quietly.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { cdkApps } from './cdkApps.js';
import { repoRoot, visit } from './serviceSources.js';

/** The stamp every CDK app must issue. Named once; every assertion below derives from it. */
const STAMP = 'stampCommitProvenance';

/** The package that owns it — the one package every entrypoint already depends on. */
const STAMP_MODULE = '@kitchensink/infra-security';

/**
 * Whether a source file CALLS `stampCommitProvenance(app)` on the `App` it constructs.
 *
 * Three things are required together, and each rules out a real way of being wrong:
 *   - the call exists as a call (not as prose, not as an import that is never used);
 *   - its first argument is the identifier bound to `new App(...)`, so an app cannot stamp some other tree;
 *   - the symbol is imported from the owning package, so a local shim of the same name is not evidence.
 *
 * @param source - The entrypoint's text.
 * @param file - Its path, for the parser's diagnostics.
 * @returns True when the file stamps the app it builds. Pure.
 */
export function stampsCommitProvenance(source: string, file: string): boolean {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    let importsStamp = false;
    let appBinding: string | undefined;
    const stampedIdentifiers = new Set<string>();

    visit(parsed, (node) => {
        if (
            ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier) &&
            node.moduleSpecifier.text === STAMP_MODULE
        ) {
            const bindings = node.importClause?.namedBindings;

            if (bindings !== undefined && ts.isNamedImports(bindings)) {
                importsStamp ||= bindings.elements.some((element) => element.name.text === STAMP);
            }
        }

        // `const app = new App();` — the identifier the entrypoint binds its app to.
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined &&
            ts.isNewExpression(node.initializer) &&
            ts.isIdentifier(node.initializer.expression) &&
            node.initializer.expression.text === 'App'
        ) {
            appBinding = node.name.text;
        }

        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === STAMP) {
            const [first] = node.arguments;

            if (first !== undefined && ts.isIdentifier(first)) {
                stampedIdentifiers.add(first.text);
            }
        }
    });

    return importsStamp && appBinding !== undefined && stampedIdentifiers.has(appBinding);
}

const apps = cdkApps();

describe('every CDK app stamps its commit provenance', () => {
    it('discovers the apps rather than listing them, and finds some', () => {
        // Non-vacuity. A discovery that returned nothing would make every assertion below pass having looked
        // at no app at all — the state this repository has been bitten by three times.
        expect(apps.length).toBeGreaterThan(5);
    });

    it.each(apps)('%s calls stampCommitProvenance on the App it constructs', (app) => {
        expect(stampsCommitProvenance(readFileSync(path.join(repoRoot, app), 'utf8'), app)).toBe(true);
    });

    it('covers every app, stated as one set so a gap names the file', () => {
        const missing = apps.filter(
            (app) => !stampsCommitProvenance(readFileSync(path.join(repoRoot, app), 'utf8'), app),
        );

        expect(missing).toEqual([]);
    });
});

describe('the reader can tell a call from a mention', () => {
    const header = `import { attachSecurityChecks, ${STAMP} } from '${STAMP_MODULE}';\nconst app = new App();\n`;

    it('accepts the real shape', () => {
        expect(stampsCommitProvenance(`${header}${STAMP}(app);\n`, 'fake.ts')).toBe(true);
    });

    it('rejects a file that only NAMES the stamp in a comment', () => {
        // The shape every real entrypoint carries in its explanatory paragraph, which is why an `includes`
        // check would pass an app that never stamps anything.
        expect(stampsCommitProvenance(`${header}// call ${STAMP}(app) here one day\n`, 'fake.ts')).toBe(false);
    });

    it('rejects a stamp applied to something other than the App', () => {
        expect(stampsCommitProvenance(`${header}const other = 1;\n${STAMP}(other);\n`, 'fake.ts')).toBe(false);
    });

    it('rejects a local function that merely shares the name', () => {
        expect(
            stampsCommitProvenance(`const app = new App();\nfunction ${STAMP}(a) {}\n${STAMP}(app);\n`, 'fake.ts'),
        ).toBe(false);
    });

    it('rejects an import with no call', () => {
        expect(stampsCommitProvenance(header, 'fake.ts')).toBe(false);
    });
});
