// @vitest-environment node
/**
 * Repo-wide guard: **every log group a per-PR app declares states what happens to it when its stack is deleted.**
 *
 * ## Why the midnight reclaim needs it (ADR-0061)
 *
 * The reclaim deletes every `kitchensink-<app>-pr-<N>` stack each night, and Sandbox Up rebuilds them. A log group
 * that the CDK leaves at its default `RETAIN` survives that delete. When the group has an explicit
 * `logGroupName`, the rebuild then fails with `AlreadyExists` and the preview never comes back. Two such groups
 * existed (`IngredientParserStack`, `RecipeWorkersStack`); the unnamed ones only leaked a group per night.
 *
 * ## What it reads
 *
 * The apps are DISCOVERED, not listed: an app is per-PR when its CDK entrypoint maps a `pr-` stage to the
 * `${stage}-sandbox` `Environment` tag (the ADR-0005 scheme). A new per-PR service is covered the day it appears.
 * Every `new logs.LogGroup(...)` in that app's `infra/lib` must pass a props object that sets `removalPolicy`, and
 * the value must be able to reach `DESTROY`. Production keeps `RETAIN`, which is why the value is a stage
 * conditional there and not a bare `DESTROY`; `prod` staying `Retain` is asserted by each stack's own test, against
 * the synthesized template.
 *
 * ⚠️ The props may be an identifier (`FoodSchemaStack` shares one `PIPELINE_LOG_GROUP_PROPS`). It is resolved to
 * the `const` in the same file. A props argument that cannot be resolved is reported as UNREADABLE and fails the
 * guard, in the way `logDrainRegister.test.ts` treats an id it cannot read: a guard that skipped what it could not
 * parse would report the tree clean over a group it never saw.
 *
 * ## And the whole template, not only the log groups (ADR-0061 security review, N4)
 *
 * A log group is the one resource that has already broken a rebuild, but it is not the only way a preview can outlive
 * its stack: any `DeletionPolicy: Retain`, and any custom resource (which runs Lambda code on delete that the reclaim
 * cannot unwedge). That is a property of the SYNTHESIZED template, and a template can only be synthesized where the
 * app's own `aws-cdk-lib` resolves, so each per-PR app's infra suite asserts it at `pr-1` for every stack it builds.
 * What THIS file adds is the coverage rule: every stack class a per-PR app constructs must be named by such an
 * assertion. A new stack, or a new per-PR app, cannot opt out by not being mentioned.
 *
 * @pattern Specification — one predicate over the AST of every per-PR log group, fired at hostile fixtures first
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { objectProperties, parse, presentFiles, repoRoot, visit } from './serviceSources.js';

/** The CDK entrypoint of every service, which is where the `Environment` tag scheme is written. */
const BIN_PATTERN = /^packages\/services\/([^/]+)\/infra\/bin\/app\.ts$/u;

/** The ADR-0005 scheme: a `pr-` stage is tagged `${stage}-sandbox`. */
const PER_PR_TAG_SCHEME = /startsWith\('pr-'\)\s*\?\s*`\$\{stage\}-sandbox`/u;

/** One log group that does not state a removal policy that can reach `DESTROY`. */
interface Finding {
    readonly file: string;
    readonly construct: string;
    readonly reason: string;
}

/**
 * The `const NAME = { ... }` object literals declared at the top level of a file.
 *
 * @param source - The parsed file.
 * @returns Name → the object literal it is initialised with. Pure.
 */
function constObjects(source: ts.SourceFile): ReadonlyMap<string, ts.ObjectLiteralExpression> {
    const found = new Map<string, ts.ObjectLiteralExpression>();

    visit(source, (node) => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined &&
            ts.isObjectLiteralExpression(node.initializer)
        ) {
            found.set(node.name.text, node.initializer);
        }
    });

    return found;
}

/**
 * Whether an expression can evaluate to `RemovalPolicy.DESTROY`.
 *
 * @param expression - The `removalPolicy` initializer.
 * @returns `true` when `DESTROY` appears in it. A bare `RETAIN`, `SNAPSHOT` or a variable answers `false`. Pure.
 */
function canReachDestroy(expression: ts.Expression): boolean {
    let reaches = false;

    visit(expression, (node) => {
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'DESTROY') {
            reaches = true;
        }
    });

    return reaches;
}

/**
 * Every log group in one source that does not state a removal policy able to reach `DESTROY`.
 *
 * @param file - The path, for the report.
 * @param contents - The source text.
 * @returns One finding per offending `new logs.LogGroup(...)`. Pure.
 */
function undisposableLogGroups(file: string, contents: string): readonly Finding[] {
    const source = parse({ file, contents });
    const objects = constObjects(source);
    const findings: Finding[] = [];

    visit(source, (node) => {
        if (!ts.isNewExpression(node)) {
            return;
        }

        const callee = node.expression;
        const isLogGroup =
            (ts.isPropertyAccessExpression(callee) && callee.name.text === 'LogGroup') ||
            (ts.isIdentifier(callee) && callee.text === 'LogGroup');

        if (!isLogGroup) {
            return;
        }

        const [, idArgument, propsArgument] = node.arguments ?? [];
        const construct =
            idArgument !== undefined && ts.isStringLiteral(idArgument) ? idArgument.text : '<unreadable id>';

        const report = (reason: string): void => {
            findings.push({ file, construct, reason });
        };

        if (propsArgument === undefined) {
            report('no props at all, so the CDK default RETAIN applies');

            return;
        }

        const props = ts.isObjectLiteralExpression(propsArgument)
            ? propsArgument
            : ts.isIdentifier(propsArgument)
              ? objects.get(propsArgument.text)
              : undefined;

        if (props === undefined) {
            report('UNREADABLE props: not an object literal and not a const object in this file');

            return;
        }

        const policy = objectProperties(props).get('removalPolicy');

        if (policy === undefined) {
            report('no removalPolicy, so the CDK default RETAIN applies');
        } else if (!canReachDestroy(policy)) {
            report('removalPolicy can never be DESTROY');
        }
    });

    return findings;
}

/**
 * The service directories whose CDK app tags a `pr-` stage as `${stage}-sandbox`.
 *
 * @returns Service directory names. Reads the working tree.
 * @sideEffect Shells out to git and reads files.
 */
function perPrServices(): readonly string[] {
    return presentFiles(['packages/services'])
        .flatMap((file) => {
            const match = BIN_PATTERN.exec(file);

            return match !== null && PER_PR_TAG_SCHEME.test(readFileSync(path.join(repoRoot, file), 'utf8'))
                ? [match[1] as string]
                : [];
        })
        .sort();
}

describe('reading a source for a log group that cannot be deleted', () => {
    const wrap = (props: string): string =>
        `import { RemovalPolicy, aws_logs as logs } from 'aws-cdk-lib';\n` +
        `const shared = { removalPolicy: RemovalPolicy.DESTROY };\n` +
        `const bare = { retention: 1 };\n` +
        `new logs.LogGroup(this, 'G', ${props});`;

    it.each([
        ['no props argument', `new logs.LogGroup(this, 'G');`, 1],
        ['props without a removalPolicy', wrap('{ retention: 1 }'), 1],
        ['a bare RETAIN', wrap('{ removalPolicy: RemovalPolicy.RETAIN }'), 1],
        ['a removalPolicy held in a variable', wrap('{ removalPolicy: policy }'), 1],
        ['an identifier that names a const without one', wrap('bare'), 1],
        ['an identifier that cannot be resolved', wrap('importedProps'), 1],
        ['a bare DESTROY', wrap('{ removalPolicy: RemovalPolicy.DESTROY }'), 0],
        [
            'a stage conditional that reaches DESTROY',
            wrap(`{ removalPolicy: stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY }`),
            0,
        ],
        ['an identifier that names a const with DESTROY', wrap('shared'), 0],
        ['no log group at all', `new Queue(this, 'Q', {});`, 0],
    ])('%s', (_name, text, expected) => {
        expect(undisposableLogGroups('fixture.ts', text)).toHaveLength(expected);
    });

    it('reports an id it cannot read rather than skipping the group', () => {
        const [finding] = undisposableLogGroups('fixture.ts', `new logs.LogGroup(this, logicalId, { retention: 1 });`);

        expect(finding?.construct).toBe('<unreadable id>');
    });
});

describe('every log group in a per-PR app can be deleted with its stack (ADR-0061)', () => {
    const services = perPrServices();

    it('discovers the per-PR apps (not vacuous), and not the persistent identity apps', () => {
        expect(services).toEqual(
            expect.arrayContaining(['food-service', 'ingredient-parser', 'recipe-service', 'recipe-workers']),
        );
        expect(services).not.toContain('identity');
        expect(services).not.toContain('identity-webhooks');
    });

    it('finds the log groups it is meant to judge (not vacuous)', () => {
        const declared = services.flatMap((service) =>
            presentFiles([`packages/services/${service}/infra/lib`])
                .filter((file) => file.endsWith('.ts'))
                .flatMap((file) =>
                    [...readFileSync(path.join(repoRoot, file), 'utf8').matchAll(/new logs\.LogGroup\(/gu)].map(
                        () => file,
                    ),
                ),
        );

        expect(declared.length).toBeGreaterThanOrEqual(10);
    });

    it('⛔ states a removalPolicy that can reach DESTROY on every one', () => {
        const findings = services.flatMap((service) =>
            presentFiles([`packages/services/${service}/infra/lib`])
                .filter((file) => file.endsWith('.ts'))
                .flatMap((file) => undisposableLogGroups(file, readFileSync(path.join(repoRoot, file), 'utf8'))),
        );

        expect(findings.map((finding) => `${finding.file} ${finding.construct}: ${finding.reason}`)).toEqual([]);
    });
});

/** The title the per-app template assertion carries. It is the marker this file looks for, so it is spelled once. */
const TEMPLATE_GUARD_TITLE = 'every resource is deleted with its stack at pr-1 (ADR-0061)';

/**
 * The stack classes an app entrypoint constructs.
 *
 * @param contents - The entrypoint source.
 * @returns Each class name once, from `new XStack(...)` expressions in code (never in a comment). Pure.
 */
function stackClassesOf(contents: string): readonly string[] {
    const source = parse({ file: 'app.ts', contents });
    const classes = new Set<string>();

    visit(source, (node) => {
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text.endsWith('Stack')) {
            classes.add(node.expression.text);
        }
    });

    return [...classes].sort();
}

/**
 * The stack classes no template assertion covers.
 *
 * @param classes - The classes the app constructs.
 * @param suites - The text of the app's infra test files.
 * @returns Classes that appear in no suite carrying {@link TEMPLATE_GUARD_TITLE}. Pure.
 */
function uncoveredStacks(classes: readonly string[], suites: readonly string[]): readonly string[] {
    const guarded = suites.filter((suite) => suite.includes(TEMPLATE_GUARD_TITLE));

    return classes.filter((name) => !guarded.some((suite) => new RegExp(`\\b${name}\\b`, 'u').test(suite)));
}

describe('reading an entrypoint and a suite for template coverage', () => {
    it('finds the stacks an entrypoint constructs, and ignores a comment and a non-stack class', () => {
        expect(
            stackClassesOf(
                "// new CommentedStack(app)\nnew FoodSchemaStack(app, 'a', {});\nnew FoodServiceStack(app, 'b', {});\nnew Tag();",
            ),
        ).toEqual(['FoodSchemaStack', 'FoodServiceStack']);
    });

    it.each([
        [
            'a class no suite names',
            ['FoodServiceStack'],
            [`describe('${TEMPLATE_GUARD_TITLE}'); // FoodSchemaStack`],
            ['FoodServiceStack'],
        ],
        [
            'a suite that names the class but carries no guard title',
            ['FoodServiceStack'],
            ['new FoodServiceStack()'],
            ['FoodServiceStack'],
        ],
        [
            'a class whose name is only a prefix of the covered one',
            ['FoodStack'],
            [`${TEMPLATE_GUARD_TITLE} FoodServiceStack`],
            ['FoodStack'],
        ],
        ['a covered class', ['FoodServiceStack'], [`${TEMPLATE_GUARD_TITLE} FoodServiceStack`], []],
    ])('%s', (_name, classes, suites, expected) => {
        expect(uncoveredStacks(classes, suites)).toEqual(expected);
    });
});

describe('every stack a per-PR app builds has the template assertion (ADR-0061)', () => {
    const services = perPrServices();

    it('covers every stack class, and finds some (not vacuous)', () => {
        const constructed = services.flatMap((service) => {
            const classes = stackClassesOf(
                readFileSync(path.join(repoRoot, `packages/services/${service}/infra/bin/app.ts`), 'utf8'),
            );
            const suites = presentFiles([`packages/services/${service}/infra/__tests__`])
                .filter((file) => file.endsWith('.test.ts'))
                .map((file) => readFileSync(path.join(repoRoot, file), 'utf8'));

            return uncoveredStacks(classes, suites).map((name) => `${service}: ${name}`);
        });
        const total = services.flatMap((service) =>
            stackClassesOf(readFileSync(path.join(repoRoot, `packages/services/${service}/infra/bin/app.ts`), 'utf8')),
        );

        expect(total.length).toBeGreaterThanOrEqual(7);
        expect(constructed).toEqual([]);
    });
});
