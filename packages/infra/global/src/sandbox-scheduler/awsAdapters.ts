/**
 * The AWS SDK v3 adapters for the sandbox scheduler (ADR-0007, ADR-0060). The reclaim's own adapters are in
 * `./reclaimAdapters` (ADR-0061), so that THIS module, which the nightly stop loads, imports only clients the stop uses.
 *
 * Every function here takes a CLIENT INSTANCE and returns an implementation of a port declared in
 * `lib/sandbox-scheduler/` (`scheduler.ts`). That seam is the point: the handlers build the real
 * clients once at import, and a test hands the same factories one stateful fake `send` that dispatches on the
 * command class, so the real adapter code — paging, batching, the exact request each call sends — runs against a
 * fake account instead of being mocked away.
 *
 * ⛔ THE ADAPTERS DECIDE NOTHING. Which resource is in scope, and whether to act on it, is `scheduler.ts`; this file only
 * turns a port call into the right SDK calls.
 *
 * It sits under `src/` (outside the infra `tsconfig` `bin`/`lib` include) because it imports the runtime-provided SDK,
 * which the bundle leaves `external`.
 *
 * @pattern Adapter — SDK clients adapted to the ports the pure modules declare
 * @sideEffect Every method calls AWS.
 */
import {
    CloudFormationClient,
    ListStackResourcesCommand,
    ListStacksCommand,
    type StackStatus,
} from '@aws-sdk/client-cloudformation';
import { DescribeInstancesCommand, EC2Client, StartInstancesCommand, StopInstancesCommand } from '@aws-sdk/client-ec2';
import {
    DescribeClustersCommand,
    DescribeServicesCommand,
    ECSClient,
    ListClustersCommand,
    ListServicesCommand,
    UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import {
    DisableRuleCommand,
    EnableRuleCommand,
    EventBridgeClient,
    ListRulesCommand,
    ListTagsForResourceCommand,
} from '@aws-sdk/client-eventbridge';
import {
    DescribeDBInstancesCommand,
    RDSClient,
    StartDBInstanceCommand,
    StopDBInstanceCommand,
} from '@aws-sdk/client-rds';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

import {
    SCHEDULED_RULE_STAGE_TAG,
    type Ec2Api,
    type Ec2InstanceSummary,
    type EcsApi,
    type EcsClusterSummary,
    type EcsServiceSummary,
    type EventsApi,
    type RdsApi,
    type RdsInstanceSummary,
    type ScheduledRuleSummary,
    type SsmApi,
} from '../../lib/sandbox-scheduler/scheduler.js';

/**
 * The name prefix every rule this repository deploys carries. CloudFormation truncates a generated rule name but
 * keeps its start (`kitchensink-…`), so this narrows the `ListRules` listing in an account that also hosts another
 * application. It is a narrowing, NOT a scope: which rules are ours is decided by their owning stack.
 */
const RULE_NAME_PREFIX = 'kitchensink-';

/** `DescribeClusters` accepts at most 100 clusters per call. */
const DESCRIBE_CLUSTERS_BATCH = 100;

/** `DescribeServices` accepts at most 10 services per call. */
const DESCRIBE_SERVICES_BATCH = 10;

/**
 * Every cluster `inScope` admits, with its `Environment` tag.
 *
 * ⛔ `ListClusters` takes no resource, so it lists the account; `DescribeClusters` is per resource and is refused by the
 * permissions boundary on a production-named cluster and on the other application's, so only the ARNs `inScope`
 * admits are ever passed to it.
 *
 * ⚠️ TAGS are opt-in: without `include: ['TAGS']` the response carries none and every per-PR cluster reads as
 * untagged, which is exactly the invisible state the per-PR selector exists to remove.
 *
 * @param client - The ECS client.
 * @param inScope - Which cluster ARNs may be described; the scheduler's predicate, never decided here.
 * @returns The clusters. Pages through all of them.
 * @sideEffect Calls ECS `ListClusters` and `DescribeClusters`.
 */
export async function listClusterSummaries(
    client: ECSClient,
    inScope: (clusterArn: string) => boolean,
): Promise<EcsClusterSummary[]> {
    const arns: string[] = [];
    let nextToken: string | undefined;

    do {
        const response = await client.send(new ListClustersCommand({ nextToken }));
        arns.push(...(response.clusterArns ?? []).filter(inScope));
        nextToken = response.nextToken;
    } while (nextToken);

    const clusters: EcsClusterSummary[] = [];

    for (let index = 0; index < arns.length; index += DESCRIBE_CLUSTERS_BATCH) {
        const response = await client.send(
            new DescribeClustersCommand({
                clusters: arns.slice(index, index + DESCRIBE_CLUSTERS_BATCH),
                include: ['TAGS'],
            }),
        );

        for (const cluster of response.clusters ?? []) {
            if (cluster.clusterArn) {
                clusters.push({
                    arn: cluster.clusterArn,
                    environmentTag: (cluster.tags ?? []).find((tag) => tag.key === 'Environment')?.value,
                });
            }
        }
    }

    return clusters;
}

/**
 * Every service in a cluster, described.
 *
 * @param client - The ECS client.
 * @param clusterArn - The cluster.
 * @returns The service descriptions, in listing order.
 * @sideEffect Calls ECS `ListServices` and `DescribeServices`.
 */
export async function describeAllServices(client: ECSClient, clusterArn: string) {
    const serviceArns: string[] = [];
    let nextToken: string | undefined;

    do {
        const response = await client.send(new ListServicesCommand({ cluster: clusterArn, nextToken }));
        serviceArns.push(...(response.serviceArns ?? []));
        nextToken = response.nextToken;
    } while (nextToken);

    const described = [];

    for (let index = 0; index < serviceArns.length; index += DESCRIBE_SERVICES_BATCH) {
        const response = await client.send(
            new DescribeServicesCommand({
                cluster: clusterArn,
                services: serviceArns.slice(index, index + DESCRIBE_SERVICES_BATCH),
            }),
        );

        described.push(...(response.services ?? []));
    }

    return described;
}

/**
 * The scheduler's RDS port.
 *
 * @param client - The RDS client.
 * @returns The port.
 */
export function createRdsApi(client: RDSClient): RdsApi {
    return {
        async listInstances(): Promise<RdsInstanceSummary[]> {
            const instances: RdsInstanceSummary[] = [];
            let marker: string | undefined;

            do {
                const response = await client.send(new DescribeDBInstancesCommand({ Marker: marker }));

                for (const instance of response.DBInstances ?? []) {
                    instances.push({
                        identifier: instance.DBInstanceIdentifier ?? '',
                        status: instance.DBInstanceStatus ?? '',
                    });
                }

                marker = response.Marker;
            } while (marker);

            return instances;
        },
        async stopInstance(identifier: string): Promise<void> {
            await client.send(new StopDBInstanceCommand({ DBInstanceIdentifier: identifier }));
        },
        async startInstance(identifier: string): Promise<void> {
            await client.send(new StartDBInstanceCommand({ DBInstanceIdentifier: identifier }));
        },
    };
}

/**
 * The scheduler's ECS port.
 *
 * @param client - The ECS client.
 * @returns The port.
 */
export function createEcsApi(client: ECSClient): EcsApi {
    return {
        listClusters: (inScope) => listClusterSummaries(client, inScope),
        async listServices(clusterArn: string): Promise<EcsServiceSummary[]> {
            return (await describeAllServices(client, clusterArn)).map((service) => ({
                clusterArn,
                serviceArn: service.serviceArn ?? '',
                serviceName: service.serviceName ?? '',
                desiredCount: service.desiredCount ?? 0,
            }));
        },
        async updateDesiredCount(clusterArn: string, serviceArn: string, desiredCount: number): Promise<void> {
            await client.send(new UpdateServiceCommand({ cluster: clusterArn, service: serviceArn, desiredCount }));
        },
    };
}

/**
 * The scheduler's EC2 port.
 *
 * @param client - The EC2 client.
 * @returns The port.
 */
export function createEc2Api(client: EC2Client): Ec2Api {
    return {
        async listInstances(): Promise<Ec2InstanceSummary[]> {
            const summaries: Ec2InstanceSummary[] = [];
            let nextToken: string | undefined;

            do {
                const response = await client.send(new DescribeInstancesCommand({ NextToken: nextToken }));

                for (const reservation of response.Reservations ?? []) {
                    for (const instance of reservation.Instances ?? []) {
                        summaries.push({
                            instanceId: instance.InstanceId ?? '',
                            state: instance.State?.Name ?? '',
                            nameTag: (instance.Tags ?? []).find((tag) => tag.Key === 'Name')?.Value,
                            stackNameTag: (instance.Tags ?? []).find(
                                (tag) => tag.Key === 'aws:cloudformation:stack-name',
                            )?.Value,
                            sourceDestCheck: instance.SourceDestCheck ?? undefined,
                        });
                    }
                }

                nextToken = response.NextToken;
            } while (nextToken);

            return summaries;
        },
        async stopInstances(instanceIds: string[]): Promise<void> {
            await client.send(new StopInstancesCommand({ InstanceIds: instanceIds }));
        },
        async startInstances(instanceIds: string[]): Promise<void> {
            await client.send(new StartInstancesCommand({ InstanceIds: instanceIds }));
        },
    };
}

/**
 * The scheduler's SSM port.
 *
 * @param client - The SSM client.
 * @returns The port.
 */
export function createSsmApi(client: SSMClient): SsmApi {
    return {
        async getParameter(name: string): Promise<string | undefined> {
            try {
                const response = await client.send(new GetParameterCommand({ Name: name }));

                return response.Parameter?.Value;
            } catch (error) {
                if (error instanceof Error && error.name === 'ParameterNotFound') {
                    return undefined;
                }

                throw error;
            }
        },
        async putParameter(name: string, value: string): Promise<void> {
            await client.send(new PutParameterCommand({ Name: name, Value: value, Type: 'String', Overwrite: true }));
        },
    };
}

/**
 * Every stack status that can own a live rule. `ListStacks` with no filter also returns deleted stacks for 90 days.
 */
const LIVE_STACK_STATUSES: StackStatus[] = [
    'CREATE_COMPLETE',
    'UPDATE_COMPLETE',
    'UPDATE_ROLLBACK_COMPLETE',
    'ROLLBACK_COMPLETE',
    'IMPORT_COMPLETE',
    'IMPORT_ROLLBACK_COMPLETE',
    'UPDATE_IN_PROGRESS',
    'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS',
    'UPDATE_ROLLBACK_IN_PROGRESS',
    'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS',
    'CREATE_IN_PROGRESS',
];

/**
 * The physical ids of every `AWS::Events::Rule` that a stack `inStackScope` admits owns.
 *
 * ⛔ The unit of scope is the STACK, never the rule. CloudFormation truncates a generated rule name to its first
 * characters, so a production rule (`kitchensink-identity-webh-ReconciliationScheduleAC1-…`) carries no `-prod` and no
 * name predicate can tell it from its sandbox twin. A stack name is never truncated. `ListStackResources` is called
 * only on an admitted stack, because the permissions boundary refuses it on a production one.
 *
 * @param client - The CloudFormation client.
 * @param inStackScope - Which stack names may be listed; the scheduler's predicate, never decided here.
 * @returns The rule names (a default-bus rule's physical id is its name).
 * @sideEffect Calls CloudFormation `ListStacks` and `ListStackResources`.
 */
async function ruleNamesOwnedByStacks(
    client: CloudFormationClient,
    inStackScope: (stackName: string) => boolean,
): Promise<Set<string>> {
    const stackNames: string[] = [];
    let nextToken: string | undefined;

    do {
        const page = await client.send(
            new ListStacksCommand({ StackStatusFilter: LIVE_STACK_STATUSES, NextToken: nextToken }),
        );

        for (const summary of page.StackSummaries ?? []) {
            if (summary.StackName !== undefined && inStackScope(summary.StackName)) {
                stackNames.push(summary.StackName);
            }
        }

        nextToken = page.NextToken;
    } while (nextToken);

    const ruleNames = new Set<string>();

    for (const stackName of stackNames) {
        let resourceToken: string | undefined;

        do {
            const page = await client.send(
                new ListStackResourcesCommand({ StackName: stackName, NextToken: resourceToken }),
            );

            for (const resource of page.StackResourceSummaries ?? []) {
                if (resource.ResourceType === 'AWS::Events::Rule' && resource.PhysicalResourceId !== undefined) {
                    ruleNames.add(resource.PhysicalResourceId);
                }
            }

            resourceToken = page.NextToken;
        } while (resourceToken);
    }

    return ruleNames;
}

/**
 * The scheduler's EventBridge port.
 *
 * ⚠️ Rules are DISCOVERED through the stacks that own them (see {@link ruleNamesOwnedByStacks}), then read with
 * `ListRules` + `ListTagsForResource`, NOT the Resource Groups Tagging API. The post-deploy sync runs seconds after
 * CloudFormation created a rule, and the tagging API's index is eventually consistent — a rule it has not indexed yet
 * would be left DISABLED behind a green sync. EventBridge's and CloudFormation's own APIs are not.
 *
 * @param client - The EventBridge client (built with adaptive retry by the handler).
 * @param cloudFormation - The CloudFormation client.
 * @returns The port.
 */
export function createEventsApi(client: EventBridgeClient, cloudFormation: CloudFormationClient): EventsApi {
    return {
        async listScheduledRules(inStackScope: (stackName: string) => boolean): Promise<ScheduledRuleSummary[]> {
            const owned = await ruleNamesOwnedByStacks(cloudFormation, inStackScope);
            const rules: ScheduledRuleSummary[] = [];
            let nextToken: string | undefined;

            do {
                const page = await client.send(
                    new ListRulesCommand({ NamePrefix: RULE_NAME_PREFIX, NextToken: nextToken }),
                );

                for (const rule of page.Rules ?? []) {
                    // An event-pattern rule is not the scheduler's: the CDK gate leaves it untouched, so this does.
                    if (rule.Name === undefined || rule.Arn === undefined || rule.ScheduleExpression === undefined) {
                        continue;
                    }

                    // ⛔ Before the per-resource call: the boundary refuses ListTagsForResource on a production rule.
                    if (!owned.has(rule.Name)) {
                        continue;
                    }

                    const { Tags: tags = [] } = await client.send(
                        new ListTagsForResourceCommand({ ResourceARN: rule.Arn }),
                    );
                    const tagValue = (key: string): string | undefined => tags.find((tag) => tag.Key === key)?.Value;

                    rules.push({
                        name: rule.Name,
                        stageTag: tagValue(SCHEDULED_RULE_STAGE_TAG),
                        environmentTag: tagValue('Environment'),
                    });
                }

                nextToken = page.NextToken;
            } while (nextToken);

            return rules;
        },
        async enableRule(name: string): Promise<void> {
            await client.send(new EnableRuleCommand({ Name: name }));
        },
        async disableRule(name: string): Promise<void> {
            await client.send(new DisableRuleCommand({ Name: name }));
        },
    };
}
