/**
 * The midnight reclaim (ADR-0061): which sandbox stacks nothing is using, and the steps that delete them.
 *
 * The nightly stop (`scheduler.ts`) powers the tier down. This module is the second half: a Step Functions loop calls
 * {@link runReclaimStep} once a minute, and each call observes the account, decides with the pure
 * {@link planReclaim}, runs the plan's actions and returns. The state machine owns the sequence, the timer, the
 * bound and the failure route; this module decides everything else and imports NO AWS SDK, so every rule is a row in
 * `reclaim.test.ts`.
 *
 * ## The three rules
 *
 *   1. **A stage owns a stack** only when the NAME is `kitchensink-<app>-pr-<N>` AND the `Environment` tag is one of
 *      that token's two spellings. A name with the wrong tag is left in place, warned about, and still counts as
 *      live for the shared tier. Its PR-close teardown (ADR-0005) can delete it only while the tag is SOME `pr-*`
 *      value: CI's role holds the same `teardownGrants` boundary as this one, so with any other tag, or none, IAM
 *      refuses both, and an operator deletes it by hand.
 *   2. **The tier is quiescent** only when a sandbox database and a sandbox NAT were FOUND and each is `stopping` or
 *      `stopped`. Finding none THROWS: a tier that cannot be seen is not a tier that is down. When it is not
 *      quiescent the run stands down, starts no delete, and only keeps tracking deletes already in flight.
 *   3. **The shared tier may go** only when no `pr-<N>` stack is left and nothing is being deployed. It goes one stack
 *      at a time, in {@link SHARED_TIER_DELETE_ORDER}, importer before exporter.
 *
 * ## ⛔ The two matchers here MIRROR shell, and a test holds them equal
 *
 * {@link PER_PR_STACK_NAME} and {@link liveTokens} restate `sandboxSharedTier.sh live-tokens`;
 * {@link environmentTagBelongs} restates `prScope.sh`'s `pr_scope_environment_tag_belongs`; and
 * {@link SHARED_TIER_DELETE_ORDER} restates the script's allowlist. ADR-0005 says there is no second matcher, and
 * this is the one recorded exception (ADR-0061): the reclaim runs inside a Lambda, which cannot source a shell file.
 * `reclaimShellParity.test.ts` EXECUTES the shell and requires the answers equal over a hostile table, so the two
 * cannot drift apart silently.
 *
 * ⛔ A DELETE IS NEVER GIVEN A ROLE. {@link ReclaimPorts.cloudFormation} deletes with the stack's own saved role, and
 * the reclaim role's IAM grant (which stacks it may name) is the only boundary. No code here passes a role.
 *
 * @pattern Reconciler — {@link planReclaim} diffs the observed account against the wanted one and returns the next actions
 * @pattern Command — {@link ReclaimAction} is a closed union, run by an exhaustive switch
 * @pattern Specification — owns / quiescent / may-go are three small predicates composed by the planner
 * @pattern Functional core, imperative shell — {@link runReclaimStep} is the only impure function here
 */

import { InvalidReclaimRequestError } from './invalidReclaimRequestError.js';
import { ReclaimTierUnobservableError } from './reclaimTierUnobservableError.js';
import {
    isSandboxRdsInstance,
    previewTokenOf,
    type Ec2InstanceSummary,
    type EcsClusterSummary,
    type RdsInstanceSummary,
} from './scheduler.js';

/**
 * The shared sandbox tier's reclaimable stacks, in DELETE order (importer before exporter).
 *
 * Mirrors `SHARED_TIER_DELETE_ORDER` in `.github/scripts/sandboxSharedTier.sh`, held equal by
 * `reclaimShellParity.test.ts`. Adding a name is a decision about destroying shared infrastructure, and it also
 * widens the `DeleteStack` grant of both teardown roles, the reclaim Lambda's and CI's non-prod role, which
 * `teardownGrants.ts` builds from this constant.
 */
export const SHARED_TIER_DELETE_ORDER = [
    'kitchensink-identity-service-sandbox',
    'kitchensink-identity-schema-sandbox',
    'kitchensink-alb-sandbox',
] as const;

/**
 * A per-PR stack name: `kitchensink-<app>-pr-<N>`, anchored at both ends.
 *
 * Mirrors the `sed` in `sandboxSharedTier.sh live-tokens`. A name that merely CONTAINS a token
 * (`…-pr-91-old`), another application's stack and the persistent tier all fail it.
 */
export const PER_PR_STACK_NAME = /^kitchensink-[a-z-]+-(pr-[0-9]+)$/u;

/** A per-PR token: `pr-` and digits (`pr_scope_is_token`). Leading zeros are accepted, as in the shell. */
const TOKEN = /^pr-[0-9]+$/u;

/** A name with a `prod` segment, which this module never deletes whatever else it says. */
const PROD_NAMED = /(?:^|-)prod(?:-|$)/u;

/** The `Environment` tag the shared sandbox tier carries, and the value the reclaim role's grant demands. */
const SHARED_TIER_ENVIRONMENT = 'sandbox';

/** The suffix a per-PR `Environment` tag carries after the token (`PR_SCOPE_ENVIRONMENT_TAG_SUFFIX`). */
const ENVIRONMENT_TAG_SUFFIX = '-sandbox';

/** One CloudFormation stack as the planner sees it. */
export interface StackSummary {
    /** The stack name. */
    readonly name: string;
    /** The stack status (`CREATE_COMPLETE`, `DELETE_IN_PROGRESS`, …). */
    readonly status: string;
    /** The stack's `Environment` tag, when it has one. */
    readonly environmentTag: string | undefined;
}

/** An ECS service as the reclaim sees it: whether it is still serving, draining or gone. */
export interface ReclaimServiceSummary {
    /** The owning cluster ARN. */
    readonly clusterArn: string;
    /** The service ARN. */
    readonly serviceArn: string;
    /** The service name. */
    readonly serviceName: string;
    /** `ACTIVE`, `DRAINING` or `INACTIVE`. */
    readonly status: string;
}

/** An ECS task as the reclaim sees it. */
export interface ReclaimTaskSummary {
    /** The owning cluster ARN. */
    readonly clusterArn: string;
    /** The task ARN. */
    readonly taskArn: string;
    /** The status ECS wants (`RUNNING` or `STOPPED`). */
    readonly desiredStatus: string;
    /** The status the task has reached (`PROVISIONING` … `STOPPED`). */
    readonly lastStatus: string;
}

/** A per-PR ECS cluster with the services and tasks the quiesce step must wait for. */
export interface ObservedCluster {
    /** The cluster ARN. */
    readonly arn: string;
    /** The cluster's `Environment` tag, when it has one. */
    readonly environmentTag?: string | undefined;
    /** Its services. */
    readonly services: readonly ReclaimServiceSummary[];
    /** Its tasks, both desired statuses. */
    readonly tasks: readonly ReclaimTaskSummary[];
}

/** Everything the planner decides from. */
export interface ReclaimObservation {
    /** Every RDS instance (the planner keeps the sandbox ones). */
    readonly rdsInstances: readonly RdsInstanceSummary[];
    /** Every EC2 instance (the planner keeps the sandbox NAT). */
    readonly natInstances: readonly Ec2InstanceSummary[];
    /** Every CloudFormation stack in the account that is not `DELETE_COMPLETE`. */
    readonly stacks: readonly StackSummary[];
    /** The per-PR clusters, with their services and tasks. */
    readonly clusters: readonly ObservedCluster[];
}

/** One thing the reclaim does. A closed union, so a new kind is a compile error at the switch that runs it. */
export type ReclaimAction =
    | { readonly kind: 'deleteService'; readonly clusterArn: string; readonly serviceArn: string }
    | { readonly kind: 'stopTask'; readonly clusterArn: string; readonly taskArn: string }
    | { readonly kind: 'deleteStack'; readonly stackName: string };

/** What {@link planReclaim} decided for one iteration. */
export interface ReclaimPlan {
    /** What to do now. */
    readonly actions: readonly ReclaimAction[];
    /** What is being waited on (a delete in flight, a draining service, a deploy). */
    readonly pending: readonly string[];
    /** Findings that do not fail the run (a per-PR name with the wrong tag). */
    readonly warnings: readonly string[];
    /** The tier was not quiescent, so no delete was started. */
    readonly standDown: boolean;
    /** Nothing to do and nothing pending. */
    readonly done: boolean;
    /** This is the final iteration the state machine will allow. */
    readonly lastIteration: boolean;
}

/**
 * Whether `tag` is an `Environment` value that belongs to PR `token`: EQUALITY against the two spellings.
 *
 * ⛔ Not a prefix rule. A tag value is drawn from a closed set the CDK apps emit, and `pr-9-sandbox` is not
 * `pr-91`'s. Mirrors `pr_scope_environment_tag_belongs`.
 *
 * @param token - A `pr-<N>` token. A malformed one belongs to nothing.
 * @param tag - The tag value.
 * @returns `true` for `pr-<N>` and `pr-<N>-sandbox` only. Pure.
 */
export function environmentTagBelongs(token: string, tag: string): boolean {
    return TOKEN.test(token) && (tag === token || tag === `${token}${ENVIRONMENT_TAG_SUFFIX}`);
}

/**
 * The `pr-<N>` token a stack NAME carries, or `undefined`.
 *
 * @param name - The stack name.
 * @returns The token. Pure.
 */
function tokenOfStackName(name: string): string | undefined {
    return PER_PR_STACK_NAME.exec(name)?.[1];
}

/**
 * The `pr-<N>` tokens that still own a stack, once each, in byte order.
 *
 * Mirrors `sandboxSharedTier.sh live-tokens`.
 *
 * @param names - Stack names.
 * @returns The tokens. Pure.
 */
export function liveTokens(names: readonly string[]): readonly string[] {
    return [...new Set(names.flatMap((name) => tokenOfStackName(name) ?? []))].sort();
}

/** Whether a stack is mid-create or mid-update (any `*_IN_PROGRESS` but a delete or a change set never executed). */
function isDeploying(status: string): boolean {
    // `REVIEW_IN_PROGRESS` is a stack whose first change set was created and never executed. It is not being deployed and
    // will never leave that state by itself, so waiting on it would spend the whole bound and fail the night. It deletes.
    return status.endsWith('_IN_PROGRESS') && status !== 'DELETE_IN_PROGRESS' && status !== 'REVIEW_IN_PROGRESS';
}

/** Whether `state` is one of the two a stopped-or-stopping resource reports. */
function isDownOrGoingDown(state: string): boolean {
    return state === 'stopping' || state === 'stopped';
}

/**
 * Whether the tier is down — or going down — and which of its parts could not be found.
 *
 * @param observation - The observed account.
 * @returns `quiescent` when every sandbox database and NAT is stopping or stopped.
 * @throws {ReclaimTierUnobservableError} When no sandbox database, or no sandbox NAT, was found.
 */
function readTier(observation: ReclaimObservation): { readonly quiescent: boolean } {
    const databases = observation.rdsInstances.filter((instance) => isSandboxRdsInstance(instance.identifier));
    const nats = observation.natInstances.filter(
        (instance) => instance.sourceDestCheck === false && (instance.nameTag ?? '').toLowerCase().includes('sandbox'),
    );
    const missing: ('database' | 'nat')[] = [
        ...(databases.length === 0 ? (['database'] as const) : []),
        ...(nats.length === 0 ? (['nat'] as const) : []),
    ];

    if (missing.length > 0) {
        throw new ReclaimTierUnobservableError(missing);
    }

    return {
        quiescent:
            databases.every((instance) => isDownOrGoingDown(instance.status)) &&
            nats.every((instance) => isDownOrGoingDown(instance.state)),
    };
}

/**
 * The next actions for one PR whose stacks the reclaim owns: quiesce ECS, then delete the stacks.
 *
 * `ecsQuiesce.sh`'s proven order, one step per call: force-delete the services, stop the tasks, wait until the
 * services are gone and the tasks stopped. Only then are the stacks deleted, so CloudFormation has nothing to drain.
 *
 * @param owned - The stage's stacks.
 * @param clusters - The stage's clusters.
 * @returns The actions and what is pending. Pure.
 */
function planStage(
    owned: readonly StackSummary[],
    clusters: readonly ObservedCluster[],
): { readonly actions: readonly ReclaimAction[]; readonly pending: readonly string[] } {
    const deploying = owned.filter((entry) => isDeploying(entry.status));

    if (deploying.length > 0) {
        return { actions: [], pending: deploying.map((entry) => entry.name) };
    }

    const services = clusters.flatMap((entry) => entry.services);
    const tasks = clusters.flatMap((entry) => entry.tasks);
    const active = services.filter((service) => service.status === 'ACTIVE');

    if (active.length > 0) {
        return {
            actions: active.map((service) => ({
                kind: 'deleteService',
                clusterArn: service.clusterArn,
                serviceArn: service.serviceArn,
            })),
            pending: [],
        };
    }

    const running = tasks.filter((task) => task.desiredStatus === 'RUNNING');

    if (running.length > 0) {
        return {
            actions: running.map((task) => ({ kind: 'stopTask', clusterArn: task.clusterArn, taskArn: task.taskArn })),
            pending: [],
        };
    }

    const draining = [
        ...services.filter((service) => service.status === 'DRAINING').map((service) => service.serviceArn),
        ...tasks.filter((task) => task.lastStatus !== 'STOPPED').map((task) => task.taskArn),
    ];

    if (draining.length > 0) {
        return { actions: [], pending: draining };
    }

    return {
        actions: owned
            .filter((entry) => entry.status !== 'DELETE_IN_PROGRESS')
            .map((entry) => ({ kind: 'deleteStack', stackName: entry.name })),
        pending: owned.filter((entry) => entry.status === 'DELETE_IN_PROGRESS').map((entry) => entry.name),
    };
}

/**
 * The next action for the shared tier: the first allowlisted stack still present, and only that one.
 *
 * ⛔ The stack must carry `Environment=sandbox`, the same condition the reclaim role's `DeleteStack` grant demands.
 * Refusing here keeps a mis-tagged stack out of the plan instead of sending a delete IAM will deny every minute.
 *
 * @param stacks - Every non-deleted stack.
 * @param mayGo - Whether the shared tier may be deleted at all now.
 * @returns The action, what is pending, and any finding. Pure.
 */
function planSharedTier(
    stacks: readonly StackSummary[],
    mayGo: boolean,
): {
    readonly actions: readonly ReclaimAction[];
    readonly pending: readonly string[];
    readonly warnings: readonly string[];
} {
    const present = SHARED_TIER_DELETE_ORDER.flatMap((name) => stacks.filter((entry) => entry.name === name));
    const inFlight = present.filter((entry) => entry.status === 'DELETE_IN_PROGRESS').map((entry) => entry.name);
    const [head] = present;

    if (!mayGo || head === undefined || inFlight.length > 0) {
        return { actions: [], pending: inFlight, warnings: [] };
    }

    if (head.environmentTag !== SHARED_TIER_ENVIRONMENT) {
        return {
            actions: [],
            pending: [],
            warnings: [
                `${head.name}: Environment tag ${JSON.stringify(head.environmentTag ?? null)} is not ` +
                    `${SHARED_TIER_ENVIRONMENT}, so the shared tier is left in place`,
            ],
        };
    }

    return { actions: [{ kind: 'deleteStack', stackName: head.name }], pending: [], warnings: [] };
}

/**
 * Decide this iteration's actions.
 *
 * @param observation - The observed account.
 * @param iteration - This iteration, from 0.
 * @param maxIterations - The bound the state machine enforces.
 * @returns The plan. Pure.
 * @throws {ReclaimTierUnobservableError} When the tier cannot be observed.
 */
export function planReclaim(observation: ReclaimObservation, iteration: number, maxIterations: number): ReclaimPlan {
    const { quiescent } = readTier(observation);
    const stacks = observation.stacks.filter((entry) => entry.status !== 'DELETE_COMPLETE');
    const warnings: string[] = [];
    const owned = new Map<string, StackSummary[]>();

    for (const entry of stacks) {
        const token = tokenOfStackName(entry.name);

        if (token === undefined) {
            continue;
        }

        if (
            entry.environmentTag === 'production' ||
            PROD_NAMED.test(entry.name) ||
            !environmentTagBelongs(token, entry.environmentTag ?? '')
        ) {
            warnings.push(
                `${entry.name}: Environment tag ${JSON.stringify(entry.environmentTag ?? null)} does not belong to ` +
                    `${token}, so it is left for its PR-close teardown, or for an operator when the tag is not pr-*`,
            );
            continue;
        }

        owned.set(token, [...(owned.get(token) ?? []), entry]);
    }

    const actions: ReclaimAction[] = [];
    const pending: string[] = [];

    for (const token of [...owned.keys()].sort()) {
        const own = owned.get(token) ?? [];

        if (!quiescent) {
            pending.push(...own.filter((entry) => entry.status === 'DELETE_IN_PROGRESS').map((entry) => entry.name));
            continue;
        }

        const stage = planStage(
            own,
            observation.clusters.filter((entry) => previewTokenOf(entry) === token),
        );

        actions.push(...stage.actions);
        pending.push(...stage.pending);
    }

    const noTokenLeft = liveTokens(stacks.map((entry) => entry.name)).length === 0;
    const nothingDeploying = !stacks.some(
        (entry) =>
            entry.name.startsWith('kitchensink-') &&
            (entry.name.endsWith('-sandbox') || tokenOfStackName(entry.name) !== undefined) &&
            isDeploying(entry.status),
    );
    const shared = planSharedTier(stacks, quiescent && noTokenLeft && nothingDeploying);

    actions.push(...shared.actions);
    pending.push(...shared.pending);
    warnings.push(...shared.warnings);

    return {
        actions,
        pending,
        warnings,
        standDown: !quiescent,
        done: actions.length === 0 && pending.length === 0,
        lastIteration: iteration >= maxIterations - 1,
    };
}

/** A parsed call from the state machine. */
export type ReclaimRequest =
    | { readonly kind: 'step'; readonly iteration: number; readonly maxIterations: number }
    | { readonly kind: 'report'; readonly error: unknown };

/**
 * Parse the state machine's input.
 *
 * ⛔ Nothing is defaulted: an unreadable iteration or bound is refused, because a reclaim that guessed its own
 * bound could loop for ever or never report.
 *
 * @param event - The raw invocation payload.
 * @returns The request. Pure.
 * @throws {InvalidReclaimRequestError} When the event is neither a well-formed step nor a report.
 */
export function parseReclaimRequest(event: unknown): ReclaimRequest {
    if (typeof event !== 'object' || event === null) {
        throw new InvalidReclaimRequestError(event);
    }

    const { kind, iteration, maxIterations, error } = event as Record<string, unknown>;

    if (kind === 'report') {
        return { kind, error };
    }

    if (
        kind === 'step' &&
        typeof iteration === 'number' &&
        typeof maxIterations === 'number' &&
        Number.isInteger(iteration) &&
        Number.isInteger(maxIterations) &&
        iteration >= 0 &&
        maxIterations >= 1 &&
        iteration < maxIterations
    ) {
        return { kind, iteration, maxIterations };
    }

    throw new InvalidReclaimRequestError(event);
}

/** CloudFormation operations the reclaim needs. */
export interface ReclaimCloudFormationApi {
    /** Every stack that is not `DELETE_COMPLETE`, with its `Environment` tag. Pages through all of them. */
    listStacks(): Promise<StackSummary[]>;
    /** Delete a stack using its own saved role. ⛔ Never passes a role. */
    deleteStack(stackName: string): Promise<void>;
}

/** ECS operations the reclaim needs, beyond the scheduler's. */
export interface ReclaimEcsApi {
    /** Every cluster with its `Environment` tag. */
    listClusters(): Promise<EcsClusterSummary[]>;
    /** The services in a cluster, with their status. */
    listServices(clusterArn: string): Promise<ReclaimServiceSummary[]>;
    /** The tasks in a cluster, for both desired statuses. */
    listTasks(clusterArn: string): Promise<ReclaimTaskSummary[]>;
    /** Delete a service, forcing it to drain. */
    deleteService(clusterArn: string, serviceArn: string): Promise<void>;
    /** Stop a task. */
    stopTask(clusterArn: string, taskArn: string): Promise<void>;
}

/** The injected clients the reclaim runs on. */
export interface ReclaimPorts {
    /** RDS: only to read the database's state. */
    readonly rds: { listInstances(): Promise<RdsInstanceSummary[]> };
    /** EC2: only to read the NAT's state. */
    readonly ec2: { listInstances(): Promise<Ec2InstanceSummary[]> };
    /** CloudFormation. */
    readonly cloudFormation: ReclaimCloudFormationApi;
    /** ECS. */
    readonly ecs: ReclaimEcsApi;
}

/** What one reclaim call returns to the state machine. */
export interface ReclaimStepResult {
    /** This iteration. */
    readonly iteration: number;
    /** The loop ends: the work is done, or the bound is reached. */
    readonly complete: boolean;
    /** The loop ended with work left. Only ever true together with `complete`. */
    readonly failed: boolean;
    /** The tier was not quiescent, so no delete was started. */
    readonly standDown: boolean;
    /** What was done this call, as `kind target` labels. */
    readonly actions: readonly string[];
    /** What is being waited on. */
    readonly pending: readonly string[];
    /** Findings that do not fail the run. */
    readonly warnings: readonly string[];
    /** Actions that threw. They are retried next iteration and count as work left. */
    readonly errors: readonly string[];
}

/**
 * A short label for an action, for the result and the log.
 *
 * @param action - The action.
 * @returns `kind target`. Pure.
 */
export function actionLabel(action: ReclaimAction): string {
    switch (action.kind) {
        case 'deleteService':
            return `deleteService ${action.serviceArn}`;
        case 'stopTask':
            return `stopTask ${action.taskArn}`;
        case 'deleteStack':
            return `deleteStack ${action.stackName}`;
    }
}

/**
 * Read the account into an {@link ReclaimObservation}.
 *
 * @param ports - The injected clients.
 * @returns The observation. Only per-PR clusters are expanded into services and tasks.
 * @sideEffect Reads RDS, EC2, CloudFormation and ECS.
 */
async function observeReclaim(ports: ReclaimPorts): Promise<ReclaimObservation> {
    const [rdsInstances, natInstances, stacks, allClusters] = await Promise.all([
        ports.rds.listInstances(),
        ports.ec2.listInstances(),
        ports.cloudFormation.listStacks(),
        ports.ecs.listClusters(),
    ]);
    const clusters: ObservedCluster[] = [];

    for (const entry of allClusters.filter((candidate) => previewTokenOf(candidate) !== undefined)) {
        clusters.push({
            arn: entry.arn,
            environmentTag: entry.environmentTag,
            services: await ports.ecs.listServices(entry.arn),
            tasks: await ports.ecs.listTasks(entry.arn),
        });
    }

    return { rdsInstances, natInstances, stacks, clusters };
}

/**
 * Run one action.
 *
 * @param ports - The injected clients.
 * @param action - The action.
 * @sideEffect Deletes a service or a stack, or stops a task.
 */
async function runAction(ports: ReclaimPorts, action: ReclaimAction): Promise<void> {
    switch (action.kind) {
        case 'deleteService':
            return ports.ecs.deleteService(action.clusterArn, action.serviceArn);
        case 'stopTask':
            return ports.ecs.stopTask(action.clusterArn, action.taskArn);
        case 'deleteStack':
            return ports.cloudFormation.deleteStack(action.stackName);
    }
}

/**
 * One iteration of the reclaim: observe, plan, act, return.
 *
 * An action that throws is recorded and retried next iteration; it never aborts the others, and it counts as work
 * left, so a persistent refusal ends the loop as `failed` rather than as a quiet success.
 *
 * @param ports - The injected clients.
 * @param iteration - This iteration, from 0.
 * @param maxIterations - The bound the state machine enforces.
 * @returns What the state machine needs to choose its next state.
 * @throws {ReclaimTierUnobservableError} When the tier cannot be observed.
 * @sideEffect Reads the account and deletes services, stops tasks and deletes stacks.
 */
export async function runReclaimStep(
    ports: ReclaimPorts,
    iteration: number,
    maxIterations: number,
): Promise<ReclaimStepResult> {
    const plan = planReclaim(await observeReclaim(ports), iteration, maxIterations);
    const errors: string[] = [];
    const done: string[] = [];

    for (const action of plan.actions) {
        try {
            await runAction(ports, action);
            done.push(actionLabel(action));
        } catch (error) {
            errors.push(`${actionLabel(action)}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    const finished = plan.done && errors.length === 0;

    return {
        iteration,
        complete: finished || plan.lastIteration,
        failed: !finished && plan.lastIteration,
        standDown: plan.standDown,
        actions: done,
        pending: plan.pending,
        warnings: plan.warnings,
        errors,
    };
}
