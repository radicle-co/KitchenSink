/**
 * Pure orchestration + resource-selection logic for the sandbox scheduler (ADR-0007, ADR-0060).
 *
 * This module holds ALL the decision logic — which resources are in-scope (sandbox only), what state
 * transition to apply, how prior ECS desired counts are persisted and restored, and which scheduled rules
 * should run — behind small injected client interfaces. It imports NO AWS SDK, so it is fully type-checked
 * and unit-tested; the thin Lambda adapter (`src/sandbox-scheduler/handler.ts`) constructs the real SDK v3
 * clients and adapts them to these interfaces.
 *
 * Three actions (ADR-0060):
 *   - `stop`  — the ONLY scheduled one, at midnight: every scheduled rule off, then RDS, the NAT and every
 *               sandbox and per-PR ECS service, then the midnight reclaim loop (ADR-0061, `reclaim.ts`).
 *   - `start` — one PR, by hand (`sandboxUp.yml`): RDS, the NAT, the shared tier and that PR's services.
 *   - `sync`  — the ONLY writer of a scheduled rule's state, from {@link desiredRuleStates}.
 *
 * SAFETY: prod is NEVER targeted. Every selector matches only the `sandbox` stage by name/tag, so a
 * misconfigured invocation cannot stop a prod resource.
 *
 * @pattern Command — {@link SchedulerRequest} is the parsed command, {@link runSchedulerAction} its invoker
 * @pattern Specification — {@link desiredRuleStates} is the one rule for whether a scheduled job may run
 */

import { InvalidSchedulerRequestError } from './invalidSchedulerRequestError.js';

/** The action to apply to the sandbox tier. */
export type SchedulerAction = 'stop' | 'start' | 'sync';

/** A per-PR stage token: `pr-` and a PR number with no leading zero. Only {@link parseSchedulerRequest} makes one. */
export type PreviewStage = `pr-${number}` & { readonly __brand: 'PreviewStage' };

/**
 * A parsed scheduler command. `start` names exactly one PR; there is no start-everything.
 *
 * A `stop` from the midnight schedule carries the schedule's own `scheduledTime`, which names the night for the
 * reclaim's idempotency key. A hand-run stop may carry none.
 */
export type SchedulerRequest =
    | { readonly action: 'stop'; readonly scheduledTime?: string }
    | { readonly action: 'sync' }
    | { readonly action: 'start'; readonly stage: PreviewStage };

/**
 * The tag every NON-PROD scheduled rule carries, naming the stage it serves (`sandbox` or `pr-{N}`).
 *
 * ⛔ ONE AUTHORITY for three readers: the CDK apps stamp it (each app's `scheduledRuleGate.ts`, a mirrored module
 * held identical by `mirroredModuleParity.test.ts` and held to THIS value by `nonProdScheduledRules.test.ts`), the
 * scheduler's IAM conditions on it (`SandboxSchedulerStack`), and {@link desiredRuleStates} reads it. A rule without
 * it was never handed to the scheduler and is left alone — which is also what keeps every production rule out of
 * reach, since no production stack applies the gate.
 */
export const SCHEDULED_RULE_STAGE_TAG = 'SandboxStage';

/** A minimal RDS instance view (identifier + lifecycle status). */
export interface RdsInstanceSummary {
    /** The DB instance identifier (e.g. `kitchensink-data-sandbox`). */
    readonly identifier: string;
    /** The instance lifecycle status (e.g. `available`, `stopped`, `modifying`). */
    readonly status: string;
}

/** A minimal ECS service view (its cluster + service ARNs, name, and current desired count). */
export interface EcsServiceSummary {
    /** The owning cluster ARN. */
    readonly clusterArn: string;
    /** The service ARN. */
    readonly serviceArn: string;
    /** The service name. */
    readonly serviceName: string;
    /** The current desired task count. */
    readonly desiredCount: number;
}

/** A minimal EC2 instance view — enough to identify the sandbox NAT instance without touching prod. */
export interface Ec2InstanceSummary {
    /** The EC2 instance id. */
    readonly instanceId: string;
    /** The instance state name (e.g. `running`, `stopped`). */
    readonly state: string;
    /** The instance `Name` tag, if any. */
    readonly nameTag: string | undefined;
    /** The `aws:cloudformation:stack-name` tag: the stack that owns the instance, if any. */
    readonly stackNameTag: string | undefined;
    /** Whether the source/destination check is enabled — a NAT instance has it DISABLED (`false`). */
    readonly sourceDestCheck: boolean | undefined;
}

/** RDS operations the scheduler needs (all sandbox-scoped by the pure selectors below). */
export interface RdsApi {
    /** List all DB instances (the selector filters to sandbox). */
    listInstances(): Promise<RdsInstanceSummary[]>;
    /** Stop a DB instance by identifier. */
    stopInstance(identifier: string): Promise<void>;
    /** Start a DB instance by identifier. */
    startInstance(identifier: string): Promise<void>;
}

/** ECS operations the scheduler needs. */
export interface EcsApi {
    /**
     * List every cluster with its `Environment` tag (the selector filters to sandbox + per-PR).
     *
     * ⚠️ The tag is REQUIRED here, not a convenience: a per-PR cluster is indistinguishable from any other
     * by ARN alone under the rule `ecsQuiesce.sh` sets, so a port that returned only ARNs made the
     * per-PR half unselectable no matter what the selector said.
     *
     * ⛔ `inScope` is applied to each cluster ARN BEFORE `DescribeClusters` is called on it. `ListClusters` takes no
     * resource and is fine; `DescribeClusters` is a per-resource call, and the permissions boundary (ADR-0065) refuses
     * it, as an explicit deny that fails the whole run, on a production-named cluster and on every cluster of the other
     * application in the account. The adapter applies the predicate and decides nothing itself.
     */
    listClusters(inScope: (clusterArn: string) => boolean): Promise<EcsClusterSummary[]>;
    /** List the services in a cluster. */
    listServices(clusterArn: string): Promise<EcsServiceSummary[]>;
    /** Set a service's desired count. */
    updateDesiredCount(clusterArn: string, serviceArn: string, desiredCount: number): Promise<void>;
}

/** EC2 operations the scheduler needs. */
export interface Ec2Api {
    /** List all instances (the selector filters to the sandbox NAT). */
    listInstances(): Promise<Ec2InstanceSummary[]>;
    /** Stop the given instances. */
    stopInstances(instanceIds: string[]): Promise<void>;
    /** Start the given instances. */
    startInstances(instanceIds: string[]): Promise<void>;
}

/** SSM Parameter Store operations used to persist prior ECS desired counts across the stop/start pair. */
export interface SsmApi {
    /** Read a parameter's value, or `undefined` if it does not exist. */
    getParameter(name: string): Promise<string | undefined>;
    /** Write (overwrite) a parameter's value. */
    putParameter(name: string, value: string): Promise<void>;
}

/** A scheduled EventBridge rule as the scheduler sees it: its name and the two tags that decide its fate. */
export interface ScheduledRuleSummary {
    /** The rule name on the default event bus. */
    readonly name: string;
    /** The {@link SCHEDULED_RULE_STAGE_TAG} value, when the rule carries one. */
    readonly stageTag: string | undefined;
    /** The `Environment` tag value, when the rule carries one — read for the production interlock. */
    readonly environmentTag: string | undefined;
}

/** EventBridge operations the scheduler needs. */
export interface EventsApi {
    /**
     * List every SCHEDULED rule in the account's `kitchensink-*` namespace, with its tags.
     *
     * ⛔ `inScope` is applied to each rule NAME before `ListTagsForResource` is called on it (a per-resource call the
     * permissions boundary refuses on a production-named rule). `ListRules` itself takes no resource.
     */
    listScheduledRules(inScope: (ruleName: string) => boolean): Promise<ScheduledRuleSummary[]>;
    /** Enable a rule by name. */
    enableRule(name: string): Promise<void>;
    /** Disable a rule by name. */
    disableRule(name: string): Promise<void>;
}

/** The midnight reclaim's starter (ADR-0061): one call that starts the Step Functions loop. */
export interface ReclaimApi {
    /**
     * Start the reclaim loop under an idempotency name.
     *
     * Rejects with an error named `ExecutionAlreadyExists` when the night's loop already exists. {@link runStop}
     * treats that one as success, because a retried schedule is the same night.
     */
    startLoop(executionName: string): Promise<void>;
}

/** The full set of injected clients. */
export interface SchedulerClients {
    /** RDS client. */
    readonly rds: RdsApi;
    /** ECS client. */
    readonly ecs: EcsApi;
    /** EC2 client. */
    readonly ec2: Ec2Api;
    /** SSM client. */
    readonly ssm: SsmApi;
    /** EventBridge client. */
    readonly events: EventsApi;
    /** The reclaim loop's starter. */
    readonly reclaim: ReclaimApi;
}

/** Per-resource-class action tally returned for logging + tests. */
export interface ResourceTally {
    /** Resources acted on this run. */
    readonly acted: string[];
    /** Resources skipped (already in target state, no stored count, or not selectable). */
    readonly skipped: string[];
}

/** The structured result of a scheduler run. */
export interface SchedulerSummary {
    /** The action applied. */
    readonly action: SchedulerAction;
    /** RDS tally. */
    readonly rds: ResourceTally;
    /** ECS tally. */
    readonly ecs: ResourceTally;
    /** NAT (EC2) tally. */
    readonly nat: ResourceTally;
    /** Scheduled-rule tally (rules whose state was written). */
    readonly rules: ResourceTally;
    /** The reclaim loop (ADR-0061): the execution name started, or skipped. Empty outside `stop`. */
    readonly reclaim: ResourceTally;
    /** Gaps that are reported on every run but do not fail it (a serving stage whose rules are not yet tagged). */
    readonly warnings: string[];
    /** Non-fatal errors (a resource that could not transition is logged + skipped, never aborts). */
    readonly errors: string[];
}

/** The two power transitions a resource selector answers for. `sync` changes no resource's power state. */
export type PowerTransition = 'stop' | 'start';

/** The substring that marks a resource as belonging to the sandbox stage. */
const SANDBOX_MARKER = 'sandbox';

/**
 * The prefix every cluster and RDS instance this repository deploys carries: CloudFormation names an unnamed cluster
 * `<stack name>-<LogicalId>-<hash>`, and every stack is `kitchensink-…`.
 *
 * ⛔ A per-PR cluster is selected by tag AND by this prefix (ADR-0061 security review). The account also hosts another
 * application, a tag alone does not say whose cluster it is, and what the selector leads to is scaling a service to
 * zero here and, in the reclaim, an irreversible `DeleteService`. The IAM grants carry the same prefix.
 */
const REPOSITORY_PREFIX = 'kitchensink-';

/**
 * Whether a DB instance identifier belongs to the sandbox stage.
 *
 * @param identifier - The DB instance identifier.
 * @returns `true` when it is a `-sandbox` instance.
 */
export function isSandboxRdsInstance(identifier: string): boolean {
    // ⛔ The repository prefix too (ADR-0061 review). Another application in this account can own a `-sandbox` instance,
    // and the reclaim decides "the tier is down" from these instances: a running foreign one would hold it up for ever,
    // and silently. The real identifier is `kitchensink-data-sandbox-databaseb269d8bb-…`.
    return isStageScopedName(identifier) && identifier.includes(`-${SANDBOX_MARKER}`);
}

/**
 * Select the sandbox DB instances eligible for the given action, skipping any not in the expected
 * source state (e.g. an instance mid-`modifying` cannot be stopped and is simply left alone).
 *
 * @param instances - All DB instances.
 * @param action - The action to apply.
 * @returns The identifiers to act on.
 */
export function selectRdsTargets(instances: RdsInstanceSummary[], action: PowerTransition): string[] {
    const requiredStatus = action === 'stop' ? 'available' : 'stopped';

    return instances
        .filter((instance) => isSandboxRdsInstance(instance.identifier) && instance.status === requiredStatus)
        .map((instance) => instance.identifier);
}

/**
 * Whether an ECS cluster ARN belongs to the sandbox stage (its name segment contains `sandbox`).
 *
 * @param clusterArn - The cluster ARN (`arn:aws:ecs:…:cluster/<name>`).
 * @returns `true` for a sandbox cluster.
 */
export function isSandboxClusterArn(clusterArn: string): boolean {
    const name = clusterArn.split('/').pop() ?? '';

    return name.toLowerCase().includes(SANDBOX_MARKER);
}

/**
 * An `Environment` tag value a per-PR preview can carry: `pr-` and digits, optionally followed by the
 * `-sandbox` tier suffix the CDK apps now emit — and nothing else.
 *
 * Anchored, and digits-required, for the reason `prScope.sh` already enforces on the teardown path — a
 * prefix rule admits `prod` and `preview`, and the action on the other side of this predicate is SCALING A
 * SERVICE TO ZERO.
 *
 * ⛔ The suffix is OPTIONAL, not required, and both halves are load-bearing. Requiring it would stop
 * selecting every preview deployed before the scheme changed, which leaks the cost this door exists to
 * reclaim; making it a mere `-sandbox` suffix test would select the persistent tier itself, whose tag is
 * exactly that word. The token — which always carries digits — is what keeps the two apart.
 */
const PER_PR_ENVIRONMENT = /^pr-\d+(?:-sandbox)?$/u;

/** The substring that marks a resource as production. Checked independently of every other rule. */
const PROD_MARKER = 'prod';

/**
 * Whether a cluster ARN names a PRODUCTION cluster.
 *
 * @param clusterArn - The cluster ARN.
 * @returns `true` for a prod cluster, which the scheduler must never touch.
 */
export function isProdClusterArn(clusterArn: string): boolean {
    return (clusterArn.split('/').pop() ?? '').toLowerCase().includes(PROD_MARKER);
}

/**
 * Whether a cluster ARN names a cluster of THIS repository (its name starts with `kitchensink-`).
 *
 * @param clusterArn - The cluster ARN.
 * @returns `true` for a cluster this repository deployed. Pure.
 */
function isRepositoryClusterArn(clusterArn: string): boolean {
    return (clusterArn.split('/').pop() ?? '').startsWith(REPOSITORY_PREFIX);
}

/**
 * Whether a resource NAME is one a non-production role may touch at all: this repository's (`kitchensink-…`) and not
 * production's (`-prod`).
 *
 * This is the line the permissions boundary draws (ADR-0065: Allow only `kitchensink-*`, Deny `*-prod*`), drawn in code
 * so that a per-resource call is never MADE on a name the boundary would refuse. It is a precondition, not a selector:
 * every selector below still decides what to act on. The `-prod` test is case-sensitive on purpose, as the IAM pattern
 * is, so a CloudFormation logical id such as `…Producer…` is not mistaken for production.
 *
 * @param name - A resource name (cluster, rule, DB instance, instance `Name` tag).
 * @returns `true` when the scheduler may make a per-resource call on it. Pure.
 */
export function isStageScopedName(name: string): boolean {
    return name.startsWith(REPOSITORY_PREFIX) && !name.includes('-prod');
}

/**
 * Whether a cluster ARN may be DESCRIBED: its name is in stage scope and not production's.
 *
 * @param clusterArn - The cluster ARN.
 * @returns `true` when `DescribeClusters` may be called on it. Pure.
 */
export function isCandidateClusterArn(clusterArn: string): boolean {
    return isStageScopedName(clusterArn.split('/').pop() ?? '') && !isProdClusterArn(clusterArn);
}

/** A cluster as the selector sees it: its ARN, and its `Environment` tag when it carries one. */
export interface EcsClusterSummary {
    /** The cluster ARN. */
    readonly arn: string;
    /** The `Environment` tag's value, when the cluster carries one. */
    readonly environmentTag?: string | undefined;
}

/**
 * Whether the nightly window may scale this cluster's services.
 *
 * Two doors, and they are deliberately different in kind:
 *
 *   - the SHARED sandbox tier is matched by NAME (`isSandboxClusterArn`), because a tag that says only
 *     which TIER a cluster is in cannot distinguish the shared tier from a preview inside it;
 *   - a PER-PR preview is matched by its `Environment` TAG, because `ecsQuiesce.sh` records that the
 *     per-PR cluster NAME "is deliberately NOT used for matching… loosening that rule is exactly what
 *     ADR-0005 forbids". That tag is the same authority that licenses `teardownSandboxPr.sh` to delete
 *     whole stacks.
 *
 * ⚠️ The name door's justification is NOT "the tag can never select the shared tier" — the tiers are
 * `sandbox` and `production`, so a bare tier word could. The door stays on the name because
 * broadening the tag door to the bare tier word would put every preview AND the shared tier
 * through one predicate, and the prod interlock would become the only thing between this and an outage.
 *
 * ⛔ Production is excluded by BOTH doors independently: its name carries no `sandbox`, and a `pr-{N}` token
 * is something CloudFormation only ever stamps on an ephemeral preview (ADR-0005). A false positive here is
 * a production outage, so neither door is allowed to depend on the other being correct.
 *
 * @param cluster - The cluster and its `Environment` tag.
 * @returns `true` when the scheduler may scale it.
 */
export function isScheduledCluster(cluster: EcsClusterSummary): boolean {
    // ⛔ THE PROD INTERLOCK COMES FIRST and no tag can override it. Without it the rule is a plain OR, and
    // a production cluster carrying a per-PR `Environment` tag — a mis-tag, a copied stack, a future
    // refactor — would be scaled to ZERO. ADR-0005 says that tag never lands on prod; this makes the
    // scheduler correct even when that is violated, because the cost of being wrong here is an outage and
    // the cost of the extra check is one string comparison.
    if (isProdClusterArn(cluster.arn)) {
        return false;
    }

    return (
        isRepositoryClusterArn(cluster.arn) &&
        (isSandboxClusterArn(cluster.arn) || PER_PR_ENVIRONMENT.test(cluster.environmentTag ?? ''))
    );
}

/**
 * Whether an instance is THIS repository's sandbox NAT: a DISABLED source/destination check, owned by a stage-scoped
 * `sandbox` stack, with the `sandbox` marker in its `Name` tag.
 *
 * ⛔ The OWNING STACK is what says the instance is ours: the `Name` tag is the CDK construct path
 * (`Global-sandbox/Network-sandbox/Vpc/publicSubnet1/NatInstance`), which carries no repository prefix, so a name rule
 * cannot tell it from the other application's. The `Name` marker stays because `ec2:StopInstances` is granted on it.
 *
 * @param instance - The instance.
 * @returns `true` for the sandbox NAT. Pure.
 */
export function isSandboxNatInstance(instance: Ec2InstanceSummary): boolean {
    const stack = instance.stackNameTag ?? '';

    return (
        instance.sourceDestCheck === false &&
        isStageScopedName(stack) &&
        stack.includes(`-${SANDBOX_MARKER}`) &&
        (instance.nameTag ?? '').toLowerCase().includes(SANDBOX_MARKER)
    );
}

/**
 * Select the sandbox NAT instances eligible for the given action. A NAT instance is identified by a
 * DISABLED source/destination check AND a `sandbox` marker in its `Name` tag — the tag scope keeps the
 * prod NAT (named `…prod…`) out of range even though both share the NAT characteristic.
 *
 * @param instances - All EC2 instances.
 * @param action - The action to apply.
 * @returns The instance ids to act on (running → stop, stopped → start).
 */
export function selectSandboxNatInstances(instances: Ec2InstanceSummary[], action: PowerTransition): string[] {
    const requiredState = action === 'stop' ? 'running' : 'stopped';

    return instances
        .filter((instance) => isSandboxNatInstance(instance) && instance.state === requiredState)
        .map((instance) => instance.instanceId);
}

/**
 * The SSM parameter name that persists a service's prior desired count between the nightly stop and
 * the morning start.
 *
 * @param serviceArn - The service ARN (`arn:aws:ecs:…:service/<cluster>/<service>`).
 * @returns A stable parameter name keyed on the cluster + service.
 */
export function priorCountParamName(serviceArn: string): string {
    const segments = serviceArn.split('/');
    const cluster = segments[1] ?? 'unknown';
    const service = segments[2] ?? 'unknown';

    return `/kitchensink/sandbox-scheduler/ecs/${cluster}/${service}`;
}

/**
 * The `pr-{N}` token a per-PR cluster's `Environment` tag names, or `undefined` for any other cluster.
 *
 * Exported because the midnight reclaim (ADR-0061) groups a preview's ECS clusters by the same token, and a second
 * copy of "which cluster belongs to which preview" is the drift ADR-0005 forbids.
 *
 * @param cluster - The cluster and its tag.
 * @returns The token with the `-sandbox` tier suffix removed (`pr-91-sandbox` → `pr-91`). Pure.
 */
export function previewTokenOf(cluster: EcsClusterSummary): string | undefined {
    const tag = cluster.environmentTag ?? '';

    if (isProdClusterArn(cluster.arn) || !isRepositoryClusterArn(cluster.arn) || !PER_PR_ENVIRONMENT.test(tag)) {
        return undefined;
    }

    return tag.replace(/-sandbox$/u, '');
}

/**
 * Whether a cluster is the SHARED sandbox tier (the identity service every preview signs in against).
 *
 * @param cluster - The cluster and its tag.
 * @returns `true` for a shared-tier cluster, never for prod or a preview. Pure.
 */
function isSharedTierCluster(cluster: EcsClusterSummary): boolean {
    return isScheduledCluster(cluster) && previewTokenOf(cluster) === undefined;
}

/**
 * Collect every service across the clusters `select` admits.
 *
 * @param ecs - The ECS client.
 * @param select - Which scheduled clusters to read; the prod interlock in {@link isScheduledCluster} runs first.
 * @returns The services, each still carrying its cluster ARN.
 * @sideEffect Calls ECS `ListClusters`/`ListServices`.
 */
async function listServicesIn(
    ecs: EcsApi,
    select: (cluster: EcsClusterSummary) => boolean,
): Promise<{ readonly cluster: EcsClusterSummary; readonly service: EcsServiceSummary }[]> {
    const clusters = (await ecs.listClusters(isCandidateClusterArn)).filter(
        (cluster) => isScheduledCluster(cluster) && select(cluster),
    );
    const services: { cluster: EcsClusterSummary; service: EcsServiceSummary }[] = [];

    for (const cluster of clusters) {
        for (const service of await ecs.listServices(cluster.arn)) {
            services.push({ cluster, service });
        }
    }

    return services;
}

/** A mutable tally, frozen into a {@link ResourceTally} when the run returns. */
interface Tally {
    acted: string[];
    skipped: string[];
}

/** A fresh, empty tally. Pure. */
function emptyTally(): Tally {
    return { acted: [], skipped: [] };
}

/** What the scheduler observed about the shared tier: the inputs {@link desiredRuleStates} decides from. */
export interface TierState {
    /** Every sandbox RDS instance exists and is `available`. */
    readonly rdsAvailable: boolean;
    /** Every sandbox NAT instance exists and is `running`. */
    readonly natRunning: boolean;
    /** The `pr-{N}` stages with at least one ECS service whose desired count is above zero. */
    readonly upStages: ReadonlySet<string>;
}

/** The tier `stop` is about to produce. Its rules are decided against THIS, never against the still-live tier. */
const TIER_GOING_DOWN: TierState = { rdsAvailable: false, natRunning: false, upStages: new Set() };

/** The decision for one rule: a state to write, or a refusal to touch it at all. */
export type RuleDecision =
    | { readonly kind: 'write'; readonly rule: ScheduledRuleSummary; readonly desired: 'ENABLED' | 'DISABLED' }
    | { readonly kind: 'refused'; readonly rule: ScheduledRuleSummary; readonly reason: string };

/** A preview stage tag: `pr-` and a PR number with no leading zero. Anything else names no population. */
const PREVIEW_STAGE = /^pr-[1-9]\d*$/u;

/** A rule NAME that says production: `-prod` as a whole hyphen-delimited segment. */
const PROD_NAMED = /(?:^|-)prod(?:-|$)/u;

/**
 * Decide, for every rule the scheduler owns, whether it may run (ADR-0060 truth table).
 *
 * | stage tag  | ENABLED iff                                                              |
 * | ---------- | ------------------------------------------------------------------------ |
 * | `pr-{N}`   | RDS available AND the NAT running AND `pr-{N}` has a service scaled up   |
 * | `sandbox`  | RDS available AND the NAT running AND at least one PR has one            |
 *
 * ⛔ THE PRODUCTION INTERLOCK COMES FIRST and no tag overrides it: a rule whose `Environment` tag is `production`,
 * or whose name carries a `-prod` segment, is REFUSED — never written, in either direction. A stage tag that names
 * no population (`dev`, `prod`, a malformed token) is refused too: the scheduler writes only what it can account
 * for. A rule with no stage tag is not the scheduler's and is omitted.
 *
 * ⚠️ The `-prod` name check is a second layer, not the boundary. CloudFormation truncates generated rule names
 * (`kitchensink-recipe-worker-QueueCheckSchedule…` has lost its stage), so the TAGS decide; the name catches only
 * the explicitly named production sweepers.
 *
 * @param rules - The scheduled rules the account holds.
 * @param tier - The observed (or, for `stop`, the projected) tier.
 * @returns One decision per stage-tagged rule, in input order. Pure.
 */
export function desiredRuleStates(rules: readonly ScheduledRuleSummary[], tier: TierState): RuleDecision[] {
    const tierUp = tier.rdsAvailable && tier.natRunning;

    return rules.flatMap((rule): RuleDecision[] => {
        if (rule.stageTag === undefined) {
            return [];
        }

        if (rule.environmentTag === 'production' || PROD_NAMED.test(rule.name)) {
            return [{ kind: 'refused', rule, reason: 'names production' }];
        }

        if (rule.stageTag === SANDBOX_MARKER) {
            return [{ kind: 'write', rule, desired: tierUp && tier.upStages.size > 0 ? 'ENABLED' : 'DISABLED' }];
        }

        if (PREVIEW_STAGE.test(rule.stageTag)) {
            return [
                { kind: 'write', rule, desired: tierUp && tier.upStages.has(rule.stageTag) ? 'ENABLED' : 'DISABLED' },
            ];
        }

        return [{ kind: 'refused', rule, reason: `stage tag ${JSON.stringify(rule.stageTag)} names no population` }];
    });
}

/**
 * Observe the tier: is the database up, is the NAT up, and which previews are serving.
 *
 * @param clients - The injected AWS clients.
 * @returns The observed {@link TierState}.
 * @sideEffect Reads RDS, EC2 and ECS.
 */
async function observeTier(clients: SchedulerClients): Promise<TierState> {
    const sandboxDatabases = (await clients.rds.listInstances()).filter((instance) =>
        isSandboxRdsInstance(instance.identifier),
    );
    const sandboxNats = (await clients.ec2.listInstances()).filter(isSandboxNatInstance);
    const upStages = new Set<string>();

    for (const { cluster, service } of await listServicesIn(
        clients.ecs,
        (candidate) => previewTokenOf(candidate) !== undefined,
    )) {
        const token = previewTokenOf(cluster);

        if (token !== undefined && service.desiredCount > 0) {
            upStages.add(token);
        }
    }

    return {
        rdsAvailable:
            sandboxDatabases.length > 0 && sandboxDatabases.every((instance) => instance.status === 'available'),
        natRunning: sandboxNats.length > 0 && sandboxNats.every((instance) => instance.state === 'running'),
        upStages,
    };
}

/** Where {@link writeRuleStates} reports: failures fail the run, warnings are only reported. */
interface RuleReport {
    readonly tally: Tally;
    readonly errors: string[];
    readonly warnings: string[];
}

/**
 * Write every owned rule's decided state. A refused rule and a failed write are errors; neither aborts the rest.
 *
 * Discovery that finds NOTHING owned while anything is serving is an ERROR: every preview deploys `recipe-workers` and
 * the shared tier deploys the webhooks, so an empty answer means the discovery itself is blind, and a green sync over
 * it would leave every job off while the sandbox is up. One serving stage without owned rules, while others have
 * them, is a WARNING: it is a preview deployed before ADR-0060, whose next deploy — the one Sandbox Up performs — tags
 * them, and failing that very run would block the repair.
 *
 * @param clients - The injected AWS clients.
 * @param tier - The tier to decide against.
 * @param report - Receives each rule written or skipped, each failure and each gap.
 * @sideEffect Enables/disables EventBridge rules.
 */
async function writeRuleStates(clients: SchedulerClients, tier: TierState, report: RuleReport): Promise<void> {
    const { tally, errors, warnings } = report;
    const rules = await clients.events.listScheduledRules(isStageScopedName);
    const owned = new Set(rules.flatMap((rule) => (rule.stageTag === undefined ? [] : [rule.stageTag])));
    const servingStages = tier.upStages.size > 0 ? [...tier.upStages, SANDBOX_MARKER] : [];

    if (servingStages.length > 0 && owned.size === 0) {
        errors.push(
            `sync: ${servingStages.join(', ')} serving, but discovery found no scheduled rule tagged ` +
                `${SCHEDULED_RULE_STAGE_TAG} at all — nothing would run`,
        );
    } else {
        for (const stage of servingStages.filter((serving) => !owned.has(serving))) {
            warnings.push(
                `sync: ${stage} is serving and owns no scheduled rule tagged ${SCHEDULED_RULE_STAGE_TAG}=${stage} ` +
                    '(deployed before ADR-0060? its next deploy tags them)',
            );
        }
    }

    for (const decision of desiredRuleStates(rules, tier)) {
        const { name } = decision.rule;

        if (decision.kind === 'refused') {
            errors.push(`rule ${name}: refused (${decision.reason})`);
            tally.skipped.push(name);
            continue;
        }

        try {
            await (decision.desired === 'ENABLED' ? clients.events.enableRule(name) : clients.events.disableRule(name));
            tally.acted.push(name);
        } catch (error) {
            errors.push(
                `rule ${decision.desired === 'ENABLED' ? 'enable' : 'disable'} ${name}: ${errorMessage(error)}`,
            );
            tally.skipped.push(name);
        }
    }
}

/**
 * Bring every owned rule into line with the observed tier. The ONLY writer of a scheduled rule's state.
 *
 * @param clients - The injected AWS clients.
 * @returns The run summary.
 * @sideEffect Reads RDS/EC2/ECS and enables/disables EventBridge rules.
 */
async function runSync(clients: SchedulerClients): Promise<SchedulerSummary> {
    const report: RuleReport = { tally: emptyTally(), errors: [], warnings: [] };

    await writeRuleStates(clients, await observeTier(clients), report);

    return {
        action: 'sync',
        rds: emptyTally(),
        ecs: emptyTally(),
        nat: emptyTally(),
        rules: report.tally,
        reclaim: emptyTally(),
        warnings: report.warnings,
        errors: report.errors,
    };
}

/** The shape EventBridge Scheduler gives `<aws.scheduler.scheduled-time>`: an ISO-8601 UTC instant, no fraction. */
const SCHEDULED_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

/**
 * The Step Functions execution name for one night's reclaim — the idempotency key (ADR-0061).
 *
 * The schedule retries a failed invocation with the SAME input, so the same `scheduledTime` yields the same name and
 * a retried stop cannot start a second loop. The value is parsed strictly because it becomes a name: Step Functions
 * names admit no `:`, whitespace or path characters.
 *
 * @param scheduledTime - The schedule's `<aws.scheduler.scheduled-time>`.
 * @returns `nightly-<time with ':' replaced by '-'>`, or `undefined` for anything that is not that shape. Pure.
 */
export function reclaimExecutionName(scheduledTime: string): string | undefined {
    return SCHEDULED_TIME.test(scheduledTime) ? `nightly-${scheduledTime.replaceAll(':', '-')}` : undefined;
}

/** Whether an error is Step Functions' "this execution name already exists", which is success for a stop. */
function isExecutionAlreadyExists(error: unknown): boolean {
    return error instanceof Error && error.name === 'ExecutionAlreadyExists';
}

/**
 * Start the midnight reclaim, last, once everything else has stopped.
 *
 * ⛔ A failure here is RECORDED, never thrown: the stop has already done its work, and cost safety comes before the
 * reclaim. The error fails the run afterwards (`assertRunSucceeded`), which is what makes the handler announce it.
 *
 * @param reclaim - The reclaim starter.
 * @param scheduledTime - The schedule's time, when the invocation carried one.
 * @param tally - Receives the execution name.
 * @param errors - Receives a failure.
 * @param warnings - Receives the note for a stop that carried no time.
 * @sideEffect Starts a Step Functions execution.
 */
async function startReclaim(
    reclaim: ReclaimApi,
    scheduledTime: string | undefined,
    tally: Tally,
    errors: string[],
    warnings: string[],
): Promise<void> {
    if (scheduledTime === undefined) {
        warnings.push('reclaim: this stop carried no scheduledTime, so no reclaim was started (a hand-run stop)');

        return;
    }

    const executionName = reclaimExecutionName(scheduledTime);

    if (executionName === undefined) {
        errors.push(
            `reclaim: scheduledTime ${JSON.stringify(scheduledTime)} is not an ISO UTC instant, so no reclaim was started`,
        );

        return;
    }

    try {
        await reclaim.startLoop(executionName);
        tally.acted.push(executionName);
    } catch (error) {
        if (isExecutionAlreadyExists(error)) {
            tally.skipped.push(executionName);

            return;
        }

        errors.push(`reclaim start ${executionName}: ${errorMessage(error)}`);
        tally.skipped.push(executionName);
    }
}

/**
 * Apply the STOP transition: every owned rule OFF first, then stop RDS, persist-then-zero ECS desired counts, stop
 * the NAT instance, then start the midnight reclaim. Each resource is handled independently; a failure is recorded
 * and skipped so one stuck resource never blocks the rest.
 *
 * ⛔ The rules are decided against {@link TIER_GOING_DOWN}, not the live tier: at midnight everything is still up,
 * so a live decision would answer ENABLED for exactly the jobs about to lose their database.
 *
 * @param clients - The injected AWS clients.
 * @returns The run summary.
 * @sideEffect Disables EventBridge rules, stops RDS/EC2 and scales ECS services to zero.
 */
async function runStop(clients: SchedulerClients, scheduledTime: string | undefined): Promise<SchedulerSummary> {
    const { rds, ecs, ec2, ssm } = clients;
    const rulesTally = emptyTally();
    const rdsTally = emptyTally();
    const ecsTally = emptyTally();
    const natTally = emptyTally();
    const reclaimTally = emptyTally();
    const warnings: string[] = [];
    const errors: string[] = [];

    // A going-down tier serves nothing, so this can only disable, refuse or fail — never warn.
    await writeRuleStates(clients, TIER_GOING_DOWN, { tally: rulesTally, errors, warnings: [] });

    for (const identifier of selectRdsTargets(await rds.listInstances(), 'stop')) {
        try {
            await rds.stopInstance(identifier);
            rdsTally.acted.push(identifier);
        } catch (error) {
            errors.push(`rds stop ${identifier}: ${errorMessage(error)}`);
            rdsTally.skipped.push(identifier);
        }
    }

    for (const { service } of await listServicesIn(ecs, () => true)) {
        if (service.desiredCount <= 0) {
            ecsTally.skipped.push(service.serviceArn);
            continue;
        }

        try {
            await ssm.putParameter(priorCountParamName(service.serviceArn), String(service.desiredCount));
            await ecs.updateDesiredCount(service.clusterArn, service.serviceArn, 0);
            ecsTally.acted.push(service.serviceArn);
        } catch (error) {
            errors.push(`ecs stop ${service.serviceArn}: ${errorMessage(error)}`);
            ecsTally.skipped.push(service.serviceArn);
        }
    }

    const natTargets = selectSandboxNatInstances(await ec2.listInstances(), 'stop');

    if (natTargets.length > 0) {
        try {
            await ec2.stopInstances(natTargets);
            natTally.acted.push(...natTargets);
        } catch (error) {
            errors.push(`ec2 stop ${natTargets.join(',')}: ${errorMessage(error)}`);
            natTally.skipped.push(...natTargets);
        }
    }

    // ⛔ LAST. The reclaim deletes only a tier that is already stopping or stopped, and nothing it does may undo the
    // stop above (ADR-0061).
    await startReclaim(clients.reclaim, scheduledTime, reclaimTally, errors, warnings);

    return {
        action: 'stop',
        rds: rdsTally,
        ecs: ecsTally,
        nat: natTally,
        rules: rulesTally,
        reclaim: reclaimTally,
        warnings,
        errors,
    };
}

/**
 * Apply the START transition for ONE PR: start RDS and the NAT, then restore the shared tier's and that PR's ECS
 * desired counts from the persisted SSM value (NEVER a hardcoded count — a service with no stored value is
 * skipped). Every other preview stays down (ADR-0060): a start that restored every cluster was what brought the
 * whole fleet back for one button press.
 *
 * It writes no rule. The rules are switched on by `sync` at the END of Sandbox Up, once the deploys have landed.
 *
 * @param clients - The injected AWS clients.
 * @param stage - The PR whose services start.
 * @returns The run summary.
 * @sideEffect Starts RDS/EC2 and scales ECS services back to their stored count.
 */
async function runStart(clients: SchedulerClients, stage: PreviewStage): Promise<SchedulerSummary> {
    const { rds, ecs, ec2, ssm } = clients;
    const rdsTally = emptyTally();
    const ecsTally = emptyTally();
    const natTally = emptyTally();
    const errors: string[] = [];

    for (const identifier of selectRdsTargets(await rds.listInstances(), 'start')) {
        try {
            await rds.startInstance(identifier);
            rdsTally.acted.push(identifier);
        } catch (error) {
            errors.push(`rds start ${identifier}: ${errorMessage(error)}`);
            rdsTally.skipped.push(identifier);
        }
    }

    const inScope = (cluster: EcsClusterSummary): boolean =>
        isSharedTierCluster(cluster) || previewTokenOf(cluster) === stage;

    for (const { service } of await listServicesIn(ecs, inScope)) {
        if (service.desiredCount > 0) {
            ecsTally.skipped.push(service.serviceArn);
            continue;
        }

        try {
            const stored = await ssm.getParameter(priorCountParamName(service.serviceArn));
            const priorCount = stored === undefined ? Number.NaN : Number(stored);

            if (!Number.isInteger(priorCount) || priorCount <= 0) {
                // No trustworthy prior count — do NOT guess a desired count. Skip and log.
                errors.push(`ecs start ${service.serviceArn}: no stored prior desired count, skipped`);
                ecsTally.skipped.push(service.serviceArn);
                continue;
            }

            await ecs.updateDesiredCount(service.clusterArn, service.serviceArn, priorCount);
            ecsTally.acted.push(service.serviceArn);
        } catch (error) {
            errors.push(`ecs start ${service.serviceArn}: ${errorMessage(error)}`);
            ecsTally.skipped.push(service.serviceArn);
        }
    }

    const natTargets = selectSandboxNatInstances(await ec2.listInstances(), 'start');

    if (natTargets.length > 0) {
        try {
            await ec2.startInstances(natTargets);
            natTally.acted.push(...natTargets);
        } catch (error) {
            errors.push(`ec2 start ${natTargets.join(',')}: ${errorMessage(error)}`);
            natTally.skipped.push(...natTargets);
        }
    }

    return {
        action: 'start',
        rds: rdsTally,
        ecs: ecsTally,
        nat: natTally,
        rules: emptyTally(),
        reclaim: emptyTally(),
        warnings: [],
        errors,
    };
}

/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * @param error - The caught value.
 * @returns The error message.
 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Parse a Lambda event into a {@link SchedulerRequest}.
 *
 * ⛔ Nothing is defaulted. An unknown action is never read as `stop` (that would tear the sandbox down on a typo),
 * and a `start` without a well-formed PR token is refused rather than read as "start everything" — the behaviour
 * ADR-0060 removed.
 *
 * @param event - The raw invocation payload.
 * @returns The parsed request. Pure.
 * @throws {InvalidSchedulerRequestError} When the event is not exactly one of the three commands.
 */
export function parseSchedulerRequest(event: unknown): SchedulerRequest {
    if (typeof event !== 'object' || event === null) {
        throw new InvalidSchedulerRequestError(event);
    }

    const { action, stage, scheduledTime } = event as { action?: unknown; stage?: unknown; scheduledTime?: unknown };

    if (action === 'stop') {
        // ⛔ A scheduledTime that is not a string is DROPPED, not refused: refusing would stop the stop, and cost
        // safety comes first. A stop with no time starts no reclaim and says so (`startReclaim`).
        return typeof scheduledTime === 'string' ? { action, scheduledTime } : { action };
    }

    if (action === 'sync') {
        return { action };
    }

    if (action === 'start' && typeof stage === 'string' && PREVIEW_STAGE.test(stage)) {
        return { action, stage: stage as PreviewStage };
    }

    throw new InvalidSchedulerRequestError(event);
}

/**
 * Run one scheduler command.
 *
 * @param request - The parsed command.
 * @param clients - The injected AWS clients.
 * @returns The structured run summary.
 * @sideEffect Stops/starts sandbox RDS, ECS and the NAT instance, and enables/disables scheduled rules.
 */
export async function runSchedulerAction(
    request: SchedulerRequest,
    clients: SchedulerClients,
): Promise<SchedulerSummary> {
    switch (request.action) {
        case 'stop':
            return runStop(clients, request.scheduledTime);
        case 'sync':
            return runSync(clients);
        case 'start':
            return runStart(clients, request.stage);
    }
}

/** A scheduler run in which at least one resource failed its transition. */
export class SchedulerRunFailedError extends Error {
    public constructor(public readonly summary: SchedulerSummary) {
        super(`sandbox-scheduler ${summary.action} failed: ${summary.errors.join('; ')}`);
        this.name = 'SchedulerRunFailedError';
        Object.setPrototypeOf(this, SchedulerRunFailedError.prototype);
    }
}

/** Whether `error` is a {@link SchedulerRunFailedError}. Pure. */
export function isSchedulerRunFailedError(error: unknown): error is SchedulerRunFailedError {
    return error instanceof SchedulerRunFailedError;
}

/**
 * Fail a run in which any resource could not transition. Each step still runs, and its failure is recorded rather than
 * aborting the others; this makes the invocation itself report the failure, so Lambda's `Errors` metric, and the
 * alarm on it, see a refused start (Oct 6–7 2026: `InsufficientDBInstanceCapacity`, reported as success). Pure.
 *
 * @param summary - The run's summary.
 * @throws {SchedulerRunFailedError} When the run recorded any error.
 */
export function assertRunSucceeded(summary: SchedulerSummary): void {
    if (summary.errors.length > 0) {
        throw new SchedulerRunFailedError(summary);
    }
}
