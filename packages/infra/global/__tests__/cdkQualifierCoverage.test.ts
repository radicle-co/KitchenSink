/**
 * Repo-wide guard: EVERY stage CDK app builds its `App` from `kitchenSinkAppProps(stage)`.
 *
 * | Invariant                                                                   | Test                                              |
 * | --------------------------------------------------------------------------- | ------------------------------------------------- |
 * | Discovery finds the apps (the walk itself is not broken)                      | 'discovers every stage app and the account app'    |
 * | Each stage app constructs `new App(kitchenSinkAppProps(<stage>))`              | 'builds its App from kitchenSinkAppProps'          |
 * | …with a stage read through `resolveStage`, the same sources the apps always used | 'reads the stage it passes through resolveStage' |
 * | No stage app names a qualifier or a synthesizer of its own                    | 'carries no qualifier literal of its own'          |
 * | The account app is the ONE named exception and does not use the helper         | 'the account app stays off the stage helper'       |
 * | The predicate can fail                                                        | negative-control fixtures                          |
 *
 * WHY. The default `new App()` deploys through the account's DEFAULT bootstrap, whose execution role is another
 * application's `AdministratorAccess`. An app that forgets the helper does not fail; it deploys, with more
 * privilege than any CI role should reach. Nothing else would notice, so a guard has to.
 *
 * WHY the TypeScript AST and not a regex: a commented-out or stringified `kitchenSinkAppProps(stage)` must not
 * satisfy it (the first `cdkNagAttachment` guard matched text and a commented call still passed).
 *
 * WHY discovery: a hard-coded list passes forever while a new app lands without the helper. Discovery is by
 * content (`new App(`) through `cdkApps()`, as every other app guard does, and the known set is pinned too so a
 * broken walk that finds nothing cannot pass.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { cdkApps } from './cdkApps.js';
import { parse, repoRoot, visit } from './serviceSources.js';

/** The ONE entrypoint exempt from the helper: stage-less, deployed through its own qualifier (slice B). */
const ACCOUNT_APP = 'packages/infra/global/bin/account.ts';

const HELPER_MODULE = '@kitchensink/cdk-bootstrap/appProps';

/** The qualifier spellings no stage app may carry: they belong to `qualifiers.ts` alone. */
const QUALIFIER_LITERALS = /^(?:ksnonprod|ksprod|ksaccount|hnb659fds)$/u;

/** Context keys and props that choose a qualifier or synthesizer; only the helper may set them. */
const QUALIFIER_KEYS = /bootstrapQualifier|defaultStackSynthesizer|DefaultStackSynthesizer|permissionsBoundary/iu;

const KNOWN_STAGE_APPS = [
    'packages/apps/commise/web/infra/bin/app.ts',
    'packages/infra/global/bin/app.ts',
    'packages/services/food-service/infra/bin/app.ts',
    'packages/services/identity-webhooks/infra/bin/app.ts',
    'packages/services/identity/infra/bin/app.ts',
    'packages/services/ingredient-parser/infra/bin/app.ts',
    'packages/services/recipe-service/infra/bin/app.ts',
    'packages/services/recipe-workers/infra/bin/app.ts',
    'packages/services/remote-search/infra/bin/app.ts',
] as const;

/**
 * Every way an app source departs from "builds its App from the helper".
 *
 * @param file - Path, for the parser only.
 * @param contents - The entrypoint's text.
 * @returns One message per violation; empty when the app is wired correctly. Pure.
 */
function qualifierViolations(file: string, contents: string): readonly string[] {
    const source = parse({ file, contents });
    const violations: string[] = [];
    let importsHelper = false;
    const resolveStageTargets = new Set<string>();
    const appStageArguments: string[] = [];
    let appConstructions = 0;

    visit(source, (node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const bindings = node.importClause?.namedBindings;

            if (
                node.moduleSpecifier.text === HELPER_MODULE &&
                bindings !== undefined &&
                ts.isNamedImports(bindings) &&
                bindings.elements.some((element) => element.name.text === 'kitchenSinkAppProps')
            ) {
                importsHelper = true;
            }
        }

        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
            let calls = false;

            visit(node.initializer, (inner) => {
                if (
                    ts.isCallExpression(inner) &&
                    ts.isIdentifier(inner.expression) &&
                    inner.expression.text === 'resolveStage'
                ) {
                    calls = true;
                }
            });

            if (calls) {
                resolveStageTargets.add(node.name.text);
            }
        }

        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'App') {
            appConstructions += 1;
            const [argument, ...rest] = node.arguments ?? [];

            if (
                argument !== undefined &&
                rest.length === 0 &&
                ts.isCallExpression(argument) &&
                ts.isIdentifier(argument.expression) &&
                argument.expression.text === 'kitchenSinkAppProps' &&
                argument.arguments.length === 1 &&
                ts.isIdentifier(argument.arguments[0]!)
            ) {
                appStageArguments.push((argument.arguments[0] as ts.Identifier).text);
            }
        }

        if (ts.isStringLiteralLike(node) && (QUALIFIER_LITERALS.test(node.text) || QUALIFIER_KEYS.test(node.text))) {
            violations.push(`names the qualifier/synthesizer '${node.text}' itself`);
        }

        if (ts.isIdentifier(node) && node.text === 'DefaultStackSynthesizer') {
            violations.push('uses DefaultStackSynthesizer directly');
        }

        if (ts.isPropertyAssignment(node) && QUALIFIER_KEYS.test(node.name.getText(source))) {
            violations.push(`sets '${node.name.getText(source)}' itself`);
        }
    });

    const resolvesStage = appStageArguments.length > 0 && appStageArguments.every((name) => resolveStageTargets.has(name));

    if (appConstructions === 0) {
        violations.push('constructs no App at all');
    } else if (appStageArguments.length !== appConstructions) {
        violations.push('constructs an App that is not `new App(kitchenSinkAppProps(<stage>))`');
    }

    if (!importsHelper) {
        violations.push(`does not import kitchenSinkAppProps from ${HELPER_MODULE}`);
    }

    if (appStageArguments.length > 0 && !resolvesStage) {
        violations.push('passes a stage that is not read through resolveStage(process.env)');
    }

    return violations;
}

const read = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');

const apps = cdkApps();
const stageApps = apps.filter((app) => app !== ACCOUNT_APP);

describe('every stage CDK app is built from kitchenSinkAppProps', () => {
    it('discovers every stage app and the account app', () => {
        // If the walk breaks, every per-app assertion below passes vacuously — so pin the set.
        expect(stageApps).toEqual(KNOWN_STAGE_APPS);
        expect(apps).toContain(ACCOUNT_APP);
    });

    it.each(stageApps.map((app) => [app] as const))('%s builds its App from kitchenSinkAppProps', (app) => {
        expect(qualifierViolations(app, read(app))).toEqual([]);
    });

    it('the account app stays off the stage helper: it has no stage to choose a qualifier from', () => {
        // Its qualifier is `ksaccount`, wired by its own bootstrap-aware code. Giving it `kitchenSinkAppProps` would
        // need a stage, and `accountScopedInfra.test.ts` forbids it one.
        expect(read(ACCOUNT_APP)).not.toContain(HELPER_MODULE);
    });
});

describe('qualifierViolations (negative controls: the guard can fail)', () => {
    const GOOD = `
        import { App } from 'aws-cdk-lib';
        import { kitchenSinkAppProps, resolveStage } from '@kitchensink/cdk-bootstrap/appProps';
        const stage = resolveStage(process.env) ?? 'dev';
        const app = new App(kitchenSinkAppProps(stage));
    `;

    it('accepts the wiring every app uses', () => {
        expect(qualifierViolations('good.ts', GOOD)).toEqual([]);
    });

    it('rejects a bare new App()', () => {
        expect(
            qualifierViolations('bad.ts', GOOD.replace('new App(kitchenSinkAppProps(stage))', 'new App()')).join('\n'),
        ).toMatch(/not `new App\(kitchenSinkAppProps/u);
    });

    it('rejects an App given its own props alongside the helper', () => {
        expect(
            qualifierViolations(
                'bad.ts',
                GOOD.replace('kitchenSinkAppProps(stage))', '{ ...kitchenSinkAppProps(stage), context: {} })'),
            ).length,
        ).toBeGreaterThan(0);
    });

    it('rejects a helper that is only mentioned in a comment', () => {
        const source = `
            import { App } from 'aws-cdk-lib';
            // import { kitchenSinkAppProps, resolveStage } from '@kitchensink/cdk-bootstrap/appProps';
            // const app = new App(kitchenSinkAppProps(stage));
            const app = new App();
        `;

        expect(qualifierViolations('bad.ts', source).length).toBeGreaterThan(0);
    });

    it('rejects a stage that does not come from resolveStage', () => {
        const source = GOOD.replace('resolveStage(process.env) ?? ', "process.env['STAGE'] ?? ").replace(
            "const stage = process.env['STAGE'] ?? 'dev'",
            "const stage = process.env['STAGE'] ?? 'dev'",
        );

        expect(qualifierViolations('bad.ts', source).join('\n')).toMatch(/resolveStage/u);
    });

    it('rejects a qualifier literal in the app', () => {
        expect(qualifierViolations('bad.ts', `${GOOD}\nconst q = 'ksprod';`).join('\n')).toMatch(/ksprod/u);
        expect(qualifierViolations('bad.ts', `${GOOD}\nconst q = 'hnb659fds';`).join('\n')).toMatch(/hnb659fds/u);
    });

    it('rejects a hand-built synthesizer or boundary', () => {
        const synth = `${GOOD}\nimport { DefaultStackSynthesizer } from 'aws-cdk-lib';`;

        expect(qualifierViolations('bad.ts', synth).join('\n')).toMatch(/DefaultStackSynthesizer/u);
        expect(qualifierViolations('bad.ts', `${GOOD}\nconst p = { permissionsBoundary: 1 };`).join('\n')).toMatch(
            /permissionsBoundary/u,
        );
    });

    it('rejects an app that constructs two Apps and wires one', () => {
        expect(qualifierViolations('bad.ts', `${GOOD}\nconst other = new App();`).length).toBeGreaterThan(0);
    });
});
