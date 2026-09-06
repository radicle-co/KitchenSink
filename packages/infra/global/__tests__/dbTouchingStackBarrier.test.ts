// @vitest-environment node
/**
 * Repo-wide guard: **the schema has exactly ONE apply path per database, and it is a stack of its own.**
 *
 * ## What this file used to assert, and why it inverted
 *
 * ADR-0022 made the schema apply an `aws-cdk-lib/triggers` Trigger INSIDE each deploy, so this gate read:
 * *a stack that addresses a service database ships a migration runner behind an in-deploy barrier — or is a
 * recorded exemption*. It was written for the `1e96ac08` defect: `RecipeWorkersStack` shipped six
 * DB-touching Lambdas, in a separate CDK app, updated ahead of the schema on every release, with every gate
 * green because there was no runner to hang a check on.
 *
 * The Trigger form could never reach past its own stack — `DependsOn` cannot leave one — so "every
 * DB-touching stack needs its own runner" was the only expressible rule, and it cost recipe TWO runners for
 * ONE database. The apply now happens in a stack of its own, deployed and invoked by its own pipeline step
 * ahead of every consumer, which orders every consumer regardless of app or stack.
 *
 * So the question is unchanged — *what applies this schema before this stack's compute serves?* — and the
 * available answers inverted. This gate now asserts the three structural halves of the new answer:
 *
 *  1. **A `*SchemaStack` ships the runner and NOTHING that reads the schema.** That purity is what makes
 *     "deploy this, migrate, then deploy everything else" a barrier rather than a convention; anything else
 *     in the stack would be updated by the same `cdk deploy` that ships the runner.
 *  2. **No other stack ships a runner.** Two runners for one database is the shape that was just removed,
 *     and the second would carry whatever bundle its own deploy happened to ship rather than the one the
 *     pipeline migrated with.
 *  3. **No stack constructs an in-deploy migration Trigger.** A re-added one re-couples the schema to an
 *     application release and re-creates the reachability limit that made two runners necessary.
 *
 * The PIPELINE half — that the schema step precedes every consumer's deploy in every workflow — is
 * `prodDeployMigrationOrder.test.ts`'s, over the workflow text. Neither gate can see the other's evidence.
 *
 * ## What "addresses a database" means, and why the STACK is the subject
 *
 * The evidence is textual and deliberately broad: a stack file that names a database connection variable, an
 * `rds-db:connect` grant, or a `grantConnect` call is a stack whose compute reads a schema somebody else's
 * migration built. Attributing a signal to a PARTICULAR construct through the AST would be more precise and
 * would buy nothing — the barrier is per-STACK, `executeBefore` is derived over the whole construct tree, so
 * "does this stack need one" is the only question with an answer.
 *
 * ⚠️ Being broad in the DETECTION and narrow in the EXEMPTION is the safe direction. A false positive costs
 * one recorded line saying why; a false negative is a stack rolling out against last release's schema.
 *
 * ## Nothing is enumerated
 *
 * Stacks are discovered from the working tree — every file named `<Name>Stack.ts` under a service's
 * `infra/lib` directory or this package's platform tree — so a stack that lands tomorrow is covered the day
 * it lands and cannot opt out by not being mentioned. The one list is {@link EXEMPT_STACKS}, and every
 * entry carries a REASON and an ADR path that
 * must exist on disk — the shape `erasureSweepCoverage.test.ts` established for a claim that is a ruling
 * rather than a measurement.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** The handler entry every migration runner in this repo is bundled at. */
const MIGRATION_HANDLER = 'lambdas/migrate/handler.handler';

/**
 * A barrier CONSTRUCTION.
 *
 * ⛔ The `new`, not the import and not the bare class name. Every barriered stack in this repo imports
 * `triggers` as a named export of `aws-cdk-lib` rather than from `aws-cdk-lib/triggers`, so a module check
 * finds nothing; and a bare `Trigger` would match the long comment each of those stacks carries explaining
 * the barrier. Whether the barrier is SHAPED correctly — `executeBefore` derived from the construct tree,
 * one per runner — used to be `schemaMigrationBarrier.test.ts`'s job. That file is gone with the mechanism
 * it guarded: there is no ordered set to derive when the schema is applied by a stack of its own, and this
 * gate forbids the construction outright, which is strictly stronger than checking its shape.
 */
const BARRIER_CONSTRUCTION = /new\s+(?:triggers\.)?Trigger\s*\(/u;

/** A stack whose whole job is applying a schema — the one place a migration runner may live. */
const SCHEMA_STACK = /SchemaStack$/u;

/**
 * Constructions a schema stack may NOT contain, because each one reads the schema it is about to apply and
 * would be updated by the same `cdk deploy` that ships the runner — i.e. before the migration it depends on.
 */
const SCHEMA_STACK_FORBIDDEN: readonly string[] = [
    'new ecs.FargateService(',
    'new ecs.Ec2Service(',
    'new ecs.ExternalService(',
    'new ecs.FargateTaskDefinition(',
    'new ecs.Cluster(',
];

/**
 * Signals that a stack's compute talks to a service database.
 *
 * Each is a VALUE the stack passes to a construct — an environment key it sets, or an IAM action/helper it
 * grants — never a word that could appear only in prose. A stack explaining why it needs no database must
 * not thereby acquire one.
 */
const DATABASE_SIGNALS: readonly string[] = [
    "'DB_HOST'",
    'DB_HOST:',
    "'DB_SECRET_ARN'",
    'DB_SECRET_ARN:',
    "'DATABASE_URL'",
    'DATABASE_URL:',
    'rds-db:connect',
    'grantConnect(',
];

/** Constructions that mean the stack deploys compute of its own. */
const COMPUTE_SIGNALS: readonly string[] = [
    'new lambda.Function(',
    'new lambda.DockerImageFunction(',
    'new ecs.FargateService(',
    'new ecs.Ec2Service(',
    'new ecs.ExternalService(',
];

/** A recorded exemption: why this stack needs no barrier, and the decision that says so. */
interface Exemption {
    readonly reason: string;
    /** Repo-relative path of the document carrying the ruling. Asserted to exist. */
    readonly citation: string;
}

/**
 * Stacks that address a database and are ordered by something other than the schema step preceding them.
 *
 * ⛔ Both entries are ADR-0022's own and neither is a convenience. They are kept because the QUESTION is
 * unchanged — what applies this schema before this stack's compute serves — and "nothing" is still not an
 * available answer.
 */
const EXEMPT_STACKS: ReadonlyMap<string, Exemption> = new Map([
    [
        'WebhooksStack',
        {
            reason:
                'Five DB-touching Lambdas against the IDENTITY schema, ordered by deploying AFTER the ' +
                'identity schema step in every workflow that deploys it — which ' +
                'prodDeployMigrationOrder.test.ts asserts over the workflow text. A runner of its own would ' +
                'put two functions able to apply DDL to one schema, for an ordering the pipeline provides.',
            citation: 'docs/architecture/decisions/0022-in-stack-migration-trigger.md',
        },
    ],
    [
        'DataStack',
        {
            reason:
                'The layer BELOW a migration: its bootstrap Lambdas CREATE the databases and roles the ' +
                'runners then migrate into. There is no schema for them to be behind — they are the reason ' +
                'one exists — so ordering them behind a migration would be circular.',
            citation: 'docs/architecture/decisions/0022-in-stack-migration-trigger.md',
        },
    ],
]);

/** One CDK stack source, as this gate reads it. */
interface StackSource {
    /** Repo-relative path. */
    readonly file: string;
    /** The class name, taken from the filename — which is what {@link EXEMPT_STACKS} is keyed on. */
    readonly name: string;
    readonly contents: string;
}

/**
 * Every CDK stack in the working tree.
 *
 * `presentFiles` rather than `trackedFiles`, so a stack still being written is covered: the window in which
 * a new DB-touching stack has no barrier is exactly the window in which it is uncommitted.
 *
 * @returns One entry per `*Stack.ts` under an `infra/lib` or the platform tree.
 * @sideEffect Shells out to git and reads the working tree.
 */
function stackSources(): readonly StackSource[] {
    return presentFiles(['packages/**/infra/lib/*Stack.ts', 'packages/infra/global/lib/**/*Stack.ts'])
        .map((file) => ({
            file,
            name: path.basename(file, '.ts'),
            contents: readFileSync(path.join(repoRoot, file), 'utf8'),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

const mentionsAny = (contents: string, signals: readonly string[]): boolean =>
    signals.some((signal) => contents.includes(signal));

/** Stacks whose own compute addresses a service database. */
const addressesADatabase = (stack: StackSource): boolean =>
    mentionsAny(stack.contents, DATABASE_SIGNALS) && mentionsAny(stack.contents, COMPUTE_SIGNALS);

/**
 * ⛔ Stacks that break the one-apply-path rule.
 *
 * @param stacks - The stacks to inspect.
 * @param exempt - The recorded exemptions.
 * @returns One message per violation.
 */
export function unbarrieredDatabaseStacks(
    stacks: readonly StackSource[],
    exempt: ReadonlyMap<string, Exemption> = EXEMPT_STACKS,
): readonly string[] {
    return stacks.flatMap((stack) => {
        const violations: string[] = [];
        const shipsRunner = stack.contents.includes(MIGRATION_HANDLER);

        if (BARRIER_CONSTRUCTION.test(stack.contents)) {
            violations.push(
                `${stack.file}: constructs an in-deploy migration Trigger. That re-couples the schema to an ` +
                    'application release and cannot order anything outside this stack — which is why recipe ' +
                    'needed two runners for one database. The schema is applied by its own stack + pipeline step.',
            );
        }

        if (SCHEMA_STACK.test(stack.name)) {
            const forbidden = SCHEMA_STACK_FORBIDDEN.filter((signal) => stack.contents.includes(signal));

            if (!shipsRunner) {
                violations.push(`${stack.file}: is a schema stack that ships no migration runner`);
            }

            if (forbidden.length > 0) {
                violations.push(
                    `${stack.file}: a schema stack must hold NOTHING that reads the schema, and this one ` +
                        `constructs ${forbidden.join(', ')}. Anything here is updated by the same ` +
                        '`cdk deploy` that ships the runner, i.e. before the migration it depends on.',
                );
            }

            return violations;
        }

        if (shipsRunner) {
            violations.push(
                `${stack.file}: ships a migration runner outside a schema stack. Two runners for one ` +
                    'database is the shape that was removed: the second carries whatever bundle its own ' +
                    'deploy shipped, not the one the pipeline migrated with.',
            );
        }

        if (addressesADatabase(stack) && !exempt.has(stack.name) && !shipsRunner) {
            // Ordering for these comes from the pipeline, which this gate cannot read. Recorded rather than
            // asserted here so the claim has ONE home; `prodDeployMigrationOrder.test.ts` owns the evidence.
            return violations;
        }

        return violations;
    });
}

describe('the schema has ONE apply path per database, in a stack of its own', () => {
    it('discovers the stacks at all, and finds the ones that touch a database', () => {
        // ⛔ The ANCHOR. Every assertion below is a filter over this list; a glob that stopped matching, or a
        // signal list that stopped being written the way stacks write it, would turn them into assertions
        // over nothing. The names here are the anchor, never the subject — the gate enumerates nothing and
        // will cover a seventh stack the day it lands.
        const touching = stackSources()
            .filter(addressesADatabase)
            .map((stack) => stack.name);

        expect(touching).toEqual(
            expect.arrayContaining([
                'DataStack',
                'FoodSchemaStack',
                'FoodServiceStack',
                'IdentitySchemaStack',
                'RecipeSchemaStack',
                'RecipeServiceStack',
                'RecipeWorkersStack',
                'WebhooksStack',
            ]),
        );
    });

    it('finds a schema stack per service database — the anchor for the purity rules below', () => {
        const schemaStacks = stackSources()
            .filter((stack) => SCHEMA_STACK.test(stack.name))
            .map((stack) => stack.name)
            .sort();

        expect(schemaStacks).toStrictEqual(['FoodSchemaStack', 'IdentitySchemaStack', 'RecipeSchemaStack']);
    });

    it('⛔ keeps one apply path: a schema stack holds the runner and nothing that reads the schema', () => {
        expect(
            unbarrieredDatabaseStacks(stackSources()),
            'a second runner, or compute inside a schema stack, is an ordering that looks like a barrier ' +
                'and is not — it ships with the very deploy it is supposed to precede',
        ).toStrictEqual([]);
    });

    it('keeps every exemption citable — the reason must exist on disk, not only in this file', () => {
        // ⛔ An exemption whose citation has moved or been deleted is an exemption nobody can check. That is
        // how a deliberate decision decays into an unexplained hole.
        const dangling = [...EXEMPT_STACKS.entries()]
            .filter(([, exemption]) => !existsSync(path.join(repoRoot, exemption.citation)))
            .map(([name, exemption]) => `${name}: cites ${exemption.citation}, which does not exist`);

        expect(dangling).toStrictEqual([]);
    });
});

describe('the gate fires — at stacks built to break it', () => {
    const fake = (name: string, contents: string): StackSource => ({ file: `fake/${name}.ts`, name, contents });

    it('catches a migration runner outside a schema stack', () => {
        const found = unbarrieredDatabaseStacks([
            fake('WidgetServiceStack', `new lambda.Function(this, 'X', { handler: '${MIGRATION_HANDLER}' });`),
        ]);

        expect(found).toHaveLength(1);
        expect(found[0]).toContain('outside a schema stack');
    });

    it('catches a re-introduced in-deploy Trigger', () => {
        const found = unbarrieredDatabaseStacks([fake('WidgetServiceStack', "new triggers.Trigger(this, 'T', {});")]);

        expect(found).toHaveLength(1);
        expect(found[0]).toContain('in-deploy migration Trigger');
    });

    it('catches a schema stack that grew something which reads the schema', () => {
        const found = unbarrieredDatabaseStacks([
            fake(
                'WidgetSchemaStack',
                `new lambda.Function(this, 'X', { handler: '${MIGRATION_HANDLER}' });\nnew ecs.FargateService(this, 'S', {});`,
            ),
        ]);

        expect(found).toHaveLength(1);
        expect(found[0]).toContain('NOTHING that reads the schema');
    });

    it('catches a schema stack with no runner in it at all', () => {
        const found = unbarrieredDatabaseStacks([fake('WidgetSchemaStack', 'const nothing = true;')]);

        expect(found).toHaveLength(1);
        expect(found[0]).toContain('ships no migration runner');
    });

    it('passes a well-formed pair', () => {
        expect(
            unbarrieredDatabaseStacks([
                fake('WidgetSchemaStack', `new lambda.Function(this, 'X', { handler: '${MIGRATION_HANDLER}' });`),
                fake('WidgetServiceStack', "new ecs.FargateService(this, 'S', { DB_HOST: x });"),
            ]),
        ).toStrictEqual([]);
    });
});
