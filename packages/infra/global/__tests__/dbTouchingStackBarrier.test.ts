// @vitest-environment node
/**
 * Repo-wide guard, in the direction `schemaMigrationBarrier.test.ts` cannot look: **a stack that addresses a
 * service database ships a migration runner behind an in-deploy barrier — or is a RECORDED exemption.**
 *
 * The decision is **ADR-0022** (`docs/architecture/decisions/0022-in-stack-migration-trigger.md`).
 *
 * ## Why this file exists beside the barrier gate rather than inside it
 *
 * `schemaMigrationBarrier.test.ts` reads: *runner ⇒ exactly one barrier, derived from the construct tree*.
 * Every one of its findings starts from a runner it can see. So the stack that has DB-touching compute and
 * **no runner at all** is invisible to it — and that stack is precisely the `1e96ac08` defect that made
 * ADR-0022 necessary: `RecipeWorkersStack` shipped six DB-touching Lambdas, in a separate CDK app, updated
 * ahead of the schema on every release, with every gate green because there was no runner to hang a check
 * on. The gate that would have caught it is this one, and it did not exist.
 *
 * It matters more now than it did in August. The owner's standing rule is that **migrations run on every
 * deploy**; a stack outside every barrier is a stack that rule cannot reach, because the only two mechanisms
 * that reach one are its own Trigger and a pipeline step aimed at a runner it does not have.
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
 * one per runner — is `schemaMigrationBarrier.test.ts`'s job, over the real AST. This gate asks only
 * whether there is one at all, which is the question that gate cannot reach.
 */
const BARRIER_CONSTRUCTION = /new\s+(?:triggers\.)?Trigger\s*\(/u;

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
 * Stacks that address a database and deliberately carry no in-deploy barrier.
 *
 * ⛔ Both entries are ADR-0022's own, and neither is a convenience. Adding a third is a decision about
 * deploy ordering, not a way to make this suite green — the question it answers is "what applies this
 * schema before this stack's compute serves", and "nothing" is not an available answer.
 */
const EXEMPT_STACKS: ReadonlyMap<string, Exemption> = new Map([
    [
        'WebhooksStack',
        {
            reason:
                'ADR-0022 route 2: five DB-touching Lambdas against the IDENTITY schema, ordered by ' +
                'deploying AFTER the identity service in every workflow that deploys it — which ' +
                'prodDeployMigrationOrder.test.ts asserts. A second runner would put two functions able to ' +
                'apply DDL to one schema, for an ordering the pipeline already provides.',
            citation: 'docs/architecture/decisions/0022-in-stack-migration-trigger.md',
        },
    ],
    [
        'DataStack',
        {
            reason:
                'The layer BELOW a migration: its two bootstrap Lambdas CREATE the databases and roles the ' +
                'runners then migrate into. There is no schema for them to be behind — they are the reason ' +
                'one exists — so a barrier here would be circular.',
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
 * ⛔ DB-touching stacks with no runner, no barrier and no recorded exemption.
 *
 * @param stacks - The stacks to inspect.
 * @param exempt - The recorded exemptions.
 * @returns One message per unordered stack.
 */
export function unbarrieredDatabaseStacks(
    stacks: readonly StackSource[],
    exempt: ReadonlyMap<string, Exemption> = EXEMPT_STACKS,
): readonly string[] {
    return stacks.filter(addressesADatabase).flatMap((stack) => {
        if (exempt.has(stack.name)) {
            return [];
        }

        const shipsRunner = stack.contents.includes(MIGRATION_HANDLER);
        const hasBarrier = BARRIER_CONSTRUCTION.test(stack.contents);

        if (shipsRunner && hasBarrier) {
            return [];
        }

        return [
            `${stack.file}: deploys compute that addresses a service database with ` +
                `${shipsRunner ? 'a runner but no in-deploy barrier' : 'no migration runner of its own'}. ` +
                'Give it a runner + a Trigger whose executeBefore is derived from this.node.findAll() ' +
                '(ADR-0022 §1-2), or record it in EXEMPT_STACKS with the ordering that covers it instead — ' +
                'the one answer that is not available is that nothing applies the schema before it serves',
        ];
    });
}

describe('every stack that addresses a service database is ordered behind a migration (ADR-0022)', () => {
    it('discovers the stacks at all, and finds the ones that touch a database', () => {
        // ⛔ The ANCHOR. Every assertion below is a filter over this list; a glob that stopped matching, or a
        // signal list that stopped being written the way stacks write it, would turn them into assertions
        // over nothing. The names here are the anchor, never the subject — the gate enumerates nothing and
        // will cover a sixth stack the day it lands.
        const touching = stackSources()
            .filter(addressesADatabase)
            .map((stack) => stack.name);

        expect(touching).toEqual(
            expect.arrayContaining([
                'DataStack',
                'FoodServiceStack',
                'IdentityServiceStack',
                'RecipeServiceStack',
                'RecipeWorkersStack',
                'WebhooksStack',
            ]),
        );
    });

    it('⛔ leaves no DB-touching stack without a runner, a barrier, or a recorded exemption', () => {
        expect(
            unbarrieredDatabaseStacks(stackSources()),
            'a stack outside every barrier is a stack the "migrations run on every deploy" rule cannot ' +
                'reach — its compute rolls out against whatever schema the previous release left',
        ).toStrictEqual([]);
    });

    it('keeps every exemption citable — the reason must exist on disk, not only in this file', () => {
        // ⛔ An exemption whose citation has moved or been deleted is an exemption nobody can check. That is
        // how a deliberate decision decays into an unexplained hole, which is the state ADR-0022 was written
        // to end.
        const dangling = [...EXEMPT_STACKS.entries()]
            .filter(([, exemption]) => !existsSync(path.join(repoRoot, exemption.citation)))
            .map(([name, exemption]) => `${name}: cites ${exemption.citation}, which does not exist`);

        expect(dangling).toStrictEqual([]);
    });

    it('keeps every exemption LIVE — an exemption for a stack that no longer touches a database is stale', () => {
        // The other direction. A stack that stopped addressing a database, or was renamed, leaves a standing
        // licence behind that a future stack of the same name would inherit silently.
        const touching = new Set(
            stackSources()
                .filter(addressesADatabase)
                .map((stack) => stack.name),
        );
        const stale = [...EXEMPT_STACKS.keys()].filter((name) => !touching.has(name));

        expect(stale, 'delete the entry rather than leaving a licence a future stack would inherit').toStrictEqual([]);
    });
});

describe('the gate fires — at stacks built to break it', () => {
    const runner = `handler: '${MIGRATION_HANDLER}'`;
    const barrier = `new triggers.Trigger(this, 'SchemaMigrations', {});`;

    it('catches a stack with DB-touching Lambdas and no runner — the recipe-workers defect verbatim', () => {
        expect(
            unbarrieredDatabaseStacks(
                [
                    {
                        file: 'packages/services/fake/infra/lib/FakeStack.ts',
                        name: 'FakeStack',
                        contents: `new lambda.Function(this, 'Worker', { environment: { DB_HOST: host } });`,
                    },
                ],
                new Map(),
            ),
        ).toStrictEqual([expect.stringContaining('no migration runner of its own') as unknown as string]);
    });

    it('catches a stack that ships a runner and never barriers it', () => {
        expect(
            unbarrieredDatabaseStacks(
                [
                    {
                        file: 'packages/services/fake/infra/lib/FakeStack.ts',
                        name: 'FakeStack',
                        contents: `new lambda.Function(this, 'Migrate', { ${runner} }); const x = 'rds-db:connect';`,
                    },
                ],
                new Map(),
            ),
        ).toStrictEqual([expect.stringContaining('a runner but no in-deploy barrier') as unknown as string]);
    });

    it('passes a stack that carries both, and a stack that touches no database at all', () => {
        const barriered: StackSource = {
            file: 'packages/services/fake/infra/lib/FakeStack.ts',
            name: 'FakeStack',
            contents: `${barrier}\nnew ecs.FargateService(this, 'Api', {}); new lambda.Function(this, 'M', { ${runner} }); grantConnect(role);`,
        };
        const inert: StackSource = {
            file: 'packages/services/fake/infra/lib/InertStack.ts',
            name: 'InertStack',
            // ⛔ Prose about databases, and no database. A signal list matching bare words would fail this,
            // and ADR-0025's IngredientParserStack is exactly this shape — a long comment explaining that it
            // has no database, no VPC and nothing to connect to.
            contents: `// This function owns no database and needs no DB_HOST.\nnew lambda.Function(this, 'Parse', {});`,
        };

        expect(unbarrieredDatabaseStacks([barriered, inert], new Map())).toStrictEqual([]);
    });
});
