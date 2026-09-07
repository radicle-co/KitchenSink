/**
 * Pure orchestration + resource-selection logic for the sandbox nightly-shutdown scheduler (ADR-0007).
 *
 * This module holds ALL the decision logic — which resources are in-scope (sandbox only), what state
 * transition to apply, and how prior ECS desired counts are persisted and restored — behind small
 * injected client interfaces. It imports NO AWS SDK, so it is fully type-checked and unit-tested; the
 * thin Lambda adapter (`src/sandbox-scheduler/handler.ts`) constructs the real SDK v3 clients (provided
 * by the Node 22 Lambda runtime) and adapts them to these interfaces.
 *
 * SAFETY: prod is NEVER targeted. Every selector matches only the `sandbox` stage by name/tag, so a
 * misconfigured invocation cannot stop a prod resource.
 */

/** The nightly action to apply to the sandbox tier. */
export type SchedulerAction = 'stop' | 'start';

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
     * by ARN alone under the rule `ecs-quiesce.sh` sets, so a port that returned only ARNs made the
     * per-PR half unselectable no matter what the selector said.
     */
    listClusters(): Promise<EcsClusterSummary[]>;
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
    /** Non-fatal errors (a resource that could not transition is logged + skipped, never aborts). */
    readonly errors: string[];
}

/** The substring that marks a resource as belonging to the sandbox stage. */
const SANDBOX_MARKER = 'sandbox';

/**
 * Whether a DB instance identifier belongs to the sandbox stage.
 *
 * @param identifier - The DB instance identifier.
 * @returns `true` when it is a `-sandbox` instance.
 */
export function isSandboxRdsInstance(identifier: string): boolean {
    return identifier.includes(`-${SANDBOX_MARKER}`);
}

/**
 * Select the sandbox DB instances eligible for the given action, skipping any not in the expected
 * source state (e.g. an instance mid-`modifying` cannot be stopped and is simply left alone).
 *
 * @param instances - All DB instances.
 * @param action - The action to apply.
 * @returns The identifiers to act on.
 */
export function selectRdsTargets(instances: RdsInstanceSummary[], action: SchedulerAction): string[] {
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
 * A `pr-{N}` stage token exactly: `pr-` and digits, nothing else.
 *
 * Anchored, and digits-only, for the reason `pr-scope.sh` already enforces on the teardown path — a prefix
 * rule admits `prod` and `preview`, and the action on the other side of this predicate is SCALING A SERVICE
 * TO ZERO.
 */
const PER_PR_ENVIRONMENT = /^pr-\d+$/u;

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
 *   - the SHARED sandbox tier is matched by NAME (`isSandboxClusterArn`), because its `Environment` tag is
 *     `global` — the same value PRODUCTION carries, so the tag can never be the selector for it;
 *   - a PER-PR preview is matched by its `Environment` TAG, because `ecs-quiesce.sh` records that the
 *     per-PR cluster NAME "is deliberately NOT used for matching… loosening that rule is exactly what
 *     ADR-0005 forbids". The `Environment=pr-{N}` tag is the same authority that licenses
 *     `teardown-sandbox-pr.sh` to delete whole stacks.
 *
 * ⛔ Production is excluded by BOTH doors independently: its name carries no `sandbox`, and `pr-{N}` is a
 * token CloudFormation only ever stamps on an ephemeral preview (ADR-0005). A false positive here is a
 * production outage, so neither door is allowed to depend on the other being correct.
 *
 * @param cluster - The cluster and its `Environment` tag.
 * @returns `true` when the scheduler may scale it.
 */
export function isScheduledCluster(cluster: EcsClusterSummary): boolean {
    // ⛔ THE PROD INTERLOCK COMES FIRST and no tag can override it. Without it the rule is a plain OR, and
    // a production cluster carrying an `Environment=pr-{N}` tag — a mis-tag, a copied stack, a future
    // refactor — would be scaled to ZERO. ADR-0005 says that tag never lands on prod; this makes the
    // scheduler correct even when that is violated, because the cost of being wrong here is an outage and
    // the cost of the extra check is one string comparison.
    if (isProdClusterArn(cluster.arn)) {
        return false;
    }

    return isSandboxClusterArn(cluster.arn) || PER_PR_ENVIRONMENT.test(cluster.environmentTag ?? '');
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
export function selectSandboxNatInstances(instances: Ec2InstanceSummary[], action: SchedulerAction): string[] {
    const requiredState = action === 'stop' ? 'running' : 'stopped';

    return instances
        .filter(
            (instance) =>
                instance.sourceDestCheck === false &&
                (instance.nameTag ?? '').toLowerCase().includes(SANDBOX_MARKER) &&
                instance.state === requiredState,
        )
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
 * Collect every service across the sandbox clusters.
 *
 * @param ecs - The ECS client.
 * @returns The services in all sandbox clusters.
 * @sideEffect Calls ECS `ListClusters`/`ListServices`.
 */
async function listSandboxServices(ecs: EcsApi): Promise<EcsServiceSummary[]> {
    const clusters = (await ecs.listClusters()).filter(isScheduledCluster);
    const services: EcsServiceSummary[] = [];

    for (const cluster of clusters) {
        services.push(...(await ecs.listServices(cluster.arn)));
    }

    return services;
}

/**
 * Apply the STOP transition to the sandbox tier: stop RDS, persist-then-zero ECS desired counts, stop
 * the NAT instance. Each resource is handled independently; a failure is recorded and skipped so one
 * stuck resource never blocks the rest.
 *
 * @param clients - The injected AWS clients.
 * @returns The run summary.
 * @sideEffect Stops RDS/EC2 and scales ECS services to zero.
 */
async function runStop(clients: SchedulerClients): Promise<SchedulerSummary> {
    const { rds, ecs, ec2, ssm } = clients;
    const rdsTally: { acted: string[]; skipped: string[] } = { acted: [], skipped: [] };
    const ecsTally: { acted: string[]; skipped: string[] } = { acted: [], skipped: [] };
    const natTally: { acted: string[]; skipped: string[] } = { acted: [], skipped: [] };
    const errors: string[] = [];

    const rdsInstances = await rds.listInstances();
    const rdsTargets = selectRdsTargets(rdsInstances, 'stop');

    for (const identifier of rdsTargets) {
        try {
            await rds.stopInstance(identifier);
            rdsTally.acted.push(identifier);
        } catch (error) {
            errors.push(`rds stop ${identifier}: ${errorMessage(error)}`);
            rdsTally.skipped.push(identifier);
        }
    }

    const services = await listSandboxServices(ecs);

    for (const service of services) {
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

    return { action: 'stop', rds: rdsTally, ecs: ecsTally, nat: natTally, errors };
}

/**
 * Apply the START transition to the sandbox tier: start RDS, restore ECS desired counts from the
 * persisted SSM value (NEVER a hardcoded count — a service with no stored value is skipped), start the
 * NAT instance.
 *
 * @param clients - The injected AWS clients.
 * @returns The run summary.
 * @sideEffect Starts RDS/EC2 and scales ECS services back to their stored count.
 */
async function runStart(clients: SchedulerClients): Promise<SchedulerSummary> {
    const { rds, ecs, ec2, ssm } = clients;
    const rdsTally: { acted: string[]; skipped: string[] } = { acted: [], skipped: [] };
    const ecsTally: { acted: string[]; skipped: string[] } = { acted: [], skipped: [] };
    const natTally: { acted: string[]; skipped: string[] } = { acted: [], skipped: [] };
    const errors: string[] = [];

    const rdsTargets = selectRdsTargets(await rds.listInstances(), 'start');

    for (const identifier of rdsTargets) {
        try {
            await rds.startInstance(identifier);
            rdsTally.acted.push(identifier);
        } catch (error) {
            errors.push(`rds start ${identifier}: ${errorMessage(error)}`);
            rdsTally.skipped.push(identifier);
        }
    }

    const services = await listSandboxServices(ecs);

    for (const service of services) {
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

    return { action: 'start', rds: rdsTally, ecs: ecsTally, nat: natTally, errors };
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
 * Run the sandbox nightly stop/start action.
 *
 * @param action - The action to apply (`stop` at 00:00 ET, `start` at 09:00 ET).
 * @param clients - The injected AWS clients.
 * @returns The structured run summary.
 * @sideEffect Stops/starts sandbox RDS, ECS, and the NAT instance.
 */
export async function runSchedulerAction(
    action: SchedulerAction,
    clients: SchedulerClients,
): Promise<SchedulerSummary> {
    if (action === 'stop') {
        return runStop(clients);
    }

    return runStart(clients);
}
