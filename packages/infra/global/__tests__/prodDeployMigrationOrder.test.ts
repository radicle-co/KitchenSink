// @vitest-environment node
/**
 * A schema migration can only be applied by a runner that has ALREADY BEEN DEPLOYED with it. That single
 * fact fixes the order of three steps in `prod-deploy.yml`, and this suite pins all three positionally.
 *
 * ## The hazard
 *
 * `cdk deploy` returns only once the ECS service has STABILISED. So "deploy, then invoke the migration
 * runner" puts the new image in front of live traffic for the entire stabilisation window with the OLD
 * schema underneath it. That window stopped being theoretical when food's read path came to depend on
 * `food_nutrient_view` (migration `0006`): every nutrition read 500s, and prod is now fronted by
 * CloudFront, which caches them.
 *
 * ## ⛔ Why the obvious repair is FORBIDDEN, and why that is what this file asserts
 *
 * The instinct is to move the migrate step above its `cdk deploy`. That is silently WORSE than the hazard.
 * Each service's `esbuild.mjs` copies `src/**\/migrations/*.sql` into the Lambda bundle at BUILD time, and
 * the bundle ships WITH `cdk deploy` — so invoking first invokes the PREVIOUS deploy's Lambda carrying the
 * PREVIOUS migration set. It exits 0, reports nothing pending, applies nothing, and the new tasks still meet
 * a missing relation. Nothing in the pipeline can tell the difference between "no migrations were needed"
 * and "the runner had never heard of them".
 *
 * The real repair therefore lives INSIDE the deploy — an `aws-cdk-lib/triggers` `Trigger` between the
 * Lambda's code update and the ECS service's rollout, asserted in each service's own infra suite
 * (`FoodServiceStack.test.ts`, `RecipeServiceStack.test.ts`, and identity's `stacks.test.ts` — identity's
 * runner moved OUT of the webhooks app precisely so it could take part). What remains in the pipeline is the safety
 * net: an idempotent invocation that catches a stage whose schema is behind for a reason no code change
 * explains (a restore, a newly-created stage, a stack whose asset was never bundled). Both mechanisms
 * depend on the same ordering, so the ordering is what is pinned here.
 *
 * ## Why positional, and why nothing is enumerated
 *
 * Same reasoning as `prodDeployBuildOrder.test.ts`, which pins the `npm prune --omit=dev` one-way door in
 * this same file: the invariant is about WHERE a step sits, so the assertions read STEP INDICES out of the
 * parsed workflow rather than matching text. Neither the services nor the stacks are listed — the migration
 * steps are discovered from the workflow, their owning package is derived from the CloudFormation stack
 * name each one queries, and the set of services that OWN a runner is discovered from the tree. A fourth
 * service that ships a migration runner is covered the day its handler lands, and cannot opt out by not
 * being mentioned here.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EPHEMERAL_SLOT_ORDER, cutOverServicesFromEnv } from '@kitchensink/infra-alb';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/** Repo root — this file sits at `packages/infra/global/__tests__`, so the root is four levels up. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const WORKFLOW = path.join(repoRoot, '.github/workflows/prod-deploy.yml');

/** Where the deployable services live. A runner package is always one of these. */
const SERVICES_ROOT = 'packages/services';

interface WorkflowStep {
    readonly name?: string;
    readonly id?: string;
    readonly if?: string;
    readonly run?: string;
}

/** A step plus the index that every assertion here is actually about. */
interface IndexedStep extends WorkflowStep {
    readonly index: number;
}

/**
 * The `Deploy Production` job's steps, in file order, each carrying its index.
 *
 * @returns The indexed steps.
 * @sideEffect Reads the workflow from disk.
 */
function prodDeploySteps(): readonly IndexedStep[] {
    const doc = parse(readFileSync(WORKFLOW, 'utf8')) as {
        jobs: Record<string, { steps?: WorkflowStep[] }>;
    };
    const [job] = Object.values(doc.jobs);

    return (job?.steps ?? []).map((step, index) => ({ ...step, index }));
}

/**
 * Steps that invoke a schema-migration runner Lambda. Both conditions are required: `aws lambda invoke`
 * alone would also catch an unrelated invocation, and the migration-function output name alone would catch
 * the step that merely resolves it.
 *
 * @param steps - The job's steps.
 * @returns The migration-invoking steps.
 */
function migrationSteps(steps: readonly IndexedStep[]): readonly IndexedStep[] {
    return steps.filter(
        (step) => /aws lambda invoke/.test(step.run ?? '') && /MigrationFunctionName/.test(step.run ?? ''),
    );
}

/**
 * The CloudFormation stack a migration step resolves its function name from, reduced to the service token
 * in `kitchensink-{token}-${STAGE}`.
 *
 * Deriving the owning package from the stack the step ITSELF names is the point: it cannot drift from the
 * step, and it needs no table of services to maintain.
 *
 * @param step - A migration-invoking step.
 * @returns The service tokens named in the step, in order of appearance.
 */
function stackTokens(step: IndexedStep): readonly string[] {
    return [...(step.run ?? '').matchAll(/kitchensink-([a-z0-9-]+)-\$\{STAGE\}/g)].map((match) => match[1] as string);
}

/**
 * Stack token → the service package that DECLARES that stack, read out of each service's CDK entrypoint.
 *
 * ⚠️ This map used to be the identity function, and that assumption was load-bearing without saying so.
 * It holds for `food-service` and `recipe-service`, whose stack is `kitchensink-{dir}-{stage}` — and it
 * does NOT hold for identity, whose ECS stack is `kitchensink-identity-service-{stage}` inside
 * `packages/services/identity`. While identity's migration runner lived in `identity-webhooks` (where the
 * token happens to equal the directory) nothing here noticed; the day the runner moved to the stack that
 * actually owns the ECS service, every assertion below would have failed on a naming coincidence rather
 * than on a real ordering defect — and the tempting repair is to except identity, which would have
 * exempted the one service where a schema/code mismatch is a failed SIGN-IN rather than a degraded read.
 *
 * So the pairing is DERIVED instead: each service's `infra/bin` CDK entrypoint states its own
 * `stackName:` template, which is the same string CI passes to `describe-stacks`. Nothing is enumerated,
 * and a service that renames its stack updates this map by editing the one place the name is written.
 *
 * @returns Stack token → the directory under `packages/services/` whose CDK app declares it.
 * @sideEffect Shells out to git and reads the CDK entrypoints.
 */
function stackTokenOwners(): ReadonlyMap<string, string> {
    const owners = new Map<string, string>();
    const entrypoints = execFileSync('git', ['ls-files', '--', `${SERVICES_ROOT}/*/infra/bin/*.ts`], {
        cwd: repoRoot,
        encoding: 'utf8',
    })
        .split('\n')
        .filter(Boolean);

    for (const file of entrypoints) {
        const serviceDir = file.split('/')[2] as string;
        const source = readFileSync(path.join(repoRoot, file), 'utf8');

        for (const match of source.matchAll(/stackName:\s*`kitchensink-([a-z0-9-]+)-\$\{[A-Za-z_]\w*\}`/g)) {
            owners.set(match[1] as string, serviceDir);
        }
    }

    return owners;
}

/**
 * The service package a migration step's stack belongs to.
 *
 * @param token - The service token from `kitchensink-{token}-${STAGE}`.
 * @returns The directory under `packages/services/`, or `undefined` when no CDK app declares that stack.
 * @sideEffect Reads the CDK entrypoints (via {@link stackTokenOwners}).
 */
function ownerPackage(token: string): string | undefined {
    return stackTokenOwners().get(token);
}

/**
 * Where a command runs: which step, and how far into that step's script.
 *
 * ⚠️ The offset is not fussiness. A step's `run` is a SCRIPT — several commands in written order — and this
 * job already puts a bundle and a deploy in one such block. Comparing step indices alone reads two commands
 * in one step as simultaneous, so "bundle, then deploy" and "deploy, then bundle" would be
 * indistinguishable, and the second is precisely the mistake being guarded against.
 */
interface CommandPosition {
    /** The step's index within the job. */
    readonly step: number;
    /** The match offset within that step's `run` script. */
    readonly offset: number;
}

/**
 * Compare two command positions in execution order.
 *
 * @param a - The earlier candidate.
 * @param b - The later candidate.
 * @returns Negative when `a` runs first, positive when `b` does, zero when they are the same command.
 */
const runsBefore = (a: CommandPosition, b: CommandPosition): number => a.step - b.step || a.offset - b.offset;

/**
 * Where the first command matching a pattern runs, or `undefined`.
 *
 * @param steps - The job's steps.
 * @param pattern - The command pattern.
 * @param requiredText - Text the step's script must also contain (the subject the command acts on).
 * @returns The position, or `undefined` when no step matches.
 */
function commandPosition(
    steps: readonly IndexedStep[],
    pattern: RegExp,
    requiredText?: readonly string[],
): CommandPosition | undefined {
    for (const step of steps) {
        const run = step.run ?? '';

        if (requiredText !== undefined && !requiredText.some((text) => run.includes(text))) {
            continue;
        }

        const offset = run.search(pattern);

        if (offset !== -1) {
            return { step: step.index, offset };
        }
    }

    return undefined;
}

/**
 * Where the `cdk deploy` of a service package's CDK app runs, or `undefined`.
 *
 * @param steps - The job's steps.
 * @param serviceDir - The directory name under `packages/services/`.
 * @returns The position, or `undefined` when no step deploys that app.
 */
function cdkDeployPosition(steps: readonly IndexedStep[], serviceDir: string): CommandPosition | undefined {
    return commandPosition(steps, /cdk deploy/, [`${SERVICES_ROOT}/${serviceDir}/infra`]);
}

/**
 * Service packages that ship a schema-migration runner Lambda handler, discovered from the working tree.
 *
 * `git ls-files` rather than a directory walk, so build output (`dist/`, `dist-lambda/`) — which contains a
 * COMPILED copy of every one of these handlers — can never contribute a phantom service.
 *
 * ⚠️ `--others --exclude-standard` as well as the index, and the `existsSync` filter below, because a
 * plain `git ls-files` describes the INDEX rather than the tree: a runner added but not yet staged is
 * invisible to it, and one deleted but not yet staged is still listed. A change that MOVES a runner from
 * one package to another is BOTH at once, so the unadjusted guard would have been wrong in both directions
 * for exactly the change it most needs to police — and a guard that only tells the truth after `git add`
 * is a guard that gets run too late to stop anything. `--exclude-standard` keeps the build output out.
 *
 * @returns The service directory names, sorted.
 * @sideEffect Shells out to git and stats the results.
 */
function runnerPackages(): readonly string[] {
    const tracked = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '--', SERVICES_ROOT],
        { cwd: repoRoot, encoding: 'utf8' },
    )
        .split('\n')
        .filter(Boolean);

    return [
        ...new Set(
            tracked
                .filter((file) => /\/src\/.*(^|\/)migrate(\/handler)?\.ts$/.test(file))
                // `git ls-files` reads the INDEX, which still lists a file that has been deleted in the
                // working tree but not yet staged. Without this the guard would demand a pipeline step for a
                // runner that no longer exists — which is exactly the state a change that MOVES a runner
                // between packages passes through, and a guard that is wrong mid-change is a guard people
                // learn to run after committing.
                .filter((file) => existsSync(path.join(repoRoot, file)))
                .map((file) => file.split('/')[2] as string),
        ),
    ].sort();
}

/** A service's manifest, reduced to what the assertions below read out of it. */
interface ServiceManifest {
    /** The declared package name — the identifier `turbo run … --filter=` uses. */
    readonly name: string;
    /** Its npm scripts. */
    readonly scripts?: Readonly<Record<string, string>>;
}

/**
 * A service's manifest.
 *
 * @param serviceDir - The directory name under `packages/services/`.
 * @returns The parsed manifest.
 * @sideEffect Reads the manifest from disk.
 */
function manifest(serviceDir: string): ServiceManifest {
    return JSON.parse(
        readFileSync(path.join(repoRoot, SERVICES_ROOT, serviceDir, 'package.json'), 'utf8'),
    ) as ServiceManifest;
}

/**
 * The npm scripts that actually produce a service's Lambda BUNDLE — the esbuild script itself, plus any
 * script that chains to it.
 *
 * ⚠️ Naming the general-purpose `build` script here would be the whole gate's blind spot, which is why the
 * set is derived from the manifest instead of assumed. The two feature services bundle under
 * `bundle:lambda` while `build` is `nest build`, so accepting `build` for them would let a pipeline that
 * NEVER bundles the runner pass — and an unbundled runner deploys as the inline placeholder. The identity
 * webhooks package is the opposite case: its `build` IS `tsc … && npm run package`, so `turbo run build`
 * genuinely bundles it. Both facts come from the same read, so neither can drift from the manifest.
 *
 * @param serviceDir - The directory name under `packages/services/`.
 * @returns The script names that reach the bundler, or an empty list when the service has no bundler.
 * @sideEffect Reads the manifest from disk.
 */
function bundlingScripts(serviceDir: string): readonly string[] {
    const scripts = manifest(serviceDir).scripts ?? {};
    const bundler = Object.entries(scripts).find(([, command]) => /esbuild/.test(command))?.[0];

    if (bundler === undefined) {
        return [];
    }

    const chains = Object.entries(scripts)
        .filter(([, command]) => command.includes(`npm run ${bundler}`))
        .map(([name]) => name);

    return [bundler, ...chains];
}

describe('prod-deploy.yml — a migration runner is invoked only AFTER the deploy that ships its SQL', () => {
    it('discovers migration steps at all, and one per service that owns a runner', () => {
        // Anchors everything below. If the discovery predicate stops matching — a step renamed, the AWS CLI
        // call reshaped — the positional assertions would pass vacuously over an empty list rather than
        // fail, which is the single way a guard like this rots.
        const steps = migrationSteps(prodDeploySteps());

        expect(steps.length, 'expected the identity, food and recipe migration invocations').toBe(
            runnerPackages().length,
        );
    });

    it('resolves every migration step to the service package whose CDK app declares that stack', () => {
        // Anchors the pairing itself. Every assertion below turns a stack token into a package directory;
        // if a token resolves to nothing, those assertions would compare against `undefined` and could only
        // fail with a confusing message — or, worse, be "fixed" by excepting the service that broke.
        const steps = prodDeploySteps();
        const unowned = migrationSteps(steps)
            .flatMap((step) => stackTokens(step))
            .filter((token) => ownerPackage(token) === undefined);

        expect(unowned, 'no packages/services/*/infra/bin CDK app declares these stacks').toEqual([]);
    });

    it('places every migration step AFTER the cdk deploy of the app that owns its runner', () => {
        const steps = prodDeploySteps();
        const violations = migrationSteps(steps).flatMap((step) =>
            stackTokens(step).flatMap((token) => {
                const deploy = cdkDeployPosition(steps, ownerPackage(token) ?? token);
                const invoke = commandPosition([step], /aws lambda invoke/);

                return deploy === undefined || (invoke !== undefined && runsBefore(deploy, invoke) < 0)
                    ? []
                    : [`${step.name ?? '(unnamed)'} (step ${step.index}) runs before ${token}'s cdk deploy`];
            }),
        );

        expect(
            violations,
            'moving a migrate step above its deploy invokes the PREVIOUS bundle: exit 0, nothing applied, ' +
                'and the new tasks still meet a missing relation',
        ).toEqual([]);
    });

    it('resolves every migration step to a cdk deploy step that actually exists', () => {
        // The complement of the rule above: satisfying "after the deploy" by DELETING the deploy — or by
        // renaming the app path so the two can no longer be paired — must not read as compliance.
        const steps = prodDeploySteps();
        const unpaired = migrationSteps(steps)
            .flatMap((step) => stackTokens(step))
            .filter((token) => cdkDeployPosition(steps, ownerPackage(token) ?? token) === undefined);

        expect(unpaired, 'these migration steps name a stack no cdk deploy step in this job deploys').toEqual([]);
    });

    it('keeps a migration step for EVERY service that ships a runner', () => {
        // The other complement: satisfying the ordering by deleting the migration step. This is discovered
        // from the tree, so a service that grows a runner and no pipeline step fails here — which is how
        // the recipe service's schema came to be missing entirely on a preview that was otherwise green.
        const steps = prodDeploySteps();
        const invoked = new Set(
            migrationSteps(steps).flatMap((step) => stackTokens(step).map((token) => ownerPackage(token) ?? token)),
        );
        const missing = runnerPackages().filter((service) => !invoked.has(service));

        expect(missing, 'these services ship a migration runner that prod-deploy never invokes').toEqual([]);
    });

    it('builds every runner bundle BEFORE the deploy that ships it', () => {
        // The failure this catches is the quietest of the lot. Both feature-service stacks fall back to an
        // inline placeholder when `dist-lambda/` is absent, so a deploy whose bundle step was moved,
        // renamed or dropped ships a Lambda that is not the migration runner at all — and the migration
        // step then invokes THAT, successfully.
        const steps = prodDeploySteps();
        const violations = runnerPackages().flatMap((service) => {
            const deploy = cdkDeployPosition(steps, service);
            const identifiers = [`${SERVICES_ROOT}/${service}`, manifest(service).name];
            const scripts = bundlingScripts(service);

            if (scripts.length === 0) {
                return [`${service}: ships a migration runner but its manifest has no esbuild script`];
            }

            // `npm run <script> --workspace=…` and `turbo run <script> --filter=…` are the only two forms
            // this workflow uses; both are matched against the SAME derived script set.
            const invokesBundler = new RegExp(
                `(?:npm|turbo) run (?:${scripts.map((script) => script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w:-])`,
            );
            const build = commandPosition(steps, invokesBundler, identifiers);

            if (build === undefined) {
                return [`${service}: no step builds its Lambda bundle`];
            }

            return deploy !== undefined && runsBefore(build, deploy) > 0
                ? [`${service}: bundled at ${JSON.stringify(build)}, deployed at ${JSON.stringify(deploy)}`]
                : [];
        });

        expect(violations, 'an unbundled runner deploys as a placeholder and migrates nothing').toEqual([]);
    });
});

/**
 * ⛔ THE ACCEPTANCE CRITERION for `EDGE_CUTOVER_SERVICES` in the production pipeline.
 *
 * ## The outage this exists to prevent, which was one merge away
 *
 * U17's cutover was run BY HAND, with `EDGE_CUTOVER_SERVICES` exported into a shell. The pipeline never
 * learned it. `publicRecordOwnerFor` treats an unset variable as "nobody has cut over" — the correct and
 * deliberate default — so the next CI deploy to prod would have synthesized the PRE-cutover template for
 * all three services: each re-creating the `{service}.commise.app` A-record that `EdgeStack` now owns, and
 * re-adding the public host to its ALB listener rule.
 *
 * Both failure modes are documented in `publicRecordOwner.ts` and both are bad: Route 53 refuses a
 * duplicate record, so the deploy either fails outright, or — if EdgeStack's copy loses a race — the apex
 * services come off CloudFront entirely and land back on a load balancer that no longer accepts them.
 *
 * A shell variable is not a deploy. This asserts the pipeline carries the same fact the operator did.
 */
describe('the production pipeline knows which services are cut over to the edge', () => {
    it('⛔ declares EDGE_CUTOVER_SERVICES at all — unset means "nobody cut over"', () => {
        const workflow = readFileSync(WORKFLOW, 'utf8');

        expect(workflow).toContain('EDGE_CUTOVER_SERVICES');
    });

    it('⛔ names EVERY service whose public record EdgeStack owns', () => {
        // Derived from the shared registry, not a literal list, so a fourth service added to the edge is a
        // failure HERE rather than a missing record in production.
        const workflow = readFileSync(WORKFLOW, 'utf8');
        const declared = /EDGE_CUTOVER_SERVICES:\s*([^\n#]+)/.exec(workflow)?.[1]?.trim() ?? '';
        const named = cutOverServicesFromEnv({ EDGE_CUTOVER_SERVICES: declared });

        expect([...named].sort()).toStrictEqual([...EPHEMERAL_SLOT_ORDER].sort());
    });

    it('parses through the SAME resolver the stacks use, so a typo cannot pass here and fail there', () => {
        // `cutOverServicesFromEnv` throws on an unknown name. Running the workflow's literal value through
        // it is what makes this test an equivalence check rather than a spelling check.
        const workflow = readFileSync(WORKFLOW, 'utf8');
        const declared = /EDGE_CUTOVER_SERVICES:\s*([^\n#]+)/.exec(workflow)?.[1]?.trim() ?? '';

        expect(() => cutOverServicesFromEnv({ EDGE_CUTOVER_SERVICES: declared })).not.toThrow();
    });
});

/**
 * ⛔ THE SECOND HALF OF THE SAME INVARIANT: a Lambda that talks to a service's database is CODE, governed by
 * the same rule as that service's ECS tasks — it may not be updated ahead of the schema it reads.
 *
 * ## What the trigger above does NOT reach
 *
 * `RecipeServiceStack`'s `triggers.Trigger` orders the migration ahead of `apiService`, and CloudFormation
 * enforces that absolutely — INSIDE one stack. The recipe **workers** are six DB-touching Lambdas in a
 * DIFFERENT CDK app (`kitchensink-recipe-workers-{stage}`), applied by a SEPARATE `cdk deploy`, and both
 * pipelines run that deploy FIRST. So every release shipped new worker code over the old schema and left it
 * there until the service deploy's trigger caught up — and an SQS-driven worker (archive, erasure,
 * handle-sync) is fed by the STILL-RUNNING previous release for that whole window, so it is not idle time.
 * On a first-ever `pr-{N}` deploy it is worse than skew: the per-PR logical database is created BY the
 * migration run (ADR-0006), so until then the six workers address a database that does not exist.
 *
 * ## Why this is a guard and not a `DependsOn`
 *
 * No CloudFormation primitive spans two CDK apps run as two CLI invocations. There are therefore exactly two
 * ways for a DB-touching stack to be safe, and this suite accepts EITHER:
 *
 *   1. it is deployed after the migration-owning app, so the pipeline's own sequencing orders it; or
 *   2. it carries its OWN in-deploy barrier — a `triggers.Trigger` over the same migration runner, with the
 *      DB-touching resources behind it — which is a real `DependsOn` and needs no pipeline cooperation.
 *
 * ⛔ Reordering the pipeline to reach (1) was considered and REJECTED, and the reason is not the one that
 * first suggests itself. The workers-first order is not merely an SSM accident (`RecipeWorkersStack` publishes
 * the `account-erasure-queue-{url,arn}` parameters that `RecipeServiceStack` resolves at deploy time, so the
 * service cannot even synthesize first on a new stage): it is also the CORRECT order for a queue, because the
 * CONSUMER must upgrade before the PRODUCER. Deploying the service first would trade a schema-skew window for
 * a message-contract-skew window on the account-erasure path, which is not an improvement — it is a different
 * defect on a right-to-erasure request. So recipe takes route (2).
 *
 * ## What this guard can and cannot see
 *
 * It checks that the barrier EXISTS in the stack that addresses the database. That the barrier COVERS every
 * DB-touching resource — the way a `triggers.Trigger` stops being a barrier while keeping its name — is a
 * property of the synthesized template, and is asserted where the template is:
 * `packages/services/recipe-workers/infra/__tests__/RecipeWorkersStack.test.ts` derives the covered set from
 * the template itself, so a seventh worker cannot be added outside it.
 *
 * ## Nothing is enumerated
 *
 * "Addresses the same database" is DERIVED, from the TWO authorities a logical database has in this repo:
 *
 *   1. a `…/database-name` module — `recipe-service` and `recipe-workers` both import
 *      `@kitchensink/recipe-core/database-name`, which is what pairs them; and
 *   2. the `kitchensink-data-{stage}` export that names the database or the credentials that carry it
 *      (`DatabaseSecretArn`, `DatabaseName`) — identity's authority, because its runner resolves host,
 *      database and credentials from the secret at RUNTIME rather than from a name module.
 *
 * ⚠️ (2) is not a widening for its own sake — while only (1) was read, `identity` and `identity-webhooks`
 * were NOT DISCOVERED AS A PAIR AT ALL, so the gate below said nothing about the five DB-touching Lambdas
 * in `WebhooksStack`. They are safe today only because both pipelines happen to `cdk deploy` them AFTER the
 * identity service (the deploy that applies the schema), and nothing asserted that. Hoisting that one step
 * would have put new webhook code — the read-through user create, the deletion worker, the erasure
 * reconciler — on the previous release's schema, silently, with every gate green. See ADR-0022.
 *
 * Food's name authority is private to its single stack, so it has no peer and is correctly not asserted
 * over. A future second stack on an existing database is covered the day it imports either authority.
 */

/**
 * The workflows that deploy a whole stage.
 *
 * ⚠️ `sandbox-identity-deploy.yml` belongs here for the same reason (2) above belongs in the pairing: it is
 * the ONLY workflow that deploys the shared sandbox identity service and its webhooks, so leaving it out
 * asserted the ordering in prod and left sandbox — the stage every PR preview signs in against — unguarded.
 */
const DEPLOY_WORKFLOWS = [
    '.github/workflows/prod-deploy.yml',
    '.github/workflows/sandbox-deploy.yml',
    '.github/workflows/sandbox-identity-deploy.yml',
] as const;

/** One job's steps, carrying enough identity for a failure message to name where it came from. */
interface WorkflowJob {
    /** Repo-relative workflow path. */
    readonly workflow: string;
    /** The job's key under `jobs:`. */
    readonly id: string;
    /** Its steps, in file order, each carrying its index. */
    readonly steps: readonly IndexedStep[];
}

/**
 * Every job of every deploy workflow.
 *
 * ⚠️ Ordering is only ever compared WITHIN a job, and that is not a simplification: steps in a job run in
 * file order, whereas jobs run in `needs:` order, so indices from two jobs are not comparable at all. Both
 * recipe deploys already live in one job in each workflow.
 *
 * @returns The jobs.
 * @sideEffect Reads the workflows from disk.
 */
function deployJobs(): readonly WorkflowJob[] {
    return DEPLOY_WORKFLOWS.flatMap((workflow) => {
        const doc = parse(readFileSync(path.join(repoRoot, workflow), 'utf8')) as {
            jobs: Record<string, { steps?: WorkflowStep[] }>;
        };

        return Object.entries(doc.jobs).map(([id, job]) => ({
            workflow,
            id,
            steps: (job.steps ?? []).map((step, index) => ({ ...step, index })),
        }));
    });
}

/**
 * A service package's CDK infra sources (`infra/bin` + `infra/lib`).
 *
 * Tracked-plus-untracked and `existsSync`-filtered for the reason {@link runnerPackages} records: a guard
 * that only tells the truth after `git add` is run too late to stop anything.
 *
 * @param serviceDir - The directory name under `packages/services/`.
 * @returns Repo-relative paths.
 * @sideEffect Shells out to git and stats the results.
 */
function infraSources(serviceDir: string): readonly string[] {
    return execFileSync(
        'git',
        [
            'ls-files',
            '--cached',
            '--others',
            '--exclude-standard',
            '--',
            `${SERVICES_ROOT}/${serviceDir}/infra/bin`,
            `${SERVICES_ROOT}/${serviceDir}/infra/lib`,
        ],
        { cwd: repoRoot, encoding: 'utf8' },
    )
        .split('\n')
        .filter((file) => file.endsWith('.ts') && existsSync(path.join(repoRoot, file)));
}

/**
 * Every service package under `packages/services/`.
 *
 * @returns The directory names, sorted.
 * @sideEffect Shells out to git.
 */
function serviceDirs(): readonly string[] {
    return [
        ...new Set(
            execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', SERVICES_ROOT], {
                cwd: repoRoot,
                encoding: 'utf8',
            })
                .split('\n')
                .filter(Boolean)
                .map((file) => file.split('/')[2] as string),
        ),
    ].sort();
}

/** An infra source paired with the database authorities it names. */
interface DatabaseAddressingSource {
    /** Repo-relative path. */
    readonly file: string;
    /** The database authorities it names — a `…/database-name` module, or a `kitchensink-data-*` export. */
    readonly authorities: readonly string[];
    /** The file's text, so a caller can ask what else it declares. */
    readonly source: string;
}

/**
 * A service's infra sources that name a logical database, with the authority each one names.
 *
 * Two forms, because this repo has two — and reading only the first is what left `identity` and
 * `identity-webhooks` undiscovered as a pair (see the block comment above):
 *
 *   - `from '….../database-name'` — the module that DERIVES a per-stage database name (food's is private to
 *     its own stack; recipe's is shared, which is what pairs its two apps);
 *   - `kitchensink-data-${stage}:DatabaseSecretArn` / `:DatabaseName` — the data stack's export naming the
 *     database, or the credentials that carry it. Normalized to drop the stage token, since the pairing is
 *     about WHICH database, not which stage.
 *
 * ⚠️ The stage token is matched as `${…}`, not `.*`: `kitchensink-data-` is also a stack-name prefix, and a
 * looser pattern would pair every service that merely reads an unrelated export off the same stack.
 *
 * @param serviceDir - The directory name under `packages/services/`.
 * @returns One entry per infra source that names a database authority.
 * @sideEffect Reads the infra sources.
 */
function databaseAddressingSources(serviceDir: string): readonly DatabaseAddressingSource[] {
    return infraSources(serviceDir).flatMap((file) => {
        const source = readFileSync(path.join(repoRoot, file), 'utf8');
        const authorities = [
            ...[...source.matchAll(/from\s+'([^']*\/database-name)'/g)].map((match) => match[1] as string),
            ...[...source.matchAll(/kitchensink-data-\$\{[A-Za-z_]\w*\}:(DatabaseSecretArn|DatabaseName)/g)].map(
                (match) => `kitchensink-data:${match[1] as string}`,
            ),
        ];

        return authorities.length === 0 ? [] : [{ file, authorities, source }];
    });
}

/**
 * The OTHER service packages whose infra addresses the same logical database as `serviceDir`.
 *
 * @param serviceDir - The migration-owning service.
 * @returns The peer directory names, sorted.
 * @sideEffect Reads every service's infra sources.
 */
function servicesSharingDatabaseWith(serviceDir: string): readonly string[] {
    const owned = new Set(databaseAddressingSources(serviceDir).flatMap((entry) => entry.authorities));

    if (owned.size === 0) {
        return [];
    }

    return serviceDirs()
        .filter((candidate) => candidate !== serviceDir)
        .filter((candidate) =>
            databaseAddressingSources(candidate).some((entry) =>
                entry.authorities.some((authority) => owned.has(authority)),
            ),
        );
}

/**
 * Whether a service's DB-addressing stack constructs an in-deploy migration barrier.
 *
 * The barrier must be declared in the SAME file that names the database — a `Trigger` somewhere else in the
 * package would satisfy a looser scan while ordering nothing that touches this schema.
 *
 * @param serviceDir - The directory name under `packages/services/`.
 * @returns `true` when at least one DB-addressing source constructs a `triggers.Trigger`.
 * @sideEffect Reads the infra sources.
 */
function carriesMigrationBarrier(serviceDir: string): boolean {
    return databaseAddressingSources(serviceDir).some((entry) => /new\s+triggers\.Trigger\s*\(/.test(entry.source));
}

/**
 * Every step in which a command matching `pattern` runs — one position per matching step, unlike
 * {@link commandPosition}, which stops at the first.
 *
 * @param steps - The job's steps.
 * @param pattern - The command pattern.
 * @param requiredText - Text the step's script must also contain.
 * @returns Every matching position, in execution order.
 */
function commandPositions(
    steps: readonly IndexedStep[],
    pattern: RegExp,
    requiredText: readonly string[],
): readonly CommandPosition[] {
    return steps.flatMap((step) => {
        const run = step.run ?? '';

        if (!requiredText.some((text) => run.includes(text))) {
            return [];
        }

        const offset = run.search(pattern);

        return offset === -1 ? [] : [{ step: step.index, offset }];
    });
}

/** A migration-owning service paired with a peer stack that addresses the same database, within one job. */
interface SharedDatabaseDeploy {
    readonly job: WorkflowJob;
    readonly owner: string;
    readonly peer: string;
    readonly ownerDeploy: CommandPosition;
    readonly peerDeploys: readonly CommandPosition[];
}

/**
 * Every (migration-owning service, peer stack) pair that a single job deploys BOTH of.
 *
 * @returns The pairs.
 * @sideEffect Reads the workflows and every service's sources.
 */
function sharedDatabaseDeploys(): readonly SharedDatabaseDeploy[] {
    return deployJobs().flatMap((job) => {
        const owners = new Set(
            migrationSteps(job.steps).flatMap((step) =>
                stackTokens(step)
                    .map((token) => ownerPackage(token))
                    .filter((owner): owner is string => owner !== undefined),
            ),
        );

        return [...owners].flatMap((owner) => {
            const ownerDeploy = cdkDeployPosition(job.steps, owner);

            if (ownerDeploy === undefined) {
                return [];
            }

            return servicesSharingDatabaseWith(owner).flatMap((peer) => {
                const peerDeploys = commandPositions(job.steps, /cdk deploy/, [`${SERVICES_ROOT}/${peer}/infra`]);

                return peerDeploys.length === 0 ? [] : [{ job, owner, peer, ownerDeploy, peerDeploys }];
            });
        });
    });
}

describe('a stack that shares a service database is ordered behind that schema, one way or the other', () => {
    it('discovers a shared-database pair at all, in every workflow that deploys one', () => {
        // Anchors both assertions below, exactly as the first test in this file anchors its own: a discovery
        // predicate that quietly stops matching turns them into assertions over an empty list, which is the
        // one way a guard like this rots without anyone noticing.
        const discovered = sharedDatabaseDeploys().map((pair) => `${pair.job.workflow}:${pair.owner}+${pair.peer}`);

        expect(
            [...discovered].sort(),
            'expected recipe-service + recipe-workers, and identity + identity-webhooks, in every workflow ' +
                'that deploys both halves of the pair',
        ).toStrictEqual([
            '.github/workflows/prod-deploy.yml:identity+identity-webhooks',
            '.github/workflows/prod-deploy.yml:recipe-service+recipe-workers',
            '.github/workflows/sandbox-deploy.yml:recipe-service+recipe-workers',
            '.github/workflows/sandbox-identity-deploy.yml:identity+identity-webhooks',
        ]);
    });

    it('⛔ requires a peer deployed BEFORE the migration to carry its own in-deploy barrier', () => {
        const violations = sharedDatabaseDeploys().flatMap((pair) => {
            const last = pair.peerDeploys[pair.peerDeploys.length - 1] as CommandPosition;
            const deployedAfterTheMigration = runsBefore(pair.ownerDeploy, last) < 0;

            return deployedAfterTheMigration || carriesMigrationBarrier(pair.peer)
                ? []
                : [
                      `${pair.job.workflow} (${pair.job.id}): ${pair.peer} deploys at step ${last.step}, before ` +
                          `${pair.owner}'s deploy at step ${pair.ownerDeploy.step} — the deploy that applies the ` +
                          `schema — and its own stack declares no triggers.Trigger to order it`,
                  ];
        });

        expect(
            violations,
            'a DB-touching Lambda updated ahead of the migration runs the NEW code against the OLD schema, ' +
                'and its SQS producers are the still-running previous release',
        ).toStrictEqual([]);
    });

    it('builds the migration bundle before the PEER deploy that now ships it, not just before the owner', () => {
        // A peer that carries its own barrier ships the OWNER's migration bundle — the SQL has one
        // authority, and it is not the peer's package. So the bundle step, which the suite above only
        // required to precede the OWNER's deploy, must now precede the peer's EARLIER one as well.
        //
        // The failure is loud rather than silent (an unbundled runner synthesizes a THROWING placeholder,
        // so the trigger fails the deploy), which is precisely why it is worth pinning here: a loud failure
        // in a pipeline is still a red prod deploy discovered at the worst moment.
        const violations = sharedDatabaseDeploys()
            .filter((pair) => carriesMigrationBarrier(pair.peer))
            .flatMap((pair) => {
                const scripts = bundlingScripts(pair.owner);
                const invokesBundler = new RegExp(
                    `(?:npm|turbo) run (?:${scripts
                        .map((script) => script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                        .join('|')})(?![\\w:-])`,
                );
                const build = commandPosition(pair.job.steps, invokesBundler, [
                    `${SERVICES_ROOT}/${pair.owner}`,
                    manifest(pair.owner).name,
                ]);
                const first = pair.peerDeploys[0] as CommandPosition;

                if (scripts.length === 0) {
                    return [`${pair.job.workflow}: ${pair.owner} has no esbuild script to build its runner`];
                }

                return build !== undefined && runsBefore(build, first) < 0
                    ? []
                    : [
                          `${pair.job.workflow} (${pair.job.id}): ${pair.peer} deploys at step ${first.step} but ` +
                              `${pair.owner}'s Lambda bundle is built at ${JSON.stringify(build)}`,
                      ];
            });

        expect(violations, "the peer's barrier ships the owner's runner, so it needs that bundle too").toStrictEqual(
            [],
        );
    });

    it('keeps the migration-owning stack carrying a barrier too, so the rule is not satisfied by removing one', () => {
        // The complement. Every pair above is exempted the moment the peer deploys later, so nothing here
        // would notice `RecipeServiceStack`'s own trigger being deleted — and that trigger is what keeps the
        // API tasks off an old schema. Asserted for the OWNER of each discovered pair, discovered the same way.
        const missing = [...new Set(sharedDatabaseDeploys().map((pair) => pair.owner))]
            .filter((owner) => !carriesMigrationBarrier(owner))
            .sort();

        expect(missing, 'these services own a migration runner but no longer order it against their own stack').toEqual(
            [],
        );
    });
});
