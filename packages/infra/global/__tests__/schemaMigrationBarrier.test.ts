// @vitest-environment node
/**
 * Repo-wide guard: the in-deploy schema barrier is DERIVED FROM THE CONSTRUCT TREE, in every stack that
 * ships a migration runner — enforced against stacks that DO NOT EXIST YET, not just today's four.
 *
 * The decision this enforces is **ADR-0022** (`docs/architecture/decisions/0022-in-stack-migration-trigger.md`).
 * Read it before changing anything here; the short version follows.
 *
 * ## The defect, and why it keeps coming back
 *
 * `cdk deploy` returns only once ECS has STABILISED, so "deploy, then invoke the migration runner" serves
 * the new image against the OLD schema for the whole stabilisation window. The instinctive repair — hoist
 * the pipeline's migrate step above its `cdk deploy` — is silently WORSE: each service's `esbuild.mjs`
 * copies its `migrations/*.sql` into the Lambda bundle at BUILD time and that bundle ships WITH the deploy,
 * so invoking first invokes the PREVIOUS release's runner carrying the PREVIOUS migration set. Exit 0,
 * "nothing pending", nothing applied. The only moment at which the new SQL exists and the new code is not
 * yet serving is INSIDE the deploy — the seam `aws-cdk-lib/triggers` occupies.
 *
 * That reasoning has now been rediscovered three times (food, identity, recipe-workers) and each rediscovery
 * cost an outage or a broken preview, which is why it is an ADR and no longer only a comment.
 *
 * ## What this file adds that the existing guards do not
 *
 * Three layers already exist, and none of them covers what is below:
 *
 *  - `prodDeployMigrationOrder.test.ts` pins the PIPELINE: a migrate step never precedes the deploy that
 *    ships its bundle, and a stack sharing another service's database is either deployed after that
 *    service's migration or carries its own barrier.
 *  - each service's own infra suite pins the TEMPLATE: exactly one `Custom::Trigger`, keyed on the runner
 *    the pipeline invokes, with every `AWS::ECS::Service` carrying a `DependsOn` on it.
 *  - nothing at all pinned the SHAPE of `executeBefore`.
 *
 * That third gap is the one that actually bites, because a `triggers.Trigger` keeps its name while covering
 * nothing. Three of the four barriers named their subjects in a hand-written array (`[apiService]`,
 * `[apiService, workerService]`, `[service]`), so a DB-touching Lambda or a second Fargate workload added to
 * any of those stacks would deploy AHEAD of the schema, with every existing guard green: the template gates
 * assert over `AWS::ECS::Service` only, and a new Lambda is invisible to them. A copied list is exactly the
 * failure mode that let `handle-sync-worker` ship unbundled past two guards.
 *
 * So the rule enforced here is the ADR's: the covered set is READ OFF THE CONSTRUCT TREE, and the predicate
 * that reads it must accept every class of compute the stack actually constructs.
 *
 * ## Why the AST and not the synthesized template
 *
 * Coverage is a property of the template, and it IS asserted there — in each service's own suite, which can
 * synthesize its own stack. This package cannot: `@kitchensink/infra-global` deliberately does not depend on
 * any service package, and giving it four such dependencies to reach four templates would invert the
 * dependency direction of the whole infra tier. What it can read is the source, and the source is where the
 * property in question lives — "the list is derived" is a statement about the code, not about the output.
 *
 * The TypeScript PARSER rather than grep, for the reason `serviceSources.ts` records at length: every stack
 * here carries a long comment explaining the barrier, and a text gate that matched `findAll` would be
 * satisfied by the prose describing it. Comments are trivia to the parser.
 *
 * ## Nothing is enumerated
 *
 * Services come from `discoverServices()` — each service's own manifest — so a fifth stack with a runner is
 * covered the day it lands and cannot opt out by not being mentioned. Within a stack, the subjects are the
 * classes it actually constructs. The one list here is {@link COMPUTE_CLASSES}, and it is itself guarded:
 * a `new` of any unclassified `*Function` / `*Service` fails {@link classificationGaps} rather than being
 * silently ignored, which is the only way a whitelist like it can stay honest.
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
    type DiscoveredService,
    type SourceFile,
    discoverServices,
    isInfraFile,
    isTestFile,
    objectProperties,
    parse,
    referenceText,
    visit,
} from './serviceSources.js';

/**
 * CDK compute classes → the `instanceof` targets that legitimately cover one.
 *
 * A stack orders its compute behind the schema by filtering the construct tree, and the filter has to name a
 * class each construct is assignable to. `ecs.FargateService` may be covered by its own name or by
 * `ecs.BaseService`, which is the form that also picks up a future EC2 or External service — so both are
 * accepted rather than one being mandated.
 *
 * Keyed on the DOTTED name as written (`lambda.Function`), because that is what the stacks write and what
 * {@link referenceText} renders; the bare last segment is accepted too, for a stack that imports the class
 * directly.
 */
const COMPUTE_CLASSES: ReadonlyMap<string, readonly string[]> = new Map([
    ['lambda.Function', ['lambda.Function']],
    ['lambda.DockerImageFunction', ['lambda.DockerImageFunction', 'lambda.Function']],
    ['ecs.FargateService', ['ecs.FargateService', 'ecs.BaseService']],
    ['ecs.Ec2Service', ['ecs.Ec2Service', 'ecs.BaseService']],
    ['ecs.ExternalService', ['ecs.ExternalService', 'ecs.BaseService']],
]);

/**
 * Constructions whose class name LOOKS like compute and is not.
 *
 * The classification gate below treats every `new *Function(…)` / `new *Service(…)` as compute unless it is
 * named here, so this set is the place where "not compute, and here is why" is recorded rather than assumed.
 */
const NOT_COMPUTE: ReadonlyMap<string, string> = new Map([
    ['events_targets.LambdaFunction', 'an EventBridge TARGET wrapping a function, not a deployed function'],
]);

/** The module a barrier is constructed from — the import that makes a bare `Trigger` unambiguous. */
const TRIGGERS_MODULE = 'aws-cdk-lib/triggers';

/** The handler entry every migration runner in this repo is bundled at. */
const MIGRATION_HANDLER = 'lambdas/migrate/handler.handler';

/** A service's CDK infrastructure sources — `infra/`, tests and fixtures excluded. */
const infraSources = (service: DiscoveredService): readonly SourceFile[] =>
    service.sources.filter((source) => isInfraFile(source.file) && !isTestFile(source.file));

/**
 * Every `new` expression in a file, paired with the dotted class name it constructs.
 *
 * @param source - The file to read.
 * @returns One entry per construction whose callee is a plain reference chain.
 */
function constructions(source: SourceFile): readonly { className: string; node: ts.NewExpression }[] {
    const found: { className: string; node: ts.NewExpression }[] = [];

    visit(parse(source), (node) => {
        if (!ts.isNewExpression(node)) {
            return;
        }

        const className = referenceText(node.expression);

        if (className !== undefined) {
            found.push({ className, node });
        }
    });

    return found;
}

/**
 * The last segment of a dotted name (`lambda.Function` → `Function`).
 *
 * @param dotted - The dotted name.
 * @returns The final segment.
 */
const lastSegment = (dotted: string): string => dotted.slice(dotted.lastIndexOf('.') + 1);

/**
 * Whether an `instanceof` target covers a constructed compute class.
 *
 * @param target - The dotted name on the right of `instanceof`.
 * @param constructed - The dotted name the stack constructs.
 * @returns `true` when the target is the class itself or an accepted base.
 */
function covers(target: string, constructed: string): boolean {
    const accepted = COMPUTE_CLASSES.get(constructed) ?? [];

    return accepted.some((candidate) => candidate === target || lastSegment(candidate) === lastSegment(target));
}

/**
 * `new` expressions whose class name is shaped like compute but is classified neither way.
 *
 * This is what stops {@link COMPUTE_CLASSES} rotting into a list that quietly stopped covering things. A
 * whitelist that silently ignores what it does not recognize is indistinguishable from no whitelist.
 *
 * @param service - The service to inspect.
 * @returns One message per unclassified construction.
 */
function classificationGaps(service: DiscoveredService): readonly string[] {
    return infraSources(service).flatMap((source) =>
        constructions(source)
            .map(({ className }) => className)
            .filter((className) => /(?:Function|Service)$/u.test(lastSegment(className)))
            .filter((className) => !COMPUTE_CLASSES.has(className) && !NOT_COMPUTE.has(className))
            .map(
                (className) =>
                    `${source.file}: \`new ${className}(…)\` is neither in COMPUTE_CLASSES nor NOT_COMPUTE — ` +
                    'classify it, or a stack could deploy it ahead of the schema and no gate would notice',
            ),
    );
}

/** One in-deploy barrier, located in the file that declares it. */
interface Barrier {
    /** Repo-relative path of the declaring file. */
    readonly file: string;
    /** The `new triggers.Trigger(…)` expression. */
    readonly node: ts.NewExpression;
    /** Its props object, when it has one. */
    readonly props: ts.ObjectLiteralExpression | undefined;
}

/**
 * Every in-deploy migration barrier a service's infra declares.
 *
 * A bare `Trigger` is only recognized in a file that imports `aws-cdk-lib/triggers`, so an unrelated class
 * of the same name in another namespace cannot be mistaken for one.
 *
 * @param service - The service to inspect.
 * @returns The barriers, in source order.
 */
function barriers(service: DiscoveredService): readonly Barrier[] {
    return infraSources(service).flatMap((source) => {
        const importsTriggers = source.contents.includes(TRIGGERS_MODULE);

        return constructions(source)
            .filter(({ className }) => className === 'triggers.Trigger' || (importsTriggers && className === 'Trigger'))
            .map(({ node }) => {
                const [, , props] = node.arguments ?? [];

                return {
                    file: source.file,
                    node,
                    props: props !== undefined && ts.isObjectLiteralExpression(props) ? props : undefined,
                };
            });
    });
}

/** Service directories that declare at least one barrier. */
const barrierCarryingServices = (services: readonly DiscoveredService[]): readonly string[] =>
    services
        .filter((service) => barriers(service).length > 0)
        .map((service) => service.name)
        .sort();

/**
 * The expression a barrier's `executeBefore` ultimately names, following one level of `const` binding.
 *
 * The binding hop is not a convenience: the derivation is several chained calls and a stack that inlined it
 * into the props object would be unreadable, so every real barrier writes `const orderedBehind… = …` first.
 * A gate that only read the property would then see a bare identifier and could say nothing about it.
 *
 * @param source - The declaring file.
 * @param barrier - The barrier to resolve.
 * @returns The resolved expression, or `undefined` when the barrier declares no `executeBefore`.
 */
function executeBeforeExpression(source: SourceFile, barrier: Barrier): ts.Expression | undefined {
    const declared = barrier.props === undefined ? undefined : objectProperties(barrier.props).get('executeBefore');

    if (declared === undefined || !ts.isIdentifier(declared)) {
        return declared;
    }

    let bound: ts.Expression | undefined;

    visit(parse(source), (node) => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === declared.text &&
            node.initializer !== undefined
        ) {
            bound = node.initializer;
        }
    });

    return bound ?? declared;
}

/** Whether an expression tree contains a `.findAll()` call — the construct-tree read. */
function readsTheConstructTree(expression: ts.Expression): boolean {
    let found = false;

    visit(expression, (node) => {
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'findAll'
        ) {
            found = true;
        }
    });

    return found;
}

/** Every dotted name tested with `instanceof` inside an expression tree. */
function instanceofTargets(expression: ts.Expression): readonly string[] {
    const targets: string[] = [];

    visit(expression, (node) => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
            const target = referenceText(node.right);

            if (target !== undefined) {
                targets.push(target);
            }
        }
    });

    return targets;
}

/**
 * ⛔ Barriers whose `executeBefore` is a hand-written list rather than a read of the construct tree.
 *
 * @param service - The service to inspect.
 * @returns One message per barrier that names its subjects instead of discovering them.
 * @sideEffect Reads the service's infra sources (already in memory).
 */
function literalListViolations(service: DiscoveredService): readonly string[] {
    return infraSources(service).flatMap((source) =>
        barriers({ ...service, sources: [source] }).flatMap((barrier) => {
            const expression = executeBeforeExpression(source, barrier);

            if (expression === undefined) {
                return [`${source.file}: the migration trigger declares no executeBefore at all — it orders nothing`];
            }

            return readsTheConstructTree(expression)
                ? []
                : [
                      `${source.file}: executeBefore is a hand-kept list. A DB-touching Lambda or a second ` +
                          'Fargate workload added to this stack would deploy AHEAD of the schema, and no gate ' +
                          'in this repo would see it — derive it from `this.node.findAll()` instead',
                  ];
        }),
    );
}

/**
 * ⛔ Barriers whose derivation does not accept every class of compute its own stack constructs.
 *
 * The derivation is only as total as its predicate. A filter that tests `instanceof lambda.Function` in a
 * stack that also runs Fargate covers the Lambdas and silently drops the services — which reads as a derived,
 * complete barrier and is neither.
 *
 * @param service - The service to inspect.
 * @returns One message per uncovered compute class.
 */
function uncoveredComputeViolations(service: DiscoveredService): readonly string[] {
    return infraSources(service).flatMap((source) => {
        const found = barriers({ ...service, sources: [source] });

        if (found.length === 0) {
            return [];
        }

        const constructed = [
            ...new Set(
                constructions(source)
                    .map(({ className }) => className)
                    .filter((className) => COMPUTE_CLASSES.has(className)),
            ),
        ].sort();

        return found.flatMap((barrier) => {
            const expression = executeBeforeExpression(source, barrier);

            if (expression === undefined || !readsTheConstructTree(expression)) {
                // Already reported by `literalListViolations`; reporting it twice buries the other finding.
                return [];
            }

            const targets = instanceofTargets(expression);

            return constructed
                .filter((className) => !targets.some((target) => covers(target, className)))
                .map(
                    (className) =>
                        `${source.file}: the barrier's derivation never accepts \`${className}\`, which this ` +
                        'stack constructs — those resources deploy ahead of the schema',
                );
        });
    });
}

/**
 * ⛔ Stacks that ship a migration runner without exactly one barrier over it.
 *
 * Both directions matter. None is the recipe-workers defect verbatim: a runner deployed beside six workers
 * that were updated ahead of it. Two is worse than none in a different way — two triggers over one schema is
 * two concurrent DDL sessions, and the runner holds no advisory lock (ADR-0022, residual risk).
 *
 * The runner is recognized by the handler entry it is bundled at, which is a string VALUE — a comment naming
 * the handler cannot satisfy it.
 *
 * @param service - The service to inspect.
 * @returns One message per stack whose runner is unbarriered or doubly barriered.
 */
function runnerWithoutBarrierViolations(service: DiscoveredService): readonly string[] {
    return infraSources(service).flatMap((source) => {
        const shipsRunner = constructions(source).some(({ node }) => {
            let found = false;

            visit(node, (child) => {
                if (ts.isStringLiteral(child) && child.text === MIGRATION_HANDLER) {
                    found = true;
                }
            });

            return found;
        });

        if (!shipsRunner) {
            return [];
        }

        const count = barriers({ ...service, sources: [source] }).length;

        return count === 1
            ? []
            : [
                  `${source.file}: deploys a migration runner behind ${count} in-deploy trigger(s) — exactly ` +
                      'one is required (none leaves the stack ordered only by the pipeline; two is two ' +
                      'concurrent DDL sessions against one schema)',
              ];
    });
}

// ───────────────────────────── deliberately-violating fakes ─────────────────────────────
//
// Each gate is fired at a fake that breaks it, so a gate that silently stops matching fails HERE rather than
// passing vacuously over a clean tree forever. They are separate fakes rather than one, because the failures
// are mutually exclusive: a barrier cannot both omit its derivation and derive it incompletely.

/** A stack whose barrier names its subjects instead of discovering them — the shape this ADR forbids. */
const LITERAL_LIST_STACK: DiscoveredService = {
    name: 'fake-literal',
    packageName: '@kitchensink/fake-literal',
    sources: [
        {
            file: 'packages/services/fake-literal/infra/lib/FakeStack.ts',
            contents: `
                import * as triggers from 'aws-cdk-lib/triggers';

                const apiService = new ecs.FargateService(this, 'Api', {});
                const migrationFn = new lambda.Function(this, 'Migrate', {
                    handler: 'lambdas/migrate/handler.handler',
                });

                // Derived from the construct tree via this.node.findAll() — except it is not: the prose
                // says so and the code does not, which is exactly the trap a text gate falls into.
                new triggers.Trigger(this, 'SchemaMigrations', {
                    handler: migrationFn,
                    executeAfter: [migrationFn],
                    executeBefore: [apiService],
                });
            `,
        },
    ],
};

/** A stack that derives its set, but with a predicate blind to half its own compute. */
const PARTIAL_DERIVATION_STACK: DiscoveredService = {
    name: 'fake-partial',
    packageName: '@kitchensink/fake-partial',
    sources: [
        {
            file: 'packages/services/fake-partial/infra/lib/FakeStack.ts',
            contents: `
                import * as triggers from 'aws-cdk-lib/triggers';

                const apiService = new ecs.FargateService(this, 'Api', {});
                const workerFn = new lambda.Function(this, 'Worker', {});
                const migrationFn = new lambda.Function(this, 'Migrate', {
                    handler: 'lambdas/migrate/handler.handler',
                });

                const orderedBehindTheSchema = this.node
                    .findAll()
                    .filter((construct) => construct instanceof lambda.Function)
                    .filter((construct) => construct !== migrationFn);

                new triggers.Trigger(this, 'SchemaMigrations', {
                    handler: migrationFn,
                    executeAfter: [migrationFn],
                    executeBefore: orderedBehindTheSchema,
                });
            `,
        },
    ],
};

/** A stack that deploys a runner and never orders anything behind it — the recipe-workers defect. */
const UNBARRIERED_RUNNER_STACK: DiscoveredService = {
    name: 'fake-unbarriered',
    packageName: '@kitchensink/fake-unbarriered',
    sources: [
        {
            file: 'packages/services/fake-unbarriered/infra/lib/FakeStack.ts',
            contents: `
                const workerFn = new lambda.Function(this, 'Worker', {});
                const migrationFn = new lambda.Function(this, 'Migrate', {
                    handler: 'lambdas/migrate/handler.handler',
                });
            `,
        },
    ],
};

/** A stack constructing compute this file has never heard of. */
const UNCLASSIFIED_COMPUTE_STACK: DiscoveredService = {
    name: 'fake-unclassified',
    packageName: '@kitchensink/fake-unclassified',
    sources: [
        {
            file: 'packages/services/fake-unclassified/infra/lib/FakeStack.ts',
            contents: `
                const batch = new batch.FargateComputeService(this, 'Batch', {});
            `,
        },
    ],
};

describe('every in-deploy schema barrier derives its ordered set from the construct tree (ADR-0022)', () => {
    it('discovers the barriers at all, in the stacks that address a service database', () => {
        // Anchors every assertion below. A discovery predicate that quietly stops matching turns them into
        // assertions over an empty list, which is the single way a guard like this rots unnoticed. The
        // literal here is the ANCHOR, never the subject: the gates themselves enumerate nothing.
        expect(
            barrierCarryingServices(discoverServices()),
            'expected the food, identity, recipe-service and recipe-workers barriers',
        ).toStrictEqual(['food-service', 'identity', 'recipe-service', 'recipe-workers']);
    });

    it('⛔ never names the ordered set in a hand-written list', () => {
        const violations = discoverServices().flatMap((service) => literalListViolations(service));

        expect(
            violations,
            'a copied list is what let handle-sync-worker ship unbundled past two guards — the whole point ' +
                'of the barrier is that a new DB-touching resource is covered the day it is added',
        ).toStrictEqual([]);
    });

    it('⛔ accepts every class of compute the stack actually constructs', () => {
        const violations = discoverServices().flatMap((service) => uncoveredComputeViolations(service));

        expect(
            violations,
            'a derivation blind to one class of compute reads as complete and is not — the resources it ' +
                'drops roll out against the previous release’s schema',
        ).toStrictEqual([]);
    });

    it('⛔ puts exactly one barrier over every migration runner it deploys', () => {
        const violations = discoverServices().flatMap((service) => runnerWithoutBarrierViolations(service));

        expect(
            violations,
            'a runner with no trigger is ordered only by the pipeline, which cannot order two CDK apps',
        ).toStrictEqual([]);
    });

    it('classifies every compute-shaped construction the services build', () => {
        const violations = discoverServices().flatMap((service) => classificationGaps(service));

        expect(violations, 'COMPUTE_CLASSES must not silently ignore what it does not recognize').toStrictEqual([]);
    });
});

describe('the gates fire — each one, at a stack built to break it', () => {
    it('catches a barrier whose executeBefore is a literal list, past its own contrary prose', () => {
        expect(literalListViolations(LITERAL_LIST_STACK)).toStrictEqual([
            expect.stringContaining('executeBefore is a hand-kept list') as unknown as string,
        ]);
        // The derivation gate must stay SILENT here: reporting the same barrier twice buries whichever
        // finding the reader needs, and "no derivation" is already the first gate's message.
        expect(uncoveredComputeViolations(LITERAL_LIST_STACK)).toStrictEqual([]);
    });

    it('catches a derivation blind to the Fargate service in its own stack', () => {
        expect(literalListViolations(PARTIAL_DERIVATION_STACK)).toStrictEqual([]);
        expect(uncoveredComputeViolations(PARTIAL_DERIVATION_STACK)).toStrictEqual([
            expect.stringContaining('never accepts `ecs.FargateService`') as unknown as string,
        ]);
    });

    it('catches a migration runner deployed with no barrier over it', () => {
        expect(runnerWithoutBarrierViolations(UNBARRIERED_RUNNER_STACK)).toStrictEqual([
            expect.stringContaining('behind 0 in-deploy trigger(s)') as unknown as string,
        ]);
    });

    it('catches a compute-shaped construction it has never been taught about', () => {
        expect(classificationGaps(UNCLASSIFIED_COMPUTE_STACK)).toStrictEqual([
            expect.stringContaining('batch.FargateComputeService') as unknown as string,
        ]);
    });

    it('ignores a stack that ships no runner and no barrier — the rule is not "every stack has a trigger"', () => {
        // `identity-webhooks` is exactly this shape, and deliberately so (ADR-0022): five DB-touching
        // Lambdas, no runner of its own, ordered by deploying AFTER the identity service — which
        // `prodDeployMigrationOrder.test.ts` is what asserts. A gate that demanded a trigger here would
        // force a second runner onto the identity schema for no ordering it does not already have.
        const inert: DiscoveredService = {
            name: 'fake-inert',
            packageName: '@kitchensink/fake-inert',
            sources: [
                {
                    file: 'packages/services/fake-inert/infra/lib/FakeStack.ts',
                    contents: `const fn = new lambda.Function(this, 'Webhook', { environment: { DB_SECRET_ARN: arn } });`,
                },
            ],
        };

        expect(literalListViolations(inert)).toStrictEqual([]);
        expect(uncoveredComputeViolations(inert)).toStrictEqual([]);
        expect(runnerWithoutBarrierViolations(inert)).toStrictEqual([]);
    });
});
