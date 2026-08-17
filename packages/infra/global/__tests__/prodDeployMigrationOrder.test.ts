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
 * (`FoodServiceStack.test.ts`, `RecipeServiceStack.test.ts`). What remains in the pipeline is the safety
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
import { readFileSync } from 'node:fs';
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
 * in `kitchensink-{token}-${STAGE}` — which is also the directory name under `packages/services/`.
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
 * Service packages that ship a schema-migration runner Lambda handler, discovered from the tracked tree.
 *
 * `git ls-files` rather than a directory walk, so build output (`dist/`, `dist-lambda/`) — which contains a
 * COMPILED copy of every one of these handlers — can never contribute a phantom service.
 *
 * @returns The service directory names, sorted.
 * @sideEffect Shells out to git.
 */
function runnerPackages(): readonly string[] {
    const tracked = execFileSync('git', ['ls-files', '--', SERVICES_ROOT], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);

    return [
        ...new Set(
            tracked
                .filter((file) => /\/src\/.*(^|\/)migrate(\/handler)?\.ts$/.test(file))
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

    it('places every migration step AFTER the cdk deploy of the app that owns its runner', () => {
        const steps = prodDeploySteps();
        const violations = migrationSteps(steps).flatMap((step) =>
            stackTokens(step).flatMap((token) => {
                const deploy = cdkDeployPosition(steps, token);
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
            .filter((token) => cdkDeployPosition(steps, token) === undefined);

        expect(unpaired, 'these migration steps name a stack no cdk deploy step in this job deploys').toEqual([]);
    });

    it('keeps a migration step for EVERY service that ships a runner', () => {
        // The other complement: satisfying the ordering by deleting the migration step. This is discovered
        // from the tree, so a service that grows a runner and no pipeline step fails here — which is how
        // the recipe service's schema came to be missing entirely on a preview that was otherwise green.
        const steps = prodDeploySteps();
        const invoked = new Set(migrationSteps(steps).flatMap((step) => stackTokens(step)));
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
